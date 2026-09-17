/**
 * ЛОГИКА МАЙНЕРА (Miner Role) — линковая логистика, «пачечная» добыча
 *
 * Слот назначается при спавне в creep.factory.js.
 * Майнер просто идёт на своё место и работает — ничего не ищет.
 *
 * Оптимизация CPU (замеры: docs/CPU-PROFILE-ROOM-MANAGER.md, 4.8;
 * итоговый отчёт: docs/MINER-CPU-OPTIMIZATION.md):
 *  - источник и линк рядом с рабочим местом статичны, поэтому их ID ищутся
 *    один раз и кэшируются в memory;
 *  - цена вызова creep.harvest() на живом шарде ≈0.21 мс и почти не зависит
 *    от тела и пути, а весь бакет роли — это «по одному вызову на минёра в
 *    тик». Поэтому минёр берёт энергию ПАЧКАМИ: за вызов он получает
 *    HARVEST_POWER × WORK, и вызов делается раз в столько тиков, сколько
 *    энергии нужно источнику на восстановление этой пачки. Тело на 10 WORK
 *    (CREEP_BODIES.miner) = 20 энергии за вызов → интервал 2 тика для
 *    3000-источника: добыча та же (10/тик = восстановление), вызовов вдвое
 *    меньше. Для старого тела (5 WORK) интервал равен 1, то есть поведение
 *    не меняется — интервал считается из тела и источника, а не жёстко;
 *  - вызов по полному складу не делается вообще: он всё равно не приносит
 *    энергии, но стоит как продуктивный (сначала слив в линк, потом добыча).
 */

const { MINER } = require("./constants");

/**
 * План пачечной добычи: сколько энергии крип берёт за один вызов harvest и
 * через сколько тиков вызов повторять.
 *
 * Источник восстанавливает energyCapacity / ENERGY_REGEN_TIME энергии в тик
 * (для 3000-источника — 10/тик), а минёр за один вызов берёт
 * HARVEST_POWER × WORK. Интервал — во столько раз пачка больше тикового
 * восстановления. Для 3000-источника: 5 WORK → 1, 10 WORK → 2, 15 WORK → 3.
 *
 * Функция экспортируется: remote.miner использует ТУ ЖЕ формулу (пачечная
 * добыча — одна точка правды, второй копии формулы в проекте нет).
 *
 * @param {Creep} creep
 * @param {any} source
 * @returns {{perCall: number, interval: number}}
 */
function harvestPlan(creep, source) {
  let work = 0;
  const body = creep.body;

  for (let i = 0; i < body.length; i++) {
    if (body[i].type === WORK) work++;
  }

  const perCall = HARVEST_POWER * work; // энергия за один вызов
  const capacity = source.energyCapacity;
  if (work === 0 || !capacity) return { perCall: perCall, interval: 1 };

  const perTick = capacity / ENERGY_REGEN_TIME; // восстановление источника
  const interval = Math.floor(perCall / perTick);

  return {
    perCall: perCall,
    interval: interval < 1 ? 1 : Math.min(interval, MINER.MAX_INTERVAL),
  };
}

module.exports = {
  harvestPlan,
  run: function (creep) {
    const spot = creep.memory.spot;
    if (!spot) return;

    // Идём на рабочее место
    if (!creep.pos.isEqualTo(spot.x, spot.y)) {
      creep.travelTo(new RoomPosition(spot.x, spot.y, creep.room.name));
      return;
    }

    // Кэшируем источник один раз
    if (!creep.memory.sourceId) {
      const source = creep.pos.findInRange(FIND_SOURCES, 1)[0];
      creep.memory.sourceId = source ? source.id : null;
    }

    // Кэшируем link один раз
    if (creep.memory.linkId === undefined) {
      const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_LINK,
      })[0];

      creep.memory.linkId = link ? link.id : null;
    }

    const source = creep.memory.sourceId
      ? Game.getObjectById(creep.memory.sourceId)
      : null;

    const link = creep.memory.linkId
      ? Game.getObjectById(creep.memory.linkId)
      : null;

    // Склад полон — сначала сливаем в линк. Вызов harvest по полному складу
    // ничего не добудет, но стоит как продуктивный (≈0.21 мс), поэтому его
    // здесь нет: пока линк не примет энергию, минёр просто ждёт.
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      if (link) {
        creep.transfer(link, RESOURCE_ENERGY);
      }
      return;
    }

    if (!source) return;

    // Интервал считается один раз (тело и источник у минёра не меняются)
    // и живёт в memory, чтобы не проходить по body каждый тик.
    let interval = creep.memory.harvestInterval;
    if (interval === undefined) {
      interval = harvestPlan(creep, source).interval;
      creep.memory.harvestInterval = interval;
    }

    // Пачечная добыча: между вызовами минёр просто стоит на источнике.
    if (interval > 1 && Game.time % interval !== 0) return;

    creep.harvest(source);
  },
};

