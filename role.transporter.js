module.exports = {
  run: function (creep) {
    // Инициализация состояния при первом запуске
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    // Тумблер: полный -> везём, пустой -> берём
    if (
      creep.memory.working === true &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = false;
    } else if (
      creep.memory.working === false &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      // Доставка: спавн/расширения → storage
      let target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: structure => {
          return (
            (structure.structureType === STRUCTURE_EXTENSION ||
              structure.structureType === STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
      });

      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
      }

      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        } else if (result === ERR_FULL || result === ERR_INVALID_TARGET) {
          creep.memory.working = false;
        }
      } else {
        // Если некуда нести — апгрейд контроллера
        const controller = creep.room.controller;
        if (controller) {
          if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(controller, {
              visualizePathStyle: { stroke: "#ffffff" },
            });
          }
        }
      }
    } else {
      // Сбор: берём из контейнера
      const source = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_CONTAINER &&
          structure.store[RESOURCE_ENERGY] > 0,
      });

      if (source) {
        if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      }
    }
  },
};
