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
