/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Разгрузчик терминала
 * ===================================================
 * VERSION: 2.0
 *
 * Направление управляется из консоли:
 *   Memory.rooms["E35S37"].terminalMode = "toTerminal" // storage → terminal
 *   Memory.rooms["E35S37"].terminalMode = "toStorage"  // terminal → storage
 *
 * По умолчанию: toTerminal
 *
 * Очередь задач через terminalNeeds остаётся для автоматики.
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep.room.terminal || !creep.room.storage) return;

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;
    const mode = (creep.room.memory || {}).terminalMode || "toTerminal";

    // ── ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЯ ────────────────────────────────────────────
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getUsedCapacity() > 0) {
      creep.memory.working = true;
    }

    // ── ЗАГРУЗКА ──────────────────────────────────────────────────────────
    if (!creep.memory.working) {
      // Ручной режим: terminal → storage
      if (mode === "toStorage") {
        const amount = Math.min(
          terminal.store[RESOURCE_ENERGY] || 0,
          creep.store.getFreeCapacity(),
        );
        if (amount <= 0) return;
        creep.memory.task = "toStorage";
        if (
          creep.withdraw(terminal, RESOURCE_ENERGY, amount) === ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(terminal, { reusePath: 5 });
        }
        return;
      }

      // Очередь terminalNeeds: storage → terminal
      const needs = creep.room.memory.terminalNeeds;
      if (needs && needs.length > 0) {
        const need = needs[0];
        const inStorage = storage.store[need.resource] || 0;

        if (!creep.memory.transferred) creep.memory.transferred = 0;
        const remaining = need.amount - creep.memory.transferred;

        if (remaining <= 0 || inStorage === 0) {
          creep.room.memory.terminalNeeds = needs.slice(1);
          delete creep.memory.transferred;
          delete creep.memory.resource;
          delete creep.memory.task;
          return;
        }

        const amount = Math.min(
          remaining,
          inStorage,
          creep.store.getFreeCapacity(),
        );
        creep.memory.resource = need.resource;
        creep.memory.task = "toTerminal";
        if (
          creep.withdraw(storage, need.resource, amount) === ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(storage, { reusePath: 5 });
        }
        return;
      }

      // Режим по умолчанию: terminal → storage (лишние минералы)
      const resource = Object.keys(terminal.store).find(
        r => r !== RESOURCE_ENERGY && terminal.store[r] > 0,
      );
      if (!resource) return;

      creep.memory.resource = resource;
      creep.memory.task = "toStorage";
      const amount = Math.min(
        terminal.store[resource],
        creep.store.getFreeCapacity(),
      );
      if (creep.withdraw(terminal, resource, amount) === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, { reusePath: 5 });
      }
      return;
    }

    // ── ДОСТАВКА ──────────────────────────────────────────────────────────
    if (creep.memory.task === "toStorage") {
      const resource = Object.keys(creep.store).find(r => creep.store[r] > 0);
      if (!resource) {
        creep.memory.working = false;
        return;
      }
      if (creep.transfer(storage, resource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 5 });
      }
      return;
    }

    if (creep.memory.task === "toTerminal") {
      const r = creep.transfer(terminal, creep.memory.resource);
      if (r === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, { reusePath: 5 });
        return;
      }
      if (r === OK) {
        creep.memory.transferred =
          (creep.memory.transferred || 0) + creep.store.getUsedCapacity();
        creep.memory.working = false;
      }
      return;
    }

    creep.memory.working = false;
    delete creep.memory.task;
    delete creep.memory.resource;
    delete creep.memory.transferred;
  },
};
