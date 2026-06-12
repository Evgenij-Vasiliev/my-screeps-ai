/**
 * ЛОГИКА МАЙНЕРА (Miner Role) — линковая логистика
 *
 * Слот назначается при спавне в creep.factory.js.
 * Майнер просто идёт на своё место и работает — ничего не ищет.
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

    // Стоим на месте: копаем и передаём в линк
    const source = creep.pos.findInRange(FIND_SOURCES, 1)[0];
    const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_LINK,
    })[0];

    if (source) creep.harvest(source);
    if (link && creep.store[RESOURCE_ENERGY] > 0) {
      creep.transfer(link, RESOURCE_ENERGY);
    }
  },
};
