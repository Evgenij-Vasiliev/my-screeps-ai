/**
 * ===================================================
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен и терминала
 * ===================================================
 * Основная задача: Storage → Башни
 * Дополнительная: Storage → Терминал (когда башни полны)
 *
 * Терминал нужна энергия для оплаты торговых транзакций.
 * Держим в терминале минимум TERMINAL_ENERGY_MIN энергии.
 *
 * Память крипа (creep.memory):
 * - working     {boolean} — false = сбор, true = доставка
 * - sourceIndex {number}  — индекс контейнера (запасной источник)
 * ===================================================
 */

const TERMINAL_ENERGY_MIN = 20000; // минимум энергии в терминале

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // ── 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ ──────────────────────────────────────────

    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("⚡ везу");
    }

    // ── 2. РЕЖИМ СБОРА: берём из Storage ──────────────────────────────────

    if (!creep.memory.working) {
      const storage = creep.room.storage;
      const MIN_STORAGE_ENERGY = creep.room.memory.minStorageEnergy || 5000;

      if (storage && storage.store[RESOURCE_ENERGY] > MIN_STORAGE_ENERGY) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Storage пуст — берём из контейнера
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

      creep.say("⏳ нет энергии");
      return;
    }

    // ── 3. РЕЖИМ ДОСТАВКИ ─────────────────────────────────────────────────

    // Приоритет 1: башни — главная задача
    const towers = creep.room._towers || [];
    const needyTowers = towers.filter(
      t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    );

    if (needyTowers.length > 0) {
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
      return;
    }

    // Приоритет 2: терминал — подкачиваем энергию для торговли
    // Только если башни полны и в терминале меньше минимума
    const terminal = creep.room.terminal;

    if (
      terminal &&
      terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN &&
      terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.say("💱 терминал");
      if (creep.transfer(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#00ffff" },
        });
      }
      return;
    }

    // Всё полно — ждём
    creep.say("💤 полно");
  },
};
