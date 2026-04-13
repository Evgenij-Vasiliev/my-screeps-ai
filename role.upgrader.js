/**
 * ЛОГИКА АПГРЕЙДЕРА (Upgrader Role)
 * Основная задача: постоянная накачка контроллера комнаты энергией (RCL).
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. СОСТОЯНИЕ (State Management)
     * Если память пуста, начинаем с режима "готов к набору энергии".
     */
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    /**
     * 2. ТУМБЛЕР (Logic Switch)
     * Переключаем режимы: "Сбор" (false) и "Улучшение" (true).
     */
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true; // Рюкзак полон -> идем к контроллеру
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Энергия кончилась -> возвращаемся к источнику
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
       * 4. РЕЖИМ УЛУЧШЕНИЯ (Upgrade Mode)
       * Работа с контроллером комнаты.
       */
      const target = creep.room.controller;
      if (creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
        // Рисуем синюю линию пути к контроллеру для отличия от других ролей
        creep.moveTo(target, { visualizePathStyle: { stroke: "#4b0082" } });
      }
    }
  },
};
