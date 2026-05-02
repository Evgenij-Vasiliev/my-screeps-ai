/**
 * ===================================================
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен и терминала
 * ===================================================
 *
 * Приоритеты:
 * 1. Башни ниже 30% → заряжаем башни (срочно)
 * 2. Терминал ниже TERMINAL_ENERGY_MIN → заливаем энергию в терминал
 * 3. Всё в порядке → ждём
 *
 * Логика одного рейса:
 * - Определяем задачу → берём энергию из Storage → доставляем → сброс
 * ===================================================
 */

const TERMINAL_ENERGY_MIN = 20000; // минимум энергии в терминале

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const storage = creep.room.storage;
    const towers = creep.room._towers || [];
    const terminal = creep.room.terminal;

    // Переключение режима
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.memory.task = null;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // === СБОР: определяем задачу и берём энергию из Storage ===

      if (!storage || storage.store[RESOURCE_ENERGY] === 0) {
        creep.say("⏳ нет энергии");
        return;
      }

      // Приоритет 1: башня ниже 30%
      const urgentTower = towers.find(
        t =>
          t.store[RESOURCE_ENERGY] < t.store.getCapacity(RESOURCE_ENERGY) * 0.3,
      );

      if (urgentTower) {
        creep.memory.task = "towers";
        const result = creep.withdraw(storage, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Приоритет 2: терминал ниже минимума
      if (
        terminal &&
        terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN &&
        terminal.store.getFreeCapacity() > 0
      ) {
        creep.memory.task = "terminal";
        const amount = Math.min(
          creep.store.getFreeCapacity(),
          TERMINAL_ENERGY_MIN - terminal.store[RESOURCE_ENERGY],
        );
        const result = creep.withdraw(storage, RESOURCE_ENERGY, amount);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Нечего делать
      creep.say("⏳ всё OK");
    } else {
      // === ДОСТАВКА: везём к цели ===

      if (creep.memory.task === "terminal" && terminal) {
        // Везём в терминал
        const result = creep.transfer(terminal, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
        return;
      }

      // Везём в башню (task === "towers" или по умолчанию)
      const needyTowers = towers
        .filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY]);

      if (needyTowers.length === 0) {
        // Башни полные — сбрасываем остаток в Storage
        if (storage && creep.store[RESOURCE_ENERGY] > 0) {
          if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
          }
        }
        return;
      }

      const target = needyTowers[0];
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    }
  },
};
