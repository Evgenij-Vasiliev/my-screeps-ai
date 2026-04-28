/**
 * ===================================================
 * ROLE.HAULER.JS — Транспортёр энергии
 * ===================================================
 * Стратегия: забирает энергию из контейнера у источника
 * и везёт её в спавн/расширения → хранилище → терминал.
 *
 * Память крипа (creep.memory):
 * - working     {boolean} — false = сбор, true = доставка
 * - sourceIndex {number}  — индекс "своего" источника
 * ===================================================
 */

const roleHauler = {
  run: function (creep) {
    /**
     * 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     *
     * Хаулер работает как машина состояний с двумя режимами:
     * - working = false → едем за энергией
     * - working = true  → везём энергию на доставку
     *
     * Переключаемся только на границах (пусто/полно),
     * чтобы не метаться туда-обратно каждый тик.
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
     */
    if (!creep.memory.working) {
      // Берём данные из кэша roomManager (бесплатно, уже найдено)
      // Защита: если _sources нет (хаулер в другой комнате) — делаем find()
      const sources = creep.room._sources || creep.room.find(FIND_SOURCES);
      const containers = creep.room._sourceContainers || [];

      const mySource = sources[creep.memory.sourceIndex] || sources[0];
      const myContainer = containers[creep.memory.sourceIndex] || null;

      if (!mySource) {
        creep.say("❓ нет источника");
        return;
      }

      /**
       * Приоритет 1: подбираем упавшую энергию рядом с источником.
       * Это "бесплатная" энергия — майнер добыл больше чем влезло в контейнер.
       * Радиус 2 чтобы не уходить далеко от контейнера.
       */
      const dropped = mySource.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      })[0];

      if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          creep.moveTo(dropped, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return; // return чтобы не выполнять остальные проверки
      }

      /**
       * Приоритет 2: забираем из контейнера.
       * Берём только если там достаточно энергии —
       * не стоит ехать за 50 единицами если везём 300.
       */
      if (myContainer && myContainer.store[RESOURCE_ENERGY] > 50) {
        if (creep.withdraw(myContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(myContainer, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Ни упавшей энергии, ни контейнера — ждём
      creep.say("⏳ жду");
    } else {
      /**
       * 3. РЕЖИМ ДОСТАВКИ
       *
       * Приоритет доставки (от важного к менее важному):
       * 1. Спавн и расширения (Extensions) — без них нет новых крипов!
       * 2. Storage — долгосрочный запас энергии
       * 3. Terminal — для торговли (заполняем последним)
       *
       * ИСПРАВЛЕНИЕ: раньше terminal шёл перед storage — это неверно.
       * Terminal нужен для торговли, а не для выживания колонии.
       */
      let target = null;

      /**
       * Приоритет 1: спавн и расширения.
       * _energyTargets уже отфильтрован в roomManager —
       * там только незаполненные структуры.
       * findClosestByRange дешевле чем findClosestByPath.
       */
      const spawnTargets = creep.room._energyTargets;
      if (spawnTargets && spawnTargets.length > 0) {
        target = creep.pos.findClosestByRange(spawnTargets);
      }

      /**
       * Приоритет 2: хранилище (Storage).
       * Появляется на RCL4. Вмещает 1 000 000 энергии.
       */
      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
      }

      /**
       * Приоритет 3: терминал (Terminal).
       * Появляется на RCL6. Нужен для торговли между комнатами.
       * Заполняем только до лимита из памяти комнаты (по умолчанию 10000).
       */
      const terminalTarget = creep.room.memory.terminalEnergyTarget || 10000;
      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store[RESOURCE_ENERGY] < terminalTarget
      ) {
        target = creep.room.terminal;
      }

      // Доставляем энергию к цели
      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        // Все структуры заполнены — ждём
        creep.say("😴 всё полно");
      }
    }
  },
};

module.exports = roleHauler;
