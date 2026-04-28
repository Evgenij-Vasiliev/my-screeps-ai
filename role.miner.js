/**
 * ===================================================
 * ROLE.MINER.JS — Статичный майнер
 * ===================================================
 * Стратегия: крип находит контейнер рядом с источником,
 * встаёт на него и копает не двигаясь.
 *
 * Почему это эффективно:
 * - Крип не тратит ходы на перемещение с энергией
 * - Энергия падает прямо в контейнер под ним
 * - Hauler забирает из контейнера отдельно
 *
 * Память крипа (creep.memory):
 * - containerId  {string|null} — ID контейнера на котором работает
 * - sourceIndex  {number}      — запасной индекс источника
 * - targetRoom   {string}      — если нужно работать в другой комнате
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    /**
     * 1. ПЕРЕХОД В ДРУГУЮ КОМНАТУ
     * Если в памяти указана целевая комната и мы ещё не там —
     * двигаемся к выходу из текущей комнаты.
     */
    if (
      creep.memory.targetRoom &&
      creep.memory.targetRoom !== creep.room.name
    ) {
      const exitDir = creep.room.findExitTo(creep.memory.targetRoom);
      const exit = creep.pos.findClosestByRange(exitDir);
      creep.moveTo(exit, {
        reusePath: 5, // переиспользуем маршрут 5 тиков — экономим CPU
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    /**
     * 2. ПОИСК И БРОНИРОВАНИЕ КОНТЕЙНЕРА
     *
     * Выполняется только один раз — пока containerId не найден.
     * После нахождения containerId записывается в память и
     * этот блок больше не выполняется.
     *
     * ИСПРАВЛЕНИЕ: заменили _.filter(Game.creeps, ...) на простой цикл.
     * _.filter перебирает ВСЕХ крипов каждый тик — дорого по CPU.
     * Теперь собираем занятые контейнеры один раз и проверяем по ним.
     *
     * ИСПРАВЛЕНИЕ: радиус поиска 1 → 2.
     * Контейнеры часто строят на расстоянии 2 от источника
     * чтобы не блокировать клетки для добычи.
     */
    if (!creep.memory.containerId) {
      // Собираем список уже занятых контейнеров (один проход по всем крипам)
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

      // Берём ID источников из кэша комнаты (бесплатно, уже найдено roomManager)
      // Если кэша нет — делаем find() как запасной вариант
      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES);

      // Перебираем источники и ищем свободный контейнер рядом
      for (const source of sources) {
        const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: s => s.structureType === STRUCTURE_CONTAINER,
        });

        for (const container of containers) {
          // Контейнер свободен если его нет в списке занятых
          if (!takenContainerIds.has(container.id)) {
            creep.memory.containerId = container.id;
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
        // Контейнер разрушен — сбрасываем, в следующем тике найдём новый
        delete creep.memory.containerId;
        return;
      }

      if (!creep.pos.isEqualTo(container.pos)) {
        /**
         * Идём на клетку контейнера.
         * reusePath: 10 — не пересчитываем маршрут каждый тик,
         * а переиспользуем 10 тиков. Майнер идёт к одной точке —
         * маршрут не изменится, экономим CPU.
         */
        creep.moveTo(container, {
          reusePath: 10,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
      } else {
        // Стоим на контейнере — ищем источник рядом и копаем
        // findInRange дешевле чем find по всей комнате
        const source = container.pos.findInRange(FIND_SOURCES, 2)[0];
        if (source) {
          creep.harvest(source);
          // Крип будет копать автоматически каждый тик пока стоит здесь.
          // Энергия падает в контейнер под ним.
        }
      }
    } else {
      /**
       * 4. ЗАПАСНОЙ ВАРИАНТ — контейнеров нет или все заняты
       *
       * Используем sourceIndex из памяти (выдан factory.js при спавне)
       * или просто идём к ближайшему источнику.
       * Это временное поведение — на старте до постройки контейнеров.
       */
      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES);

      const mySource =
        sources[creep.memory.sourceIndex] ||
        creep.pos.findClosestByRange(FIND_SOURCES);

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
