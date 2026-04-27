/**
 * ЛОГИКА ЗАПРАВЩИКА БАШЕН (Tower Supplier Role)
 */
module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    /**
     * =========================================
     * 1. СОСТОЯНИЕ
     * =========================================
     */
    if (creep.store[RESOURCE_ENERGY] === 0 && creep.memory.working !== false) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (creep.store.getFreeCapacity() === 0 && !creep.memory.working) {
      creep.memory.working = true;
      creep.say("⚡ башни");
    }

    /**
     * =========================================
     * 2. СБОР (с защитой storage)
     * =========================================
     */
    if (!creep.memory.working) {
      const storage = creep.room.storage;

      // ❗ Минимальный запас (можно потом вынести в memory)
      const MIN_STORAGE_ENERGY = 5000;

      /**
       * 1. STORAGE (только если есть запас)
       */
      if (storage && storage.store[RESOURCE_ENERGY] > MIN_STORAGE_ENERGY) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage);
        }
      } else {
        /**
         * 2. FALLBACK — контейнер
         */
        const containers = creep.room._sourceContainers;
        const myContainer = containers
          ? containers[creep.memory.sourceIndex]
          : null;

        if (myContainer && myContainer.store[RESOURCE_ENERGY] > 0) {
          if (
            creep.withdraw(myContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            creep.moveTo(myContainer);
          }
        } else {
          creep.say("⏳ нет энергии");
        }
      }
    } else {
      /**
       * =========================================
       * 3. ПЕРЕДАЧА
       * =========================================
       */
      const towers = creep.room._towers;

      const needyTowers = towers
        ? towers.filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        : [];

      if (needyTowers.length > 0) {
        const targetTower = _.min(needyTowers, t => t.store[RESOURCE_ENERGY]);

        if (targetTower) {
          if (
            creep.transfer(targetTower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            creep.moveTo(targetTower);
          }
        }
      } else {
        creep.say("💤 сон");

        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn) creep.moveTo(spawn, { reusePath: 10 });
      }
    }
  },
};
