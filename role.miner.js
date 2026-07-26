/**
 * ЛОГИКА МАЙНЕРА (Miner Role) — линковая логистика
 *
 * Слот назначается при спавне в creep.factory.js.
 * Майнер просто идёт на своё место и работает — ничего не ищет.
 *
 * Оптимизация CPU: источник и линк рядом с рабочим местом статичны
 * (спот не меняется всю жизнь крипа), поэтому их ID ищутся один раз
 * и кэшируются в memory — дальше только Game.getObjectById() (O(1)).
 */
module.exports = {
  run: function (creep) {
    const spot = creep.memory.spot;
    if (!spot) return;
    // Идём на рабочее место — один раз
    if (!creep.pos.isEqualTo(spot.x, spot.y)) {
      creep.moveTo(spot.x, spot.y, { reusePath: 20 });
      return;
    }

    // Кэшируем source/link один раз — далее только Game.getObjectById()
    if (!creep.memory.sourceId) {
      const source = creep.pos.findInRange(FIND_SOURCES, 1)[0];
      creep.memory.sourceId = source ? source.id : null;
    }
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

    if (source) {
      const harvestResult = creep.harvest(source);
      if (harvestResult !== OK) {
        console.log(
          `[Miner] ${creep.name} : harvest() вернул ошибку ${harvestResult}`,
        );
      }
    }

    if (link && creep.store[RESOURCE_ENERGY] > 0) {
      const transferResult = creep.transfer(link, RESOURCE_ENERGY);
      if (transferResult !== OK) {
        console.log(
          `[Miner] ${creep.name} : transfer() вернул ошибку ${transferResult}`,
        );
      }
    }
  },
};
