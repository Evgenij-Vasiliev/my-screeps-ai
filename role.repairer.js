/**
 * ЛОГИКА РЕМОНТНИКА (Repairer Role)
 * Задача: Поддержание здоровья дорог и контейнеров. Игнорирует стены/рампарты.
 *
 * ТЗ №2: зависимость от источников убрана. Основной источник — Storage.
 *
 */
const roleBuilder = require("./role.builder");
const energySource = require("energySource");

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
      creep.memory.working = true; // Рюкзак полон -> пора чинить
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Энергия на нуле -> пора за энергией
    }

    /**
     * 3. РЕЖИМ СБОРА (Storage-only, ТЗ №2)
     */
    if (!creep.memory.working) {
      energySource.withdrawFromStorage(creep);
    } else {
      /**
       * 4. РЕЖИМ РЕМОНТА (Repair Mode)
       */
      const target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: structure =>
          structure.hits < structure.hitsMax &&
          structure.structureType !== STRUCTURE_WALL &&
          structure.structureType !== STRUCTURE_RAMPART,
      });

      if (target) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
      } else {
        /**
         * ЗАПАСНОЙ ВАРИАНТ (Fallthrough Logic)
         * Если всё в комнате починено — помогаем строителю.
         */
        roleBuilder.run(creep);
      }
    }
  },
};
