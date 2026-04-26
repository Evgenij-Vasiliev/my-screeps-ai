/**
 * ЛОГИКА ТРАНСПОРТЕРA (Hauler Role)
 */
const roleHauler = {
  /** @param {Creep} creep **/
  run: function (creep) {
    /**
     * =========================================
     * 0. АНТИ-БЛОКИРОВКА (Уступаем место майнеру)
     * =========================================
     */
    const containerUnderCreep = creep.pos
      .lookFor(LOOK_STRUCTURES)
      .find(s => s.structureType === STRUCTURE_CONTAINER);

    if (containerUnderCreep) {
      const minerNear = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: c => c.memory.role === "test_miner",
      })[0];

      if (minerNear && !minerNear.pos.isEqualTo(containerUnderCreep.pos)) {
        const directions = [
          TOP,
          TOP_RIGHT,
          RIGHT,
          BOTTOM_RIGHT,
          BOTTOM,
          BOTTOM_LEFT,
          LEFT,
          TOP_LEFT,
        ];
        const randomDir =
          directions[Math.floor(Math.random() * directions.length)];

        creep.move(randomDir);
        creep.say("🚜 Уступаю!");
        return;
      }
    }

    /**
     * =========================================
     * 1. УПРАВЛЕНИЕ СОСТОЯНИЕМ (state machine)
     * =========================================
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 доставка");
    }

    /**
     * =========================================
     * 2. РЕЖИМ СБОРА (ПОКА НЕ ТРОГАЕМ)
     * =========================================
     */
    if (!creep.memory.working) {
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        const dropped = mySource.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
        })[0];

        if (dropped) {
          if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        } else {
          const targetContainer = mySource.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store[RESOURCE_ENERGY] > 0,
          })[0];

          if (targetContainer) {
            if (
              creep.withdraw(targetContainer, RESOURCE_ENERGY) ===
              ERR_NOT_IN_RANGE
            ) {
              creep.moveTo(targetContainer, {
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            }
          }
        }
      }
    } else {
      /**
       * =========================================
       * 3. РЕЖИМ ДОСТАВКИ (ПЕРЕПИСАНО)
       * =========================================
       */

      // 1. Берем готовый кэш целей из roomManager
      // ВАЖНО: здесь уже НЕТ find() — мы экономим CPU
      const targets = creep.room._energyTargets;

      // Если список существует и не пустой
      if (targets && targets.length) {
        // 2. Выбираем ближайшую цель (это дешево)
        const target = creep.pos.findClosestByRange(targets);

        // 3. Дополнительная защита:
        // если цель уже заполнена — пропускаем тик
        // (из-за TTL-кэша такое может случаться)
        if (target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
          return;
        }

        // 4. Пытаемся передать энергию
        const result = creep.transfer(target, RESOURCE_ENERGY);

        // 5. Если не в радиусе — двигаемся
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      }
    }
  },
};

module.exports = roleHauler;
