/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Двусторонний логист терминала
 * ===================================================
 * Логика (в порядке приоритета):
 *
 * 1. ТЕРМИНАЛ → STORAGE (энергия):
 *    Если терминал переполнен энергией (> 50000)
 *    и Storage почти пуст (< 10000).
 *
 * 2. STORAGE → ТЕРМИНАЛ (очередь terminalNeeds):
 *    Обрабатывает запросы из room.memory.terminalNeeds.
 *    toRoom === "_sell_" означает "перенести в терминал для продажи"
 *    (запрос создаётся terminalManager когда K/U/L/H мало в терминале).
 *    toRoom === реальная комната — перенести для отправки через terminal.send().
 *
 * 3. ТЕРМИНАЛ → STORAGE (разгрузка не-энергетических ресурсов):
 *    Если очередь пуста — разгружаем терминал в storage.
 *
 * ИСПРАВЛЕНО v4:
 * - Запросы с toRoom === "_sell_" теперь обрабатываются корректно:
 *   крип переносит ресурс из storage в терминал.
 *   Раньше такие запросы создавались но никогда не выполнялись —
 *   крип не знал что "_sell_" это тоже задача загрузки терминала.
 * ===================================================
 */

const TERMINAL_ENERGY_OVERFLOW = 50000;
const STORAGE_ENERGY_MIN = 10000;

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;

    if (!terminal || !storage) {
      creep.say("❌ нет структур");
      return;
    }

    // Переключение режима
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.resource;
      delete creep.memory.task;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // ── ПРИОРИТЕТ 1: ЭНЕРГИЯ ИЗ ТЕРМИНАЛА → STORAGE ──────────────────
      const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;
      const storageEnergy = storage.store[RESOURCE_ENERGY] || 0;

      if (
        terminalEnergy > TERMINAL_ENERGY_OVERFLOW &&
        storageEnergy < STORAGE_ENERGY_MIN &&
        storage.store.getFreeCapacity() > 0
      ) {
        creep.memory.resource = RESOURCE_ENERGY;
        creep.memory.task = "energy_to_storage";

        const amount = Math.min(
          terminalEnergy - TERMINAL_ENERGY_OVERFLOW,
          creep.store.getFreeCapacity(),
        );

        const result = creep.withdraw(terminal, RESOURCE_ENERGY, amount);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        if (result === OK) creep.memory.working = true;
        return;
      }

      // ── ПРИОРИТЕТ 2: STORAGE → ТЕРМИНАЛ (очередь terminalNeeds) ──────
      // Обрабатываем ВСЕ запросы включая toRoom === "_sell_".
      // "_sell_" — запрос от terminalManager на подготовку минерала к продаже.
      // Логика одинакова: берём из storage, кладём в терминал.
      const needs = creep.room.memory.terminalNeeds;
      if (needs && needs.length > 0) {
        const need = needs[0];
        const inStorage = storage.store[need.resource] || 0;

        if (!creep.memory.transferred) creep.memory.transferred = 0;

        const remaining = need.amount - creep.memory.transferred;

        if (remaining <= 0) {
          console.log(
            `[TerminalUnloader ${creep.room.name}] ✅ ` +
              `${need.resource} перенесён в терминал (${need.amount} ед.) → ${need.toRoom}`,
          );
          creep.room.memory.terminalNeeds = needs.slice(1);
          delete creep.memory.transferred;
          delete creep.memory.resource;
          delete creep.memory.task;
          return;
        }

        if (inStorage === 0) {
          console.log(
            `[TerminalUnloader ${creep.room.name}] ` +
              `Нет ${need.resource} в storage — удаляем запрос`,
          );
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

        const result = creep.withdraw(storage, need.resource, amount);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
        if (result === OK) creep.memory.working = true;
        return;
      }

      // ── ПРИОРИТЕТ 3: ТЕРМИНАЛ → STORAGE (не-энергетические) ─────────
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

      const result = creep.withdraw(terminal, resource, amount);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ff8800" },
        });
      }
      if (result === OK) creep.memory.working = true;
    } else {
      // ── ДОСТАВКА ──────────────────────────────────────────────────────

      // Энергия из терминала → Storage
      if (creep.memory.task === "energy_to_storage") {
        const result = creep.transfer(storage, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        if (result === OK) creep.memory.working = false;
        return;
      }

      // Storage → Терминал (включая "_sell_" запросы)
      if (creep.memory.task === "load_terminal") {
        const result = creep.transfer(terminal, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
        if (result === OK) {
          const delivered =
            creep.store[creep.memory.resource] || creep.store.getUsedCapacity();
          creep.memory.transferred =
            (creep.memory.transferred || 0) + delivered;
          creep.memory.working = false;
        }
        return;
      }

      // Терминал → Storage (не-энергетические)
      if (creep.memory.task === "unload_terminal") {
        const result = creep.transfer(storage, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        if (result === OK) {
          creep.memory.working = false;
          delete creep.memory.resource;
          delete creep.memory.task;
        }
      }
    }
  },
};
