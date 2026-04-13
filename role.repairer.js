/**
 * ЛОГИКА РЕМОНТНИКА (Repairer Role)
 * Задача: Поддержание здоровья дорог и контейнеров. Игнорирует стены/рампарты.
 */
const roleBuilder = require("./role.builder");

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
      creep.memory.working = false; // Энергия на нуле -> пора добывать
    }
    /**
     * 3. РЕЖИМ СБОРА (Harvesting Mode)
     */
    if (!creep.memory.working) {
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        // 1. Ищем энергию НА ЗЕМЛЕ в радиусе 2 клеток от источника
        const droppedEnergy = mySource.pos.findInRange(
          FIND_DROPPED_RESOURCES,
          2,
          {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
          },
        )[0]; // Берем первую попавшуюся кучу

        if (droppedEnergy) {
          // Если на земле что-то лежит — подбираем (pickup)
          if (creep.pickup(droppedEnergy) === ERR_NOT_IN_RANGE) {
            creep.moveTo(droppedEnergy, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        } else {
          // 2. Если на земле чисто — ищем КОНТЕЙНЕР в радиусе 2 клеток
          const container = mySource.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store[RESOURCE_ENERGY] > 0,
          })[0];

          if (container) {
            if (
              creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
            ) {
              creep.moveTo(container, {
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            }
          } else {
            // 3. Если и контейнер пуст — КОПАЕМ сами
            if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
              creep.moveTo(mySource, {
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            }
          }
        }
      }
    } else {
      /**
       * 4. РЕЖИМ РЕМОНТА (Repair Mode)
       */
      // Ищем поврежденные структуры, ИСКЛЮЧАЯ стены и рампарты
      const targets = creep.room.find(FIND_STRUCTURES, {
        filter: structure =>
          structure.hits < structure.hitsMax &&
          structure.structureType !== STRUCTURE_WALL &&
          structure.structureType !== STRUCTURE_RAMPART,
      });

      if (targets.length > 0) {
        // Если есть что чинить — берем ближайшую поврежденную цель
        // (Для оптимизации можно использовать findClosestByRange)
        if (creep.repair(targets[0]) === ERR_NOT_IN_RANGE) {
          // Зеленая линия пути к цели ремонта
          creep.moveTo(targets[0], {
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
