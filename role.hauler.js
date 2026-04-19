/**
 * ЛОГИКА ТРАНСПОРТЕРA (Hauler Role)
 */
var roleHauler = {
  /** @param {Creep} creep **/
  run: function (creep) {
    /**
     * 1. УПРАВЛЕНИЕ СОСТОЯНИЕМ
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
     * 2. РЕЖИМ СБОРА
     */
    if (!creep.memory.working) {
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        // Приоритет 1: Энергия на земле (Dropped)
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
          // Приоритет 2: Контейнер (Container)
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
          }
        }
      }
    } else {
      /**
       * 3. РЕЖИМ ДОСТАВКИ (Приоритеты)
       */
      let target = null;

      // 1. Расширения
      target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_EXTENSION &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      // 2. Спавн
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: s =>
            s.structureType === STRUCTURE_SPAWN &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // 3. Терминал
      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.terminal;
      }

      // 4. Хранилище
      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
      }

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
    }
  },
};

module.exports = roleHauler;
