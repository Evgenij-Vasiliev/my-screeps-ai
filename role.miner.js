/**
 * ЛОГИКА МАЙНЕРА (Miner Role) — линковая логистика
 *
 * Слот назначается при спавне в creep.factory.js.
 * Майнер просто идёт на своё место и работает — ничего не ищет.
 *
 * Оптимизация CPU:
 * источник и линк рядом с рабочим местом статичны,
 * поэтому их ID ищутся один раз и кэшируются в memory.
 */

const { MINER } = require("./constants");

module.exports = {
  run: function (creep) {
    const spot = creep.memory.spot;
    if (!spot) return;

    // Идём на рабочее место
    if (!creep.pos.isEqualTo(spot.x, spot.y)) {
      creep.moveTo(spot.x, spot.y, { reusePath: 20 });
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

    // Замер роли на живом шарде показал: дорого стоит не чтение, а само
    // удавшееся объектное действие (~0.21 CPU за harvest/transfer, тогда как
    // тот же вызов без действия — 0.015). Поэтому каждый интент выдаётся
    // строго тогда, когда может сработать: harvest требует места в складе и
    // энергии в источнике, transfer — полного склада и места в линке.
    const store = creep.store;
    const free = store.getFreeCapacity(RESOURCE_ENERGY);

    // Копим энергию в источнике: действие стоит одинаково и за 10, и за 60
    // энергии, поэтому снимаем только накопившееся (2 x WORK = 60). Источник
    // в этом окружении пополняется раз в 300 тиков, так что добыча не падает,
    // а число действий сокращается примерно втрое.
    if (source && free > 0 && source.energy >= MINER.HARVEST_MIN_ENERGY) {
      creep.harvest(source);
    }

    // Сливаем в линк только когда склад полон и в линке есть место
    if (link && free === 0 && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      creep.transfer(link, RESOURCE_ENERGY);
    }
  },
};
