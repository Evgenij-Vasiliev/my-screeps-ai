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
      const source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    } else {
    /**
     * 4. РЕЖИМ СТРОЙКИ (Building Mode)
     */
      // Ищем все намеченные площадки для строительства (Construction Sites)
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);

      if (targets.length > 0) {
        // Если есть что строить — берем первую цель из списка
        if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
          // Желтая линия пути к стройке
          creep.moveTo(targets[0], {
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
