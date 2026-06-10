module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // Переключение режимов
    if (creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
    }
    if (creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    // Режим сбора энергии
    if (!creep.memory.working) {
      // 1. Попробовать взять из линка у контроллера
      const controllerLink = creep.room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.inRangeTo(creep.room.controller, 3) &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];

      if (controllerLink) {
        if (
          creep.withdraw(controllerLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(controllerLink, { reusePath: 10 });
        }
        return;
      }

      // 2. Попробовать взять из контейнера
      const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container, { reusePath: 10 });
        }
        return;
      }

      // 3. Если нет линка и контейнера - добывать напрямую
      const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { reusePath: 10 });
        }
      } else {
        creep.say("Нет энергии");
      }
    }
    // Режим улучшения
    else {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { reusePath: 10 });
      }
    }
  },
};
