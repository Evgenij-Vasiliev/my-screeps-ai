const roleBuilder = require("./role.builder");

module.exports = {
  run: function (creep) {
    /**
     * 1. ТУМБЛЕР (State Switch)
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      delete creep.memory.repairTargetId; // Сбрасываем цель только при разрядке
      creep.say("🔄 сбор");
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🔧 чиню");
    }

    /**
     * 2. РЕЖИМ РЕМОНТА
     */
    if (creep.memory.working) {
      let target = null;

      // Сначала проверяем, есть ли уже запомненная цель в памяти
      if (creep.memory.repairTargetId) {
        target = Game.getObjectById(creep.memory.repairTargetId);

        // Если цель внезапно исчезла или уже полностью починена — удаляем её из памяти
        if (!target || target.hits === target.hitsMax) {
          target = null;
          delete creep.memory.repairTargetId;
        }
      }

      // Если цели нет (не была в памяти или починилась) — только тогда ищем новую
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        });

        if (target) {
          creep.memory.repairTargetId = target.id;
        }
      }

      if (target) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#00ff00" },
            reusePath: 10,
          });
        }
      } else {
        roleBuilder.run(creep);
      }
    } else {
      /**
       * 3. РЕЖИМ СБОРА (Без изменений)
       */
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        const droppedEnergy = mySource.pos.findInRange(
          FIND_DROPPED_RESOURCES,
          2,
          {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
          },
        )[0];

        if (droppedEnergy) {
          if (creep.pickup(droppedEnergy) === ERR_NOT_IN_RANGE) {
            creep.moveTo(droppedEnergy, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        } else {
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
            if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
              creep.moveTo(mySource, {
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            }
          }
        }
      }
    }
  },
};
