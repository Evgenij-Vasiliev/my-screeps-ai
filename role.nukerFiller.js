/**
 * ===================================================
 * ROLE.NUKERFILLER.JS — Заправщик Nuker
 * ===================================================
 * Заправляет Nuker энергией (300,000) и ghodium G (5,000).
 *
 * Приоритеты:
 * 1. G из storage/terminal → Nuker (пока не заполнен)
 * 2. Energy из storage → Nuker (пока не заполнен)
 * 3. Всё заполнено → ждёт
 *
 * Настройка:
 * Крип спавнится автоматически из roomManager
 * когда в комнате есть Nuker и он не заполнен.
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const storage = creep.room.storage;
    const terminal = creep.room.terminal;

    // Ищем Nuker в комнате
    const nuker = creep.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_NUKER,
    })[0];

    if (!nuker) {
      creep.say("❌ нет нукера");
      return;
    }

    // Nuker полностью заряжен — ждём
    const nukerGFree = nuker.store.getFreeCapacity(RESOURCE_GHODIUM);
    const nukerEnergyFree = nuker.store.getFreeCapacity(RESOURCE_ENERGY);

    if (nukerGFree === 0 && nukerEnergyFree === 0) {
      creep.say("✅ заряжен");
      return;
    }

    // Переключение режима
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.resource;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // ── СБОР ──────────────────────────────────────────────────────────

      // Приоритет 1: G если нукер не заполнен по G
      if (nukerGFree > 0) {
        const gInStorage = storage ? storage.store[RESOURCE_GHODIUM] || 0 : 0;
        const gInTerminal = terminal
          ? terminal.store[RESOURCE_GHODIUM] || 0
          : 0;
        const src =
          gInTerminal > 0 ? terminal : gInStorage > 0 ? storage : null;

        if (src) {
          const amount = Math.min(
            creep.store.getFreeCapacity(),
            src.store[RESOURCE_GHODIUM],
            nukerGFree,
          );
          creep.memory.resource = RESOURCE_GHODIUM;
          const result = creep.withdraw(src, RESOURCE_GHODIUM, amount);
          if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(src, {
              reusePath: 5,
              visualizePathStyle: { stroke: "#ff00ff" },
            });
          }
          if (result === OK) creep.memory.working = true;
          return;
        }
      }

      // Приоритет 2: Energy если нукер не заполнен по энергии
      if (
        nukerEnergyFree > 0 &&
        storage &&
        storage.store[RESOURCE_ENERGY] > 0
      ) {
        const amount = Math.min(
          creep.store.getFreeCapacity(),
          storage.store[RESOURCE_ENERGY],
          nukerEnergyFree,
        );
        creep.memory.resource = RESOURCE_ENERGY;
        const result = creep.withdraw(storage, RESOURCE_ENERGY, amount);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) creep.memory.working = true;
        return;
      }

      creep.say("⏳ ждём");
    } else {
      // ── ДОСТАВКА ──────────────────────────────────────────────────────
      const resource = creep.memory.resource;
      if (!resource) {
        creep.memory.working = false;
        return;
      }

      const result = creep.transfer(nuker, resource);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(nuker, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ff4400" },
        });
      }
      if (result === OK) {
        creep.memory.working = false;
        delete creep.memory.resource;
      }
    }
  },
};
