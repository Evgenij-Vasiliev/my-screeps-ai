/**
 * ЛОГИКА СТРОИТЕЛЯ (Builder Role)
 * Задача: Возведение новых зданий. Если строек нет — помощь апгрейдеру.
 */
const roleUpgrader = require("./role.upgrader");

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
      creep.memory.working = true; // Набрал ресурсы -> пора строить
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Пустой -> пора за едой
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
       * 4. РЕЖИМ СТРОЙКИ (Building Mode)
       */
      // Находим БЛИЖАЙШУЮ площадку вместо первой в списке
      const target = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);

      if (target) {
        // Если стройка найдена — строим
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
      } else {
        /**
         * ЗАПАСНОЙ ВАРИАНТ (Fallthrough Logic)
         * Если строек в комнате нет, используем логику апгрейдера,
         * чтобы крип приносил пользу контроллеру.
         */
        roleUpgrader.run(creep);
      }
    }
  },
};
