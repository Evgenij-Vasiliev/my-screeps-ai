/**
 * ЛОГИКА АПГРЕЙДЕРА (Upgrader Role)
 * Энергия: Storage → если пусто → Source напрямую.
 */
module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (!creep.memory.working) {
      this._collect(creep);
    } else {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { reusePath: 10 });
      }
    }
  },

  _collect: function (creep) {
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 10 });
      }
      return;
    }
    // Storage пуст — добываем напрямую
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 10 });
    }
  },
};
