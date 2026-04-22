const roleHarvester = require("./role.harvester");

module.exports = {
  run: function (creep) {
    /**
     * 1. ТУМБЛЕР (State Switch)
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      delete creep.memory.buildTargetId; // Забываем цель при разрядке
      creep.say("🔄 сбор");
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚧 строю");
    }

    /**
     * 2. РЕЖИМ СТРОЙКИ (Building Mode)
     */
    if (creep.memory.working) {
      // Пытаемся получить цель из памяти
      let target = Game.getObjectById(creep.memory.buildTargetId);

      // Если в памяти пусто или стройка завершена — ищем новую БЛИЖАЙШУЮ
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
        if (target) {
          creep.memory.buildTargetId = target.id;
        }
      }

      if (target) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffff00" } });
        }
      } else {
        // Если строек вообще нет — помогаем апгрейдеру
        roleHarvester.run(creep);
      }
    } else {
      /**
       * 3. РЕЖИМ СБОРА (Harvesting Mode)
       */
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        // Приоритет 1: Энергия на земле
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
          // Приоритет 2: Контейнер
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
            // Приоритет 3: Копаем сами
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
