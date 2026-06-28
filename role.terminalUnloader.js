/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Разгрузчик терминала
 * ===================================================
 * VERSION: 2.2
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

const empire = require("empire");

// Ресурсы для загрузки в терминал под продажу (порядок: энергия первой)
const SELL_RESOURCES = [
  RESOURCE_ENERGY,
  RESOURCE_BATTERY,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_OXYGEN,
  RESOURCE_HYDROGEN,
  RESOURCE_CATALYST,
  RESOURCE_GHODIUM,
  RESOURCE_UTRIUM_HYDRIDE,
  RESOURCE_UTRIUM_OXIDE,
  RESOURCE_KEANIUM_HYDRIDE,
  RESOURCE_KEANIUM_OXIDE,
  RESOURCE_LEMERGIUM_HYDRIDE,
  RESOURCE_LEMERGIUM_OXIDE,
  RESOURCE_ZYNTHIUM_HYDRIDE,
  RESOURCE_ZYNTHIUM_OXIDE,
  RESOURCE_GHODIUM_HYDRIDE,
  RESOURCE_ZYNTHIUM_KEANITE,
  RESOURCE_UTRIUM_LEMERGITE,
  RESOURCE_KEANIUM_ACID,
  RESOURCE_LEMERGIUM_ALKALIDE,
  RESOURCE_UTRIUM_ALKALIDE,
  RESOURCE_ZYNTHIUM_ALKALIDE,
];

// Минимальный целевой объём ресурса в терминале для продажи
const TERMINAL_SELL_TARGET = 10000;

module.exports = {
  run: function (creep) {
    if (!creep.room.terminal || !creep.room.storage) return;

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;
    const mode = (creep.room.memory || {}).terminalMode || "toTerminal";

    // ── ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЯ ────────────────────────────────────────────
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.task;
      delete creep.memory.resource;
      delete creep.memory.transferred;
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

      // Режим по умолчанию — два приоритета:
      // 1. Энергия: довезти до TERMINAL_ENERGY_MIN если не хватает для сделок
      // 2. Ресурсы: загрузить излишки сверх sellSurplus для продажи на рынке

      // Приоритет 1: энергия для транзакций
      const TERMINAL_ENERGY_MIN = empire.energy.terminalMin;
      const energyInTerminal = terminal.store[RESOURCE_ENERGY] || 0;
      const energyInStorage = storage.store[RESOURCE_ENERGY] || 0;

      if (energyInTerminal < TERMINAL_ENERGY_MIN && energyInStorage > 0) {
        const needed = TERMINAL_ENERGY_MIN - energyInTerminal;
        const amount = Math.min(
          needed,
          energyInStorage,
          creep.store.getFreeCapacity(),
        );
        if (amount > 0) {
          creep.memory.resource = RESOURCE_ENERGY;
          creep.memory.task = "toTerminal";
          if (
            creep.withdraw(storage, RESOURCE_ENERGY, amount) ===
            ERR_NOT_IN_RANGE
          ) {
            creep.moveTo(storage, { reusePath: 5 });
          }
          return;
        }
      }

      // Приоритет 2: излишки ресурсов для продажи
      const resource = SELL_RESOURCES.find(r => {
        const inStorage = storage.store[r] || 0;
        const inTerminal = terminal.store[r] || 0;
        const total = inStorage + inTerminal;
        const sellSurplus =
          r === RESOURCE_ENERGY
            ? empire.energy.sellSurplus
            : empire.minerals.sellSurplus;
        return total > sellSurplus && inTerminal < TERMINAL_SELL_TARGET;
      });

      if (!resource) return;

      const inStorage = storage.store[resource] || 0;
      const inTerminal = terminal.store[resource] || 0;
      const needed = TERMINAL_SELL_TARGET - inTerminal;
      const amount = Math.min(needed, inStorage, creep.store.getFreeCapacity());

      if (amount <= 0) return;

      creep.memory.resource = resource;
      creep.memory.task = "toTerminal";

      if (creep.withdraw(storage, resource, amount) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 5 });
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
      // ВАЖНО: фиксируем количество ДО transfer() — transfer() мгновенно
      // обнуляет store крипа по этому ресурсу, поэтому считать "после" нельзя.
      const amount = creep.store[creep.memory.resource] || 0;
      const r = creep.transfer(terminal, creep.memory.resource);
      if (r === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, { reusePath: 5 });
        return;
      }
      if (r === OK) {
        creep.memory.transferred = (creep.memory.transferred || 0) + amount;
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
