module.exports = roleMiner = {
  run: function (creep) {
    // для работы в другой комнате

    if (
      creep.memory.targetRoom &&
      creep.memory.targetRoom !== creep.room.name
    ) {
      // Крип находится не в целевой комнате - идем туда
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      creep.moveTo(exit);
      return;
    }

    // Если крип не находится на контейнере, ищем подходящий контейнер
    if (!creep.memory.containerId) {
      const sources = creep.room.find(FIND_SOURCES);
      for (const source of sources) {
        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
          filter: structure => structure.structureType === STRUCTURE_CONTAINER,
        });

        // Проверяем, есть ли контейнер без майнера
        for (const container of containers) {
          const minersOnContainer = _.filter(
            Game.creeps,
            c =>
              c.memory.role === "miner" &&
              c.memory.containerId === container.id,
          );

          if (minersOnContainer.length === 0) {
            creep.memory.containerId = container.id;
            break;
          }
        }
        if (creep.memory.containerId) break; // Выходим из цикла, если контейнер найден
      }
    }

    // Если найден контейнер, пытаемся встать на него
    if (creep.memory.containerId) {
      const container = Game.getObjectById(creep.memory.containerId);
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container);
      } else {
        // Если на контейнере — добываем энергию
        const source = container.pos.findInRange(FIND_SOURCES, 1)[0];
        if (source) {
          creep.harvest(source);
        }
      }
    }
  },
};
