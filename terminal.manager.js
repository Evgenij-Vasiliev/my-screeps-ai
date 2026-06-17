/**
 * ===================================================
 * TERMINAL MANAGER
 * ===================================================
 * VERSION: 2.1
 *
 * Запускается из room.manager каждый тик для каждой комнаты.
 * Глобальные операции (балансировка) — только из первой комнаты по алфавиту.
 *
 * Логика:
 * - Глобальная балансировка энергии между комнатами (каждые 100 тиков)
 * - resourceBalancer — балансировка всех ресурсов (каждые 100 тиков)
 * - processIncoming — проверка входящих грузов каждый тик (автоматическая
 *   разгрузка терминала в storage после получения от другой комнаты)
 * - terminalNeeds — очередь задач для terminalUnloader (storage → terminal)
 * - Подготовка ресурсов к продаже (перенос из storage в terminal)
 * ===================================================
 */

const marketManager = require("market.manager");
const resourceBalancer = require("resourceBalancer");

const ENERGY_POOR_THRESHOLD = 20000;
const ENERGY_RICH_THRESHOLD = 100000;
const ENERGY_SEND_AMOUNT = 20000;
const TERMINAL_ENERGY_MIN = 100000;
const TERMINAL_ENERGY_MAX = 150000;
const CHECK_INTERVAL = 100;

module.exports = {
  run: function (room) {
    // ── ГЛОБАЛЬНЫЕ ОПЕРАЦИИ (только из первой комнаты) ───────────────────
    const firstRoom = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort()[0];

    if (room.name === firstRoom) {
      this._runEnergyBalance();
      resourceBalancer.run(); // балансировка всех ресурсов
      marketManager.run();
    }

    // ── КАЖДЫЙ ТИК ДЛЯ КАЖДОЙ КОМНАТЫ ───────────────────────────────────

    // Автоматическая разгрузка входящих грузов из терминала в storage
    resourceBalancer.processIncoming(room);

    // Подготовка ресурсов к продаже
    this._runSellPrep(room);
  },

  // ── БАЛАНСИРОВКА ЭНЕРГИИ ─────────────────────────────────────────────
  _runEnergyBalance: function () {
    if (Game.time % CHECK_INTERVAL !== 0) return;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    const poorRooms = ourRooms.filter(
      r => (r.storage.store[RESOURCE_ENERGY] || 0) < ENERGY_POOR_THRESHOLD,
    );
    const richRooms = ourRooms.filter(
      r => (r.storage.store[RESOURCE_ENERGY] || 0) > ENERGY_RICH_THRESHOLD,
    );

    if (poorRooms.length === 0 || richRooms.length === 0) return;

    for (const poorRoom of poorRooms) {
      const terminalEnergy = poorRoom.terminal.store[RESOURCE_ENERGY] || 0;
      if (terminalEnergy >= TERMINAL_ENERGY_MAX) continue;

      const donor = richRooms.find(r => r.name !== poorRoom.name);
      if (!donor) continue;

      const donorTerminal = donor.terminal.store[RESOURCE_ENERGY] || 0;

      if (donorTerminal >= ENERGY_SEND_AMOUNT + TERMINAL_ENERGY_MIN) {
        if (donor.terminal.cooldown > 0) continue;

        const txCost = Game.market.calcTransactionCost(
          ENERGY_SEND_AMOUNT,
          donor.name,
          poorRoom.name,
        );

        if (txCost + ENERGY_SEND_AMOUNT > donorTerminal - TERMINAL_ENERGY_MIN)
          continue;

        const result = donor.terminal.send(
          RESOURCE_ENERGY,
          ENERGY_SEND_AMOUNT,
          poorRoom.name,
        );
        if (result === OK) {
          console.log(
            `[Terminal] ✅ ${donor.name} → ${poorRoom.name}: ${ENERGY_SEND_AMOUNT} energy`,
          );
          this._clearNeed(donor, RESOURCE_ENERGY, poorRoom.name);
          // Регистрируем входящий груз на стороне получателя
          resourceBalancer.registerIncoming(
            poorRoom.name,
            RESOURCE_ENERGY,
            ENERGY_SEND_AMOUNT,
          );
        }
      } else {
        this._addNeed(
          donor,
          RESOURCE_ENERGY,
          ENERGY_SEND_AMOUNT,
          poorRoom.name,
        );
        resourceBalancer.registerIncoming(
          poorRoom.name,
          RESOURCE_ENERGY,
          ENERGY_SEND_AMOUNT,
        );
      }
    }
  },

  // ── ПОДГОТОВКА К ПРОДАЖЕ ─────────────────────────────────────────────
  _runSellPrep: function (room) {
    if (Game.time % CHECK_INTERVAL !== 0) return;
    if (!room.terminal || !room.storage) return;

    const totalEnergy =
      (room.storage.store[RESOURCE_ENERGY] || 0) +
      (room.terminal.store[RESOURCE_ENERGY] || 0);
    const inTerminal = room.terminal.store[RESOURCE_ENERGY] || 0;

    if (totalEnergy > 500000 && inTerminal < TERMINAL_ENERGY_MIN) {
      this._addNeed(room, RESOURCE_ENERGY, TERMINAL_ENERGY_MIN, null);
    }
  },

  // ── УТИЛИТЫ ──────────────────────────────────────────────────────────
  _addNeed: function (room, resource, amount, toRoom) {
    if (!room.memory.terminalNeeds) room.memory.terminalNeeds = [];
    const needs = room.memory.terminalNeeds;
    const existing = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );
    if (existing) {
      existing.amount = amount;
      return;
    }
    needs.push({ resource, amount, toRoom });
  },

  _clearNeed: function (room, resource, toRoom) {
    if (!room.memory.terminalNeeds) return;
    room.memory.terminalNeeds = room.memory.terminalNeeds.filter(
      n => !(n.resource === resource && n.toRoom === toRoom),
    );
  },
};
