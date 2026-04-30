/**
 * ===================================================
 * ROLE.MINER.JS — Статичный майнер (оптимизированный)
 * ===================================================
 * Стратегия: крип находит контейнер рядом с источником,
 * встаёт на него и копает не двигаясь.
 *
 * Оптимизации:
 * - sourceId кэшируется в память — findInRange не вызывается каждый тик
 * - containerId кэшируется в память — поиск выполняется только один раз
 * - Когда крип стоит на месте — только harvest(source), минимум CPU
 *
 * Память крипа (creep.memory):
 * - containerId  {string|null} — ID контейнера на котором работает
 * - sourceId     {string|null} — ID источника рядом с контейнером
 * - sourceIndex  {number}      — запасной индекс источника
 * - targetRoom   {string}      — если нужно работать в другой комнате
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    /**
     * 1. ПЕРЕХОД В ДРУГУЮ КОМНАТУ
     */
    if (
      creep.memory.targetRoom &&
      creep.memory.targetRoom !== creep.room.name
    ) {
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      creep.moveTo(exit, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    /**
     * 2. ПОИСК И БРОНИРОВАНИЕ КОНТЕЙНЕРА
     * Выполняется только один раз — пока containerId не найден.
     */
    if (!creep.memory.containerId) {
      const takenContainerIds = new Set();
      for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (
          c.id !== creep.id &&
          (c.memory.role === "test_miner" || c.memory.role === "miner") &&
          c.memory.containerId
        ) {
          takenContainerIds.add(c.memory.containerId);
        }
      }

      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES);

      for (const source of sources) {
        const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: s => s.structureType === STRUCTURE_CONTAINER,
        });

        for (const container of containers) {
          if (!takenContainerIds.has(container.id)) {
            creep.memory.containerId = container.id;
            // Сразу кэшируем sourceId — больше не нужен findInRange каждый тик
            creep.memory.sourceId = source.id;
            break;
          }
        }

        if (creep.memory.containerId) break;
      }
    }

    /**
     * 3. ОСНОВНАЯ ЛОГИКА РАБОТЫ
     */
    if (creep.memory.containerId) {
      const container = Game.getObjectById(creep.memory.containerId);

      if (!container) {
        // Контейнер разрушен — сбрасываем оба кэша
        delete creep.memory.containerId;
        delete creep.memory.sourceId;
        return;
      }

      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container, {
          reusePath: 10,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
      } else {
        // Берём source из кэша — никаких find() каждый тик
        const source = Game.getObjectById(creep.memory.sourceId);
        if (source) {
          creep.harvest(source);
        } else {
          // source исчез (редко) — сбрасываем кэш
          delete creep.memory.sourceId;
        }
      }
    } else {
      /**
       * 4. ЗАПАСНОЙ ВАРИАНТ — контейнеров нет или все заняты
       */
      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES);

      const mySource =
        sources[creep.memory.sourceIndex] ||
        creep.pos.findClosestByRange(sources);

      if (mySource) {
        if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(mySource, {
            reusePath: 10,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
      }
    }
  },
};
