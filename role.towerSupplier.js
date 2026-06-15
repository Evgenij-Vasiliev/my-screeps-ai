/**
 * ===================================================
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен
 * ===================================================
 * VERSION: 3.0
 *
 * Одна задача: storage → башни
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep.room.storage) return;

    const storage = creep.room.storage;
    const towers = creep.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });

    if (creep.store[RESOURCE_ENERGY] === 0) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 5 });
      }
      return;
    }

    const tower = towers
      .filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
      .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY])[0];

    if (tower) {
      if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(tower, { reusePath: 5 });
      }
      return;
    }

    // Башни полные — сбрасываем остаток в storage
    if (creep.store[RESOURCE_ENERGY] > 0) {
      if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 5 });
      }
    }
  },
};
