/**
 * ЛОГИКА СТРОИТЕЛЯ (Builder Role)
 * Задача: Возведение новых зданий. Если строек нет — помощь апгрейдеру.
 *
 * ТЗ №2: получение энергии из источников убрано. Основной (и единственный)
 * источник — Storage. Собственного аварийного механизма у builder не было
 * и не вводится: если Storage недоступен/пуст, крип просто ждёт.
 */
const roleUpgrader = require("./role.upgrader");
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
      creep.memory.working = true; // Набрал ресурсы -> пора строить
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Пустой -> пора за энергией
    }

    /**
     * 3. РЕЖИМ СБОРА (Storage-only, ТЗ №2)
     */
    if (!creep.memory.working) {
      energySource.withdrawFromStorage(creep);
      // Если Storage нет/пуст — аварийного режима для builder не предусмотрено
      // (ТЗ №2 прямо запрещает возвращаться к добыче из источника).
    } else {
      /**
       * 4. РЕЖИМ СТРОЙКИ (Building Mode)
       */
      const target = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);

      if (target) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
      } else {
        /**
         * ЗАПАСНОЙ ВАРИАНТ (Fallthrough Logic)
         * Если строек в комнате нет, используем логику апгрейдера.
         */
        roleUpgrader.run(creep);
      }
    }
  },
};
