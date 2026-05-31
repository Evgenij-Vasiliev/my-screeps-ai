/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Двусторонний логист терминала
 * ===================================================
 * VERSION: 5.2
 *
 * ИЗМЕНЕНИЯ v5.2:
 * - ИСПРАВЛЕН баг устаревшей задачи: когда крип пустой и working=false
 *   task и resource очищаются принудительно. Раньше крип зависал
 *   с task=energy_to_storage но пустым store — условие не выполнялось
 *   и крип стоял на месте.
 * - STORAGE_ENERGY_MIN снижен до 5000 (было 10000).
 *
 * ИЗМЕНЕНИЯ v5.1:
 * - working=true срабатывает если несём хоть что-то (getUsedCapacity > 0).
 *
 * ЛОГИКА (в порядке приоритета):
 * 1. ТЕРМИНАЛ → STORAGE (энергия переполнена > 50000 и storage < 5000)
 * 2. STORAGE → ТЕРМИНАЛ (очередь terminalNeeds, включая "_sell_")
 * 3. ТЕРМИНАЛ → STORAGE (только НЕ-sell ресурсы)
 * ===================================================
 */

const marketManager = require("./marketManager");

const TERMINAL_ENERGY_OVERFLOW = 50000;
const STORAGE_ENERGY_MIN = 5000;

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;

    if (!terminal || !storage) {
      creep.say("❌ нет структур");
      return;
    }

    // ── ПЕРЕКЛЮЧЕНИЕ РЕЖИМА ───────────────────────────────────────────────
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.resource;
      delete creep.memory.task;
    }

    // v5.1: переключаем если несём хоть что-то
    if (!creep.memory.working && creep.store.getUsedCapacity() > 0) {
      creep.memory.working = true;
    }

    // v5.2: если пустой и working=false — очищаем устаревшую задачу
    if (!creep.memory.working && creep.store.getUsedCapacity() === 0) {
      delete creep.memory.task;
      delete creep.memory.resource;
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
      const needs = creep.room.memory.terminalNeeds;
      if (needs && needs.length > 0) {
        const need = needs[0];
        const inStorage = storage.store[need.resource] || 0;

        if (!creep.memory.transferred) creep.memory.transferred = 0;

        const remaining = need.amount - creep.memory.transferred;

        if (remaining <= 0) {
          console.log(
            `[TerminalUnloader ${creep.room.name}] ✅ ` +
              `${need.resource} перенесён в терминал (${need.amount} ед.)` +
              ` → ${need.toRoom || "продажа"}`,
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
      // ВАЖНО: пропускаем ресурсы которые marketManager хочет продать.
      const sellIntents = marketManager.getSellIntents();
      const sellResources = new Set(sellIntents.map(i => i.resource));

      const resource = Object.keys(terminal.store).find(
        r =>
          r !== RESOURCE_ENERGY &&
          terminal.store[r] > 0 &&
          !sellResources.has(r),
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

      // Storage → Терминал (все запросы включая "_sell_")
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

      // Терминал → Storage (не-энергетические, не-sell)
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
