/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. СОСТОЯНИЕ (State Management)
     */
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    /**
     * 2. ТУМБЛЕР (Logic Switch)
     */
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false;
    }

    /**
     * 3. РЕЖИМ СБОРА (Harvesting Mode)
     * Изменено: теперь идем не к ближайшему, а к назначенному источнику
     */
    if (!creep.memory.working) {
      // Получаем список всех источников в комнате
      const sources = creep.room.find(FIND_SOURCES);

      // Выбираем цель: если в памяти есть индекс — берем его, иначе — ближайший (для старых крипов)
      const targetSource =
        creep.memory.sourceIndex !== undefined
          ? sources[creep.memory.sourceIndex]
          : creep.pos.findClosestByRange(FIND_SOURCES);

      if (targetSource) {
        if (creep.harvest(targetSource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targetSource, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
      }
    } else {
      /**
       * 4. РЕЖИМ ПЕРЕДАЧИ (Delivery Mode)
       * Здесь всё осталось без изменений
       */
      let target = null;

      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_SPAWN &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      if (!target && creep.room.storage) {
        target = creep.room.storage;
      }

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
    }
  },
};
