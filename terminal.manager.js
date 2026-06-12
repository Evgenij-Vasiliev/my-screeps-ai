/**
 * МЕНЕДЖЕР ТЕРМИНАЛА (Terminal Manager)
 * Балансировка энергии между комнатами.
 * Запускается из room.manager каждый тик, глобальные операции — из первой комнаты.
 *
 * Логика:
 * - Бедная комната (< 20000 energy в storage) получает от богатой (> 100000)
 * - terminalNeeds — очередь задач для terminalUnloader (storage → terminal)
 */

const marketManager = require("market.manager");

const ENERGY_POOR_THRESHOLD = 20000;
const ENERGY_RICH_THRESHOLD = 100000;
const ENERGY_SEND_AMOUNT = 20000;
const TERMINAL_ENERGY_MIN = 20000;
const TERMINAL_ENERGY_MAX = 100000;
const CHECK_INTERVAL = 100;

module.exports = {
  run: function (room) {
    // Глобальная балансировка — только из первой комнаты по алфавиту
    const firstRoom = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort()[0];

    if (room.name === firstRoom) {
      this._runEnergyBalance();
      marketManager.run();
    }

    // Подготовка ресурсов к продаже — перенос из storage в terminal
    this._runSellPrep(room);
  },

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

      // Энергия уже в терминале донора — отправляем
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
        }
      } else {
        // Энергии в терминале мало — просим unloader перенести из storage
        this._addNeed(
          donor,
          RESOURCE_ENERGY,
          ENERGY_SEND_AMOUNT,
          poorRoom.name,
        );
      }
    }
  },

  // Готовим ресурсы к продаже: просим unloader перенести из storage в terminal
  _runSellPrep: function (room) {
    if (Game.time % CHECK_INTERVAL !== 0) return;
    if (!room.terminal || !room.storage) return;

    // Энергия в терминале для продажи
    const totalEnergy =
      (room.storage.store[RESOURCE_ENERGY] || 0) +
      (room.terminal.store[RESOURCE_ENERGY] || 0);
    const inTerminal = room.terminal.store[RESOURCE_ENERGY] || 0;

    if (totalEnergy > 500000 && inTerminal < TERMINAL_ENERGY_MIN) {
      this._addNeed(room, RESOURCE_ENERGY, TERMINAL_ENERGY_MIN, null);
    }
  },

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
