/**
 * ЛОГИКА СТРОИТЕЛЯ (Builder Role)
 * Энергия: Storage → если пусто → Source напрямую.
 * Если строек нет — помогает апгрейдеру.
 */
const roleUpgrader = require("role.upgrader");

module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (!creep.memory.working) {
      this._collect(creep);
    } else {
      this._build(creep);
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

  _build: function (creep) {
    const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
    if (site) {
      if (creep.build(site) === ERR_NOT_IN_RANGE) {
        creep.moveTo(site, { reusePath: 10 });
      }
    } else {
      roleUpgrader.run(creep);
    }
  },
};
