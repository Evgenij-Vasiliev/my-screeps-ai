/**
 * ЛОГИКА ТРАНСПОРТЕРA (Hauler Role)
 */
const roleHauler = {
  run: function (creep) {
    /**
     * =========================================
     * 0. АНТИ-БЛОКИРОВКА
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
     * 1. STATE
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
     * 2. СБОР (без изменений)
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
            creep.moveTo(dropped);
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
              creep.moveTo(targetContainer);
            }
          }
        }
      }
    } else {
      /**
       * =========================================
       * 3. ДОСТАВКА (с настройкой из Memory)
       * =========================================
       */

      const targets = creep.room._energyTargets;
      let target = null;

      /**
       * 1. Основные цели (spawn + extensions)
       */
      if (targets && targets.length) {
        target = creep.pos.findClosestByRange(targets);
      }

      /**
       * 2. TERMINAL (используем значение из memory)
       */
      const terminalTarget = creep.room.memory.terminalEnergyTarget || 10000; // дефолт

      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store[RESOURCE_ENERGY] < terminalTarget
      ) {
        target = creep.room.terminal;
        creep.say("📦 terminal");
      }

      /**
       * 3. STORAGE
       */
      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
        creep.say("🏦 storage");
      }

      /**
       * 4. Выполнение
       */
      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);

        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
        }
      } else {
        creep.say("😴 idle");
      }
    }
  },
};

module.exports = roleHauler;
