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

const { MINER, LAB_BOOST } = require("./constants");

/**
 * Множитель добычи, который даёт буст части тела: BOOSTS.work[XUHO2].harvest = 7
 * (+600 % к harvest, docs.screeps.com/resources.html). Берём из движковой
 * таблицы, а не из константы проекта: список бустов и их силы определяет движок.
 * @param {string|undefined} boost
 * @returns {number}
 */
function harvestMultiplier(boost) {
  if (!boost) return 1;
  // Тестовая среда: движковых таблиц нет (BOOSTS объявляет только живой шард).
  if (typeof BOOSTS === "undefined") return 1;

  const table = BOOSTS[WORK];
  const effect = table && table[boost];
  const multiplier = effect && effect.harvest;
  return typeof multiplier === "number" ? multiplier : 1;
}

/**
 * Сколько WORK-частей крипа уже несут добычный буст. Служит ключом кэша плана
 * пачечной добычи: буст выдаётся ПОСЛЕ первого расчёта, и без пересчёта
 * интервал остался бы «небустнутым» — буст потрачен, а экономии вызовов
 * harvest() нет. Ноль у небустнутого крипа (а не единица), чтобы отсутствие
 * записи в памяти читалось как «бустов нет».
 * @param {Object} creep
 * @returns {number}
 */
function harvestBoostedWork(creep) {
  const body = creep.body;
  let count = 0;
  for (let i = 0; i < body.length; i++) {
    const part = body[i];
    if (part.type === WORK && harvestMultiplier(part.boost) > 1) count++;
  }
  return count;
}

/**
 * План пачечной добычи: сколько энергии крип берёт за один вызов harvest и
 * через сколько тиков вызов повторять.
 *
 * Источник восстанавливает energyCapacity / ENERGY_REGEN_TIME энергии в тик
 * (для 3000-источника — 10/тик), а минёр за один вызов берёт
 * HARVEST_POWER × WORK × буст. Интервал — во столько раз пачка больше тикового
 * восстановления. Для 3000-источника: 5 WORK → 1, 10 WORK → 2, 10 WORK с XUHO2
 * (×7) → 10 (потолок MINER.MAX_INTERVAL), то есть вызовов в пять раз меньше при
 * той же добыче.
 *
 * ПАЧКА НЕ МОЖЕТ БЫТЬ БОЛЬШЕ РЮКЗАКА. Без этого ограничения буст ломал дальнего
 * майнера: его рюкзак — 2 CARRY = 100, а с XUHO2 «пачка» стала бы 140, и проверка
 * «пачка не влезает» (remote.miner: getFreeCapacity < perCall) сделалась бы
 * истинной ВСЕГДА — крип бесконечно отдавал бы энергию в контейнер и не сделал
 * ни одного вызова harvest.
 *
 * Функция экспортируется: remote.miner использует ТУ ЖЕ формулу (пачечная
 * добыча — одна точка правды, второй копии формулы в проекте нет).
 *
 * @param {Creep} creep
 * @param {any} source
 * @returns {{perCall: number, interval: number}}
 */
function harvestPlan(creep, source) {
  const body = creep.body;
  let power = 0;

  for (let i = 0; i < body.length; i++) {
    const part = body[i];
    if (part.type === WORK) power += HARVEST_POWER * harvestMultiplier(part.boost);
  }

  const store =
    creep.store && typeof creep.store.getCapacity === "function"
      ? creep.store.getCapacity(RESOURCE_ENERGY)
      : 0;
  const perCall = store > 0 ? Math.min(power, store) : power;

  const capacity = source.energyCapacity;
  if (perCall <= 0 || !capacity) return { perCall: perCall, interval: 1 };

  const perTick = capacity / ENERGY_REGEN_TIME; // восстановление источника
  const interval = Math.floor(perCall / perTick);

  return {
    perCall: perCall,
    interval: interval < 1 ? 1 : Math.min(interval, MINER.MAX_INTERVAL),
  };
}

module.exports = {
  harvestPlan,
  harvestBoostedWork,
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
    // и живёт в memory, чтобы не проходить по body каждый тик. Пересчитывается,
    // если у крипа появился добычный буст (XUHO2): сила WORK изменилась, а план
    // остался бы прежним — и буст не дал бы ни одного сэкономленного вызова.
    //
    // СКАНИРОВАНИЕ ТЕЛА ОТКЛЮЧЕНО ПРИ ВЫКЛЮЧЕННЫХ БУСТАХ (Memory.labBoostOff).
    // Флаг читает и boost.manager (boost.manager.js:723) — при нём буст не
    // выдаётся НИКОМУ, значит harvestBoosted у крипа меняться не может, и обход
    // тела (20 частей у нового тела 10 WORK, с обращением к таблице BOOSTS на
    // каждую часть) каждый тик каждым майнером — чистая трата. Значение берётся
    // из памяти: у небустнутого крипа там 0 (см. harvestBoostedWork).
    const boosted =
      typeof Memory !== "undefined" && Memory && Memory[LAB_BOOST.OFF_FLAG]
        ? creep.memory.harvestBoosted | 0
        : harvestBoostedWork(creep);
    let interval = creep.memory.harvestInterval;
    if (interval === undefined || (creep.memory.harvestBoosted | 0) !== boosted) {
      interval = harvestPlan(creep, source).interval;
      creep.memory.harvestInterval = interval;
      creep.memory.harvestBoosted = boosted;
    }

    // ПУСТОЙ ИСТОЧНИК — НЕ ВЫЗЫВАТЬ harvest.
    //
    // Живой замер shard3 (окно 1200 тиков, старт 83175900): бакет `miner`
    // 2.313 мс/тик (max 6.34) при ~11 майнерах — это ровно цена «по одному
    // вызову creep.harvest() на майнера в тик» (0.21 мс за вызов, замер из
    // docs/CPU-PROFILE-ROOM-MANAGER.md). Источник восстанавливает
    // energyCapacity / ENERGY_REGEN_TIME (10/тик для 3000), поэтому при двух
    // майнерах на источнике значительная часть вызовов уходит в
    // ERR_NOT_ENOUGH_RESOURCES: энергии не даёт, а стоит как продуктивный.
    //
    // Гейт стоит ТОЛЬКО для поштучных майнеров (interval === 1): у пачечных
    // (interval > 1) пропуск вызова стоил бы целого интервала ожидания и
    // потерянной добычи, а у поштучных — максимум один тик. Проверка —
    // чтение свойства source.energy, без игрового действия. Порядок важен:
    // гейт стоит ПОСЛЕ расчёта interval (иначе interval ещё не определён).
    if (interval === 1 && source.energy === 0) return;

    // Пачечная добыча: между вызовами минёр просто стоит на источнике.
    if (interval > 1 && Game.time % interval !== 0) return;

    creep.harvest(source);
  },
};

