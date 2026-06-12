/**
 * ЛОГИКА РЕМОНТНИКА (Repairer Role)
 * Энергия: Storage → если пусто → Source напрямую.
 * Если чинить нечего — помогает строителю.
 */
const roleBuilder = require("role.builder");

module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (!creep.memory.working) {
      this._collect(creep);
    } else {
      this._repair(creep);
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

  _repair: function (creep) {
    const target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: s =>
        s.hits < s.hitsMax &&
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART,
    });
    if (target) {
      if (creep.repair(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 10 });
      }
    } else {
      roleBuilder.run(creep);
    }
  },
};
