/**
 * ===================================================
 * ROLE.HARVESTER.JS — Универсальный харвестер
 * ===================================================
 * Используется на старте или как резерв когда майнеров нет.
 * Сам копает энергию и сам её доставляет.
 *
 * Отличие от связки miner+hauler:
 * - Менее эффективен (тратит ходы и на копку и на доставку)
 * - Но работает без инфраструктуры (контейнеры не нужны)
 *
 * Память крипа (creep.memory):
 * - working     {boolean} — false = сбор, true = доставка
 * - sourceIndex {number}  — индекс "своего" источника
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     *
     * Единый стиль с другими ролями.
     * Инициализация working не нужна — в factory.js
     * уже выставляется working: false по умолчанию.
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 везу");
    }

    /**
     * 2. РЕЖИМ СБОРА
     *
     * Приоритет:
     * 1. Подобрать упавшую энергию рядом с источником
     * 2. Взять из контейнера (через кэш roomManager)
     * 3. Копать самому
     */
    if (!creep.memory.working) {
      // Берём источник из кэша комнаты (бесплатно, уже найдено roomManager)
      // Защита: если кэша нет — делаем find() как запасной вариант
      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES);

      const mySource = sources[creep.memory.sourceIndex] || sources[0];
      if (!mySource) return;

      /**
       * Приоритет 1: упавшая энергия рядом с источником.
       * Майнер добывает больше чем влезает в контейнер —
       * эта энергия иначе просто исчезнет через 1000 тиков.
       * Берём только если там больше 50 единиц — не гонимся за крошками.
       */
      const dropped = mySource.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      })[0];

      if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          creep.moveTo(dropped, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      /**
       * Приоритет 2: контейнер у источника.
       * Берём из кэша _sourceContainers — это бесплатно.
       * ИСПРАВЛЕНИЕ: раньше делали find() по всей комнате каждый тик.
       */
      const containers = creep.room._sourceContainers || [];
      const myContainer = containers[creep.memory.sourceIndex] || null;

      if (myContainer && myContainer.store[RESOURCE_ENERGY] > 50) {
        if (creep.withdraw(myContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(myContainer, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      /**
       * Приоритет 3: копаем сами.
       * Это основной режим харвестера на старте
       * до постройки контейнеров.
       */
      if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(mySource, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
      }
    } else {
      /**
       * 3. РЕЖИМ ДОСТАВКИ
       *
       * Приоритет (от важного к менее важному):
       * 1. Спавн и расширения — без них колония не растёт
       * 2. Storage — долгосрочный запас
       * 3. Terminal — для торговли (в последнюю очередь)
       *
       * ИСПРАВЛЕНИЕ: раньше было два отдельных find() для extensions
       * и spawn — два дорогих поиска по всей комнате каждый тик.
       * Теперь используем _energyTargets из roomManager —
       * там уже есть и спавны и расширения вместе, бесплатно.
       *
       * ИСПРАВЛЕНИЕ: terminal идёт после storage, не до.
       */
      let target = null;

      /**
       * Приоритет 1: спавн и расширения.
       * _energyTargets — кэш из roomManager, содержит только
       * незаполненные спавны и расширения. Уже отфильтровано.
       */
      const spawnTargets = creep.room._energyTargets;
      if (spawnTargets && spawnTargets.length > 0) {
        target = creep.pos.findClosestByRange(spawnTargets);
      }

      /**
       * Приоритет 2: Storage.
       * Появляется на RCL4. Главное долгосрочное хранилище.
       */
      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
      }

      /**
       * Приоритет 3: Terminal.
       * Появляется на RCL6. Нужен для торговли.
       * Заполняем только до лимита.
       */
      const terminalLimit = creep.room.memory.terminalEnergyTarget || 10000;
      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store[RESOURCE_ENERGY] < terminalLimit
      ) {
        target = creep.room.terminal;
      }

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        creep.say("😴 всё полно");
      }
    }
  },
};
