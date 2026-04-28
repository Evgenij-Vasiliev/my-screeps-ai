/**
 * ===================================================
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен
 * ===================================================
 * Стратегия: берёт энергию из storage (или контейнера)
 * и заправляет башни, начиная с самой пустой.
 *
 * Память крипа (creep.memory):
 * - working     {boolean} — false = сбор, true = заправка башен
 * - sourceIndex {number}  — индекс контейнера (запасной источник)
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    /**
     * 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     *
     * Приведено к единому стилю с другими ролями:
     * - пусто → переходим в режим сбора
     * - полно → переходим в режим заправки
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("⚡ башни");
    }

    /**
     * 2. РЕЖИМ СБОРА
     *
     * Приоритет источников:
     * 1. Storage — если там достаточно энергии
     * 2. Контейнер у источника — запасной вариант
     */
    if (!creep.memory.working) {
      const storage = creep.room.storage;

      // Не трогаем storage если там мало энергии — оставляем для крипов
      // Значение можно настроить через Memory.rooms[roomName].minStorageEnergy
      const MIN_STORAGE_ENERGY = creep.room.memory.minStorageEnergy || 5000;

      /**
       * Приоритет 1: Storage
       * Storage появляется на RCL4 и вмещает до 1 000 000 энергии.
       * Это главный источник для заправщика башен.
       */
      if (storage && storage.store[RESOURCE_ENERGY] > MIN_STORAGE_ENERGY) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      /**
       * Приоритет 2: Контейнер у источника (запасной вариант)
       * Используется если storage пустой или ещё не построен.
       * _sourceContainers — кэш из roomManager, бесплатно.
       */
      const containers = creep.room._sourceContainers || [];
      const myContainer = containers[creep.memory.sourceIndex] || containers[0];

      if (myContainer && myContainer.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(myContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(myContainer, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Нет доступной энергии — ждём на месте
      creep.say("⏳ нет энергии");
    } else {
      /**
       * 3. РЕЖИМ ЗАПРАВКИ БАШЕН
       *
       * Находим башню с наименьшим запасом энергии и заправляем её.
       * Логика "самая пустая первой" гарантирует равномерную заправку.
       *
       * ИСПРАВЛЕНИЕ: заменили _.min(array, iterator) на .sort() —
       * _.min с итератором это синтаксис Lodash 3.x, легко запутаться.
       * .sort() работает везде и читается понятнее.
       */
      const towers = creep.room._towers || [];

      // Фильтруем только незаполненные башни
      const needyTowers = towers.filter(
        t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );

      if (needyTowers.length > 0) {
        // Сортируем по количеству энергии (по возрастанию) — первая = самая пустая
        needyTowers.sort(
          (a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY],
        );
        const targetTower = needyTowers[0];

        if (creep.transfer(targetTower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targetTower, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        /**
         * Все башни полны — ждём на месте.
         * ИСПРАВЛЕНИЕ: убрали поиск спавна через find() каждый тик —
         * это лишний вызов когда крипу просто нечего делать.
         * Крип просто стоит и ждёт пока башни начнут стрелять.
         */
        creep.say("💤 все полны");
      }
    }
  },
};
