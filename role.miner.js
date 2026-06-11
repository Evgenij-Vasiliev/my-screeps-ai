/**
 * ЛОГИКА МАЙНЕРА (Miner Role)
 * Задача: занять контейнер у источника и добывать не двигаясь.
 * Поддерживает работу в чужой комнате через creep.memory.targetRoom.
 *
 * Исправления vs оригинал:
 *   - убран глобальный экспорт `module.exports = roleMiner = {...}`
 *   - добавлена проверка на null после Game.getObjectById (контейнер мог быть уничтожен)
 *   - при потере контейнера память сбрасывается и крип ищет новый
 */
module.exports = {
  run: function (creep) {
    // Переход в целевую комнату если нужно
    if (
      creep.memory.targetRoom &&
      creep.memory.targetRoom !== creep.room.name
    ) {
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      creep.moveTo(exit);
      return;
    }

    // Поиск свободного контейнера если ещё не закреплён
    if (!creep.memory.containerId) {
      this._assignContainer(creep);
    }

    if (!creep.memory.containerId) {
      // Контейнеров нет вообще — просто копаем ближайший источник
      const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
      if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
      }
      return;
    }

    const container = Game.getObjectById(creep.memory.containerId);

    // Контейнер уничтожен — сбрасываем и найдём новый на следующем тике
    if (!container) {
      creep.memory.containerId = null;
      return;
    }

    if (!creep.pos.isEqualTo(container.pos)) {
      creep.moveTo(container, { reusePath: 20 });
    } else {
      const source = container.pos.findInRange(FIND_SOURCES, 1)[0];
      if (source) creep.harvest(source);
    }
  },

  _assignContainer: function (creep) {
    const sources = creep.room.find(FIND_SOURCES);
    for (const source of sources) {
      const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
      });
      for (const container of containers) {
        const occupied = _.some(
          Game.creeps,
          c =>
            c.memory.role === "miner" && c.memory.containerId === container.id,
        );
        if (!occupied) {
          creep.memory.containerId = container.id;
          return;
        }
      }
    }
  },
};
