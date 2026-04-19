/**
 * ЛОГИКА ЗАПРАВЩИКА БАШЕН (Tower Supplier Role) - Ветка TEST
 */
module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    /**
     * 1. СОСТОЯНИЕ
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
     * 2. РЕЖИМ СБОРА (Строго по sourceIndex)
     */
    if (!creep.memory.working) {
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        // Ищем контейнер строго у своего источника (радиус 2 клетки)
        const container = mySource.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: s =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
        })[0];

        if (container) {
          if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        } else {
          creep.say("⏳ пусто");
        }
      }
    } else {
    /**
     * 3. РЕЖИМ ПЕРЕДАЧИ (Равномерная заправка)
     */
      // Ищем башни, которым нужна энергия
      const towers = creep.room.find(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_TOWER &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      if (towers.length > 0) {
        // Выбираем самую пустую башню из доступных
        const targetTower = _.min(towers, t => t.store[RESOURCE_ENERGY]);

        if (targetTower) {
          if (
            creep.transfer(targetTower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
          ) {
            creep.moveTo(targetTower, {
              visualizePathStyle: { stroke: "#ffffff" },
            });
          }
        }
      } else {
        creep.say("💤 сон");
        // Опционально: отходим к спавну, чтобы не мешать на дорогах
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn) creep.moveTo(spawn, { reusePath: 10 });
      }
    }
  },
};
