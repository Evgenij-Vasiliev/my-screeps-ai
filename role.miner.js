/**
 * УНИВЕРСАЛЬНЫЙ МАЙНЕР (Static Miner)
 */
module.exports = {
  run: function (creep) {
    // 1. ДЛЯ РАБОТЫ В ДРУГИХ КОМНАТАХ (как в основной ветке)
    if (
      creep.memory.targetRoom &&
      creep.memory.targetRoom !== creep.room.name
    ) {
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      creep.moveTo(exit);
      return;
    }

    // 2. ПОИСК СВОБОДНОГО КОНТЕЙНЕРА (Динамическое бронирование)
    // Если майнер еще не знает, на каком контейнере он работает
    if (!creep.memory.containerId) {
      const sources = creep.room.find(FIND_SOURCES);
      for (const source of sources) {
        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
          filter: s => s.structureType === STRUCTURE_CONTAINER,
        });

        for (const container of containers) {
          // Проверяем: нет ли другого живого майнера с этим containerId?
          const minersOnContainer = _.filter(
            Game.creeps,
            c =>
              (c.memory.role === "test_miner" || c.memory.role === "miner") &&
              c.memory.containerId === container.id &&
              c.id !== creep.id,
          );

          if (minersOnContainer.length === 0) {
            creep.memory.containerId = container.id;
            break;
          }
        }
        if (creep.memory.containerId) break;
      }
    }

    // 3. ЛОГИКА РАБОТЫ
    if (creep.memory.containerId) {
      const container = Game.getObjectById(creep.memory.containerId);
      if (container) {
        if (!creep.pos.isEqualTo(container.pos)) {
          // Идем строго на контейнер
          creep.moveTo(container, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        } else {
          // Мы на месте — ищем источник рядом с этим контейнером и копаем
          const source = container.pos.findInRange(FIND_SOURCES, 1)[0];
          if (source) {
            creep.harvest(source);
          }
        }
      } else {
        // Если контейнер по этому ID исчез (разрушен) — сбрасываем память
        delete creep.memory.containerId;
      }
    } else {
      // ЗАПАСНОЙ ВАРИАНТ: если контейнеров нет вообще
      // Используем старый добрый sourceIndex или ближайший источник
      const sources = creep.room.find(FIND_SOURCES);
      const mySource =
        sources[creep.memory.sourceIndex] ||
        creep.pos.findClosestByRange(FIND_SOURCES);

      if (mySource) {
        if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(mySource);
        }
      }
    }
  },
};
