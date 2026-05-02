/**
 * ===================================================
 * ROLE.BUILDER.JS — Строитель
 * ===================================================
 * Стратегия: находит стройплощадку, строит её до конца,
 * затем переходит к следующей. Если строек нет —
 * переключается в режим харвестера (апгрейд контроллера).
 *
 * Память крипа (creep.memory):
 * - working       {boolean}     — false = сбор, true = стройка
 * - buildTargetId {string|null} — ID текущей стройплощадки
 * - sourceIndex   {number}      — индекс "своего" источника
 * - targetRoom    {string}      — целевая комната (если нужно)
 * ===================================================
 */

const roleHarvester = require("./role.harvester");

module.exports = {
  run: function (creep) {
    /**
     * 1. ПЕРЕХОД В ДРУГУЮ КОМНАТУ
     * Если задана целевая комната и мы ещё не там —
     * двигаемся к центру целевой комнаты.
     * reusePath: 5 — не пересчитываем маршрут каждый тик.
     */
    if (
      creep.memory.targetRoom &&
      creep.room.name !== creep.memory.targetRoom
    ) {
      const exitPos = new RoomPosition(25, 25, creep.memory.targetRoom);
      creep.moveTo(exitPos, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    /**
     * 2. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     *
     * При переключении на сбор — сбрасываем buildTargetId.
     * Это важно: стройплощадка могла быть достроена или
     * отменена пока крип нёс энергию.
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      delete creep.memory.buildTargetId; // сбрасываем цель стройки
      // creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      // creep.say("🚧 строю");
    }

    /**
     * 3. РЕЖИМ СТРОЙКИ
     */
    if (creep.memory.working) {
      /**
       * Берём цель из памяти (не ищем каждый тик).
       * Если цель исчезла (достроена/отменена) — ищем новую.
       *
       * findClosestByRange дешевле findClosestByPath —
       * не строит полный маршрут, только считает расстояние.
       */
      let target = Game.getObjectById(creep.memory.buildTargetId);

      if (!target) {
        target = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
        if (target) {
          // Запоминаем ID — следующий тик возьмём из памяти без поиска
          creep.memory.buildTargetId = target.id;
        }
      }

      if (target) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
      } else {
        /**
         * Строек нет — переключаемся в режим харвестера.
         * roleHarvester.run() уже использует кэш комнаты —
         * лишних find() не будет.
         *
         * Типичная ситуация: все постройки завершены,
         * строитель временно помогает качать контроллер.
         */
        // creep.say("💤 нет строек");
        roleHarvester.run(creep);
      }
    } else {
      /**
       * 4. РЕЖИМ СБОРА
       *
       * Приоритет:
       * 1. Упавшая энергия рядом с источником
       * 2. Контейнер у источника (через кэш)
       * 3. Копаем сами
       *
       * ИСПРАВЛЕНИЕ: заменили find(FIND_SOURCES) на кэш из roomManager.
       * ИСПРАВЛЕНИЕ: заменили findInRange(FIND_STRUCTURES) на _sourceContainers.
       */

      // Источник из кэша комнаты (бесплатно)
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
       * Приоритет 2: контейнер (через кэш roomManager).
       * _sourceContainers[index] — контейнер у "нашего" источника.
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
