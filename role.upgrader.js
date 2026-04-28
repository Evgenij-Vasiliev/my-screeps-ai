/**
 * ===================================================
 * ROLE.UPGRADER.JS — Апгрейдер контроллера
 * ===================================================
 * Стратегия: качает контроллер комнаты энергией.
 * Чем выше уровень контроллера (RCL) — тем больше
 * структур можно строить.
 *
 * ВАЖНО про источники энергии:
 * Апгрейдер НЕ берёт энергию из контейнеров у источников —
 * это зона майнеров и хаулеров. Конкуренция за эти контейнеры
 * нарушает работу всей цепочки добычи.
 *
 * Правильный порядок источников для апгрейдера:
 * 1. Контейнер рядом с контроллером (если есть)
 * 2. Storage комнаты
 * 3. Копает сам (только если нет инфраструктуры)
 *
 * Память крипа (creep.memory):
 * - working           {boolean}     — false = сбор, true = апгрейд
 * - upgradeContainerId {string|null} — ID контейнера у контроллера
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("⚡ качаю");
    }

    /**
     * 2. РЕЖИМ СБОРА
     *
     * ИСПРАВЛЕНИЕ: апгрейдер больше не берёт из контейнеров у источников.
     * Теперь ищет энергию в правильном порядке:
     * контейнер у контроллера → storage → копает сам.
     */
    if (!creep.memory.working) {
      /**
       * Приоритет 1: контейнер рядом с контроллером.
       * Часто игроки ставят контейнер в 1-2 клетках от контроллера
       * специально для апгрейдеров — они стоят там и качают не двигаясь.
       *
       * Кэшируем ID в память — не ищем каждый тик.
       */
      const controller = creep.room.controller;

      if (!creep.memory.upgradeContainerId) {
        const upgradeContainer = controller.pos.findInRange(
          FIND_STRUCTURES,
          3,
          {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          },
        )[0];

        // Сохраняем навсегда — контейнер у контроллера не переносят
        creep.memory.upgradeContainerId = upgradeContainer
          ? upgradeContainer.id
          : null;
      }

      const upgradeContainer = creep.memory.upgradeContainerId
        ? Game.getObjectById(creep.memory.upgradeContainerId)
        : null;

      // Контейнер разрушен — сбрасываем кэш
      if (creep.memory.upgradeContainerId && !upgradeContainer) {
        delete creep.memory.upgradeContainerId;
      }

      if (upgradeContainer && upgradeContainer.store[RESOURCE_ENERGY] > 50) {
        if (
          creep.withdraw(upgradeContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(upgradeContainer, {
            reusePath: 10,
            visualizePathStyle: { stroke: "#4b0082" },
          });
        }
        return;
      }

      /**
       * Приоритет 2: Storage.
       * Главное долгосрочное хранилище комнаты (RCL4+).
       * Апгрейдер — главный потребитель энергии из storage.
       */
      if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
        if (
          creep.withdraw(creep.room.storage, RESOURCE_ENERGY) ===
          ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(creep.room.storage, {
            reusePath: 10,
            visualizePathStyle: { stroke: "#4b0082" },
          });
        }
        return;
      }

      /**
       * Приоритет 3: копаем сами.
       * Только если нет ни контейнера у контроллера, ни storage.
       * Типичная ситуация: самое начало игры.
       *
       * Берём источник из кэша комнаты (бесплатно).
       */
      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES);

      const mySource = sources[creep.memory.sourceIndex] || sources[0];

      if (mySource) {
        if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(mySource, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#4b0082" },
          });
        }
      }
    } else {
      /**
       * 3. РЕЖИМ АПГРЕЙДА
       *
       * upgradeController() можно вызывать с расстояния 3 клеток.
       * Апгрейдер не обязан стоять вплотную к контроллеру.
       *
       * reusePath: 20 — путь к контроллеру никогда не меняется,
       * можно кэшировать надолго.
       */
      const controller = creep.room.controller;

      if (!controller) return; // защита: вдруг крип в нейтральной комнате

      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, {
          reusePath: 20,
          visualizePathStyle: { stroke: "#4b0082" },
        });
      }
    }
  },
};
