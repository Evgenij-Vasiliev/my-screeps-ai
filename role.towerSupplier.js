module.exports = {
  run: function (creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
    } else if (
      !creep.memory.working &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      // Находим ближайшую недозаправленную башню
      const tower = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_TOWER &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      if (tower) {
        if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(tower);
        }
      }
    } else {
      // Берем энергию из хранилища
      if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
        if (
          creep.withdraw(creep.room.storage, RESOURCE_ENERGY) ===
          ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(creep.room.storage);
        }
      }
    }
  },
};
