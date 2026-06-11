/**
 * ЛОГИКА СНАБЖЕНЦА БАШЕН (TowerSupplier Role)
 * Задача: держать башни заряженными, забирая энергию из контейнеров.
 */
module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    // Тумблер
    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (!creep.memory.working) {
      this._collect(creep);
    } else {
      this._supply(creep);
    }
  },

  _collect: function (creep) {
    // Сначала dropped energy
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped, { reusePath: 5 });
      }
      return;
    }

    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container, { reusePath: 15 });
      }
    }
  },

  _supply: function (creep) {
    const tower = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_TOWER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (tower) {
      if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(tower, { reusePath: 15 });
      }
      return;
    }

    // Башни полные — везём в storage чтобы не простаивать
    if (
      creep.room.storage &&
      creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      if (
        creep.transfer(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(creep.room.storage, { reusePath: 10 });
      }
    }
  },
};
