/**
 * ЛОГИКА РАЗГРУЗЧИКА ТЕРМИНАЛА (TerminalUnloader Role)
 * Перекладывает ресурсы по очереди terminalNeeds: storage → terminal.
 * Также разгружает терминал обратно в storage если нет задач.
 */

const TERMINAL_ENERGY_OVERFLOW = 50000;
const STORAGE_ENERGY_MIN = 5000;

module.exports = {
  run: function (creep) {
    if (!creep.room.terminal || !creep.room.storage) return;

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;

    // Сброс если несём но store пустой — защита от зависания
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.resource;
      delete creep.memory.task;
      delete creep.memory.transferred;
    }

    if (!creep.memory.working && creep.store.getUsedCapacity() > 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working && creep.store.getUsedCapacity() === 0) {
      delete creep.memory.task;
      delete creep.memory.resource;
      delete creep.memory.transferred;
    }

    // ── ЗАГРУЗКА ─────────────────────────────────────────────────────────
    if (!creep.memory.working) {
      // 1. Энергия переполнена в терминале → везём в storage
      const termEnergy = terminal.store[RESOURCE_ENERGY] || 0;
      const storEnergy = storage.store[RESOURCE_ENERGY] || 0;

      if (
        termEnergy > TERMINAL_ENERGY_OVERFLOW &&
        storEnergy < STORAGE_ENERGY_MIN
      ) {
        const amount = Math.min(
          termEnergy - TERMINAL_ENERGY_OVERFLOW,
          creep.store.getFreeCapacity(),
        );
        creep.memory.task = "energy_to_storage";
        creep.memory.resource = RESOURCE_ENERGY;
        const r = creep.withdraw(terminal, RESOURCE_ENERGY, amount);
        if (r === ERR_NOT_IN_RANGE) creep.moveTo(terminal, { reusePath: 5 });
        if (r === OK) creep.memory.working = true;
        return;
      }

      // 2. Очередь terminalNeeds → storage → terminal
      const needs = creep.room.memory.terminalNeeds;
      if (needs && needs.length > 0) {
        const need = needs[0];
        const inStorage = storage.store[need.resource] || 0;

        if (!creep.memory.transferred) creep.memory.transferred = 0;
        const remaining = need.amount - creep.memory.transferred;

        if (remaining <= 0) {
          console.log(
            `[TerminalUnloader] ✅ ${creep.room.name}: ${need.resource} → terminal`,
          );
          creep.room.memory.terminalNeeds = needs.slice(1);
          delete creep.memory.transferred;
          delete creep.memory.resource;
          delete creep.memory.task;
          return;
        }

        if (inStorage === 0) {
          creep.room.memory.terminalNeeds = needs.slice(1);
          delete creep.memory.transferred;
          return;
        }

        const amount = Math.min(
          remaining,
          inStorage,
          creep.store.getFreeCapacity(),
        );
        creep.memory.resource = need.resource;
        creep.memory.task = "load_terminal";

        const r = creep.withdraw(storage, need.resource, amount);
        if (r === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 5 });
        if (r === OK) creep.memory.working = true;
        return;
      }

      // 3. Терминал → storage (лишние ресурсы без задачи)
      const resource = Object.keys(terminal.store).find(
        r => r !== RESOURCE_ENERGY && terminal.store[r] > 0,
      );
      if (!resource) return;

      creep.memory.resource = resource;
      creep.memory.task = "unload_terminal";
      const amount = Math.min(
        terminal.store[resource],
        creep.store.getFreeCapacity(),
      );
      const r = creep.withdraw(terminal, resource, amount);
      if (r === ERR_NOT_IN_RANGE) creep.moveTo(terminal, { reusePath: 5 });
      if (r === OK) creep.memory.working = true;
    } else {
      // ── ДОСТАВКА ───────────────────────────────────────────────────────

      if (creep.store.getUsedCapacity() === 0) {
        creep.memory.working = false;
        delete creep.memory.resource;
        delete creep.memory.task;
        delete creep.memory.transferred;
        return;
      }

      if (creep.memory.task === "energy_to_storage") {
        const r = creep.transfer(storage, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 5 });
        if (r === OK) creep.memory.working = false;
        return;
      }

      if (creep.memory.task === "load_terminal") {
        const r = creep.transfer(terminal, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE) creep.moveTo(terminal, { reusePath: 5 });
        if (r === OK) {
          const delivered =
            creep.store[creep.memory.resource] || creep.store.getUsedCapacity();
          creep.memory.transferred =
            (creep.memory.transferred || 0) + delivered;
          creep.memory.working = false;
        }
        return;
      }

      if (creep.memory.task === "unload_terminal") {
        const r = creep.transfer(storage, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 5 });
        if (r === OK) {
          creep.memory.working = false;
          delete creep.memory.resource;
          delete creep.memory.task;
        }
        return;
      }

      // Неизвестная задача — сброс
      creep.memory.working = false;
      delete creep.memory.task;
      delete creep.memory.resource;
      delete creep.memory.transferred;
    }
  },
};
