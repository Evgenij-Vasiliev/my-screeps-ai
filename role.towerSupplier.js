/**
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен, терминала и переносчик минералов
 *
 * Приоритеты доставки:
 * 1. Башни (энергия)
 * 2. Терминал (энергия до минимума)
 * 3. Терминал (минералы из Storage)
 */

const TERMINAL_ENERGY_MIN = 20000;
const MINERAL_BATCH = 400;

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const storage = creep.room.storage;
    const terminal = creep.room.terminal;

    // ── 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ ──────────────────────────────────────────

    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("⚡ везу");
    }

    // ── 2. РЕЖИМ СБОРА ────────────────────────────────────────────────────

    if (!creep.memory.working) {
      const MIN_STORAGE_ENERGY = creep.room.memory.minStorageEnergy || 5000;

      // Сбор энергии если башни или терминал нуждаются
      const towers = creep.room._towers || [];
      const needyTowers = towers.filter(
        t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      );
      const terminalNeedsEnergy =
        terminal && terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN;

      if (
        (needyTowers.length > 0 || terminalNeedsEnergy) &&
        storage &&
        storage.store[RESOURCE_ENERGY] > MIN_STORAGE_ENERGY
      ) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Сбор минерала из Storage для терминала
      if (storage && terminal) {
        for (const resource in storage.store) {
          if (resource === RESOURCE_ENERGY) continue;
          if (terminal.store.getFreeCapacity(resource) > 0) {
            creep.memory.mineralResource = resource;
            if (
              creep.withdraw(storage, resource, MINERAL_BATCH) ===
              ERR_NOT_IN_RANGE
            ) {
              creep.moveTo(storage, {
                reusePath: 5,
                visualizePathStyle: { stroke: "#ff8800" },
              });
            }
            return;
          }
        }
      }

      creep.say("💤 нечего делать");
      return;
    }

    // ── 3. РЕЖИМ ДОСТАВКИ ─────────────────────────────────────────────────

    // Если несём минерал — только в терминал
    const carryMineral = Object.keys(creep.store).find(
      r => r !== RESOURCE_ENERGY,
    );
    if (carryMineral) {
      creep.say("💎 минерал");
      if (terminal) {
        if (creep.transfer(terminal, carryMineral) === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff8800" },
          });
        }
      }
      return;
    }

    // Приоритет 1: башни
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

    // Приоритет 2: терминал (энергия)
    if (terminal && terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN) {
      creep.say("💱 терминал");
      if (creep.transfer(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#00ffff" },
        });
      }
      return;
    }

    creep.say("💤 полно");
  },
};
