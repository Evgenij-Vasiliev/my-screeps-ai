/**
 * ===================================================
 * ROLE.REPAIRER.JS — Ремонтник
 * ===================================================
 * Стратегия: ищет повреждённые структуры и чинит их.
 * Игнорирует стены и рампарты (их чинят отдельно).
 * Если всё починено — переключается в режим строителя.
 *
 * Память крипа (creep.memory):
 * - working        {boolean}     — false = сбор, true = ремонт
 * - repairTargetId {string|null} — ID текущей цели ремонта
 * - sourceIndex    {number}      — индекс "своего" источника
 * ===================================================
 */

const roleBuilder = require("./role.builder");

module.exports = {
  run: function (creep) {
    /**
     * 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     *
     * При переходе на сбор сбрасываем repairTargetId —
     * цель могла быть починена пока крип ходил за энергией.
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      delete creep.memory.repairTargetId;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🔧 чиню");
    }

    /**
     * 2. РЕЖИМ РЕМОНТА
     */
    if (creep.memory.working) {
      /**
       * Берём цель из памяти — не ищем каждый тик.
       * Проверяем что цель ещё существует и не починена полностью.
       */
      let target = null;

      if (creep.memory.repairTargetId) {
        target = Game.getObjectById(creep.memory.repairTargetId);

        // Цель исчезла или полностью починена — сбрасываем
        if (!target || target.hits === target.hitsMax) {
          target = null;
          delete creep.memory.repairTargetId;
        }
      }

      // Цели нет в памяти — ищем новую
      if (!target) {
        /**
         * findClosestByRange дешевле findClosestByPath —
         * не строит полный маршрут, только считает расстояние.
         *
         * Стены и рампарты исключаем — у них hitsMax в миллионы,
         * ремонтник будет застревать на них навсегда.
         */
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        });

        if (target) {
          creep.memory.repairTargetId = target.id;
        }
      }

      if (target) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 10,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
      } else {
        /**
         * Всё починено — переключаемся в строителя.
         * roleBuilder уже использует кэш комнаты — лишних find() не будет.
         */
        creep.say("✅ всё цело");
        roleBuilder.run(creep);
      }
    } else {
      /**
       * 3. РЕЖИМ СБОРА
       *
       * Приоритет:
       * 1. Упавшая энергия рядом с источником
       * 2. Контейнер у источника (через кэш)
       * 3. Копаем сами
       *
       * ИСПРАВЛЕНИЕ: заменили find(FIND_SOURCES) на кэш.
       * ИСПРАВЛЕНИЕ: заменили findInRange(FIND_STRUCTURES) на _sourceContainers.
       * ИСПРАВЛЕНИЕ: добавили reusePath везде.
       */

      // Источник из кэша (бесплатно, уже найдено roomManager)
      const sourceIds = creep.room.memory.sources || [];
      const sources =
        sourceIds.length > 0
          ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
          : creep.room.find(FIND_SOURCES); // запасной вариант

      const mySource = sources[creep.memory.sourceIndex] || sources[0];
      if (!mySource) return;

      /**
       * Приоритет 1: упавшая энергия.
       * Порог 50 — не гонимся за крошками.
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
       * Приоритет 2: контейнер через кэш roomManager.
       * ИСПРАВЛЕНИЕ: раньше делали findInRange(FIND_STRUCTURES) каждый тик.
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
       */
      if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(mySource, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
      }
    }
  },
};
