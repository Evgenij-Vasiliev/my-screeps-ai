/**
 * ===================================================
 * TERMINAL MANAGER
 * ===================================================
 */

const resourceBalancer = require("resourceBalancer");
const empire = require("empire");

const ENERGY_RICH_THRESHOLD = empire.energy.richThreshold;
const ENERGY_SEND_AMOUNT = empire.energy.sendAmount;
const TERMINAL_ENERGY_MIN = empire.energy.terminalMin;
const TERMINAL_ENERGY_MAX = empire.energy.terminalMax;

module.exports = {
  run(room) {
    const firstRoom = Object.keys(Game.rooms)
      .filter(n => {
        const r = Game.rooms[n];
        return r.controller && r.controller.my;
      })
      .sort()[0];

    if (room.name === firstRoom) {
      this._runEnergyBalance();
      resourceBalancer.run();
    }

    resourceBalancer.processIncoming(room);

    this._runSellPrep(room);
  },

  _runEnergyBalance() {
    // ТЗ №20: решение о запуске балансировки перенесено в empire.js
    if (!empire.shouldRunEnergyBalance()) return;

    const rooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    const poorRooms = rooms.filter(
      // ТЗ №23: порог бедной комнаты перенесён в empire.js
      r =>
        (r.storage.store[RESOURCE_ENERGY] || 0) <
        empire.energy.energyPoorThreshold,
    );

    const richRooms = rooms.filter(r =>
      // ТЗ №11: критерий богатой комнаты перенесён в empire.js
      empire.isEnergyRichRoom(r, r.storage.store[RESOURCE_ENERGY] || 0),
    );

    if (!poorRooms.length || !richRooms.length) return;

    for (const poorRoom of poorRooms) {
      const terminalEnergy = poorRoom.terminal.store[RESOURCE_ENERGY] || 0;
      if (terminalEnergy >= TERMINAL_ENERGY_MAX) continue;

      const donor = richRooms.find(r => r.name !== poorRoom.name);
      if (!donor) continue;

      const donorEnergy = donor.terminal.store[RESOURCE_ENERGY] || 0;

      if (donorEnergy >= ENERGY_SEND_AMOUNT + TERMINAL_ENERGY_MIN) {
        if (donor.terminal.cooldown > 0) continue;

        const cost = Game.market.calcTransactionCost(
          ENERGY_SEND_AMOUNT,
          donor.name,
          poorRoom.name,
        );

        if (cost + ENERGY_SEND_AMOUNT > donorEnergy - TERMINAL_ENERGY_MIN)
          continue;

        const result = donor.terminal.send(
          RESOURCE_ENERGY,
          ENERGY_SEND_AMOUNT,
          poorRoom.name,
        );

        if (result === OK) {
          console.log(
            `[Terminal] ${donor.name} → ${poorRoom.name}: ${ENERGY_SEND_AMOUNT}`,
          );

          this._clearNeed(donor, RESOURCE_ENERGY, poorRoom.name);

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

  _runSellPrep(room) {
    // ТЗ №21: решение о запуске подготовки к продаже перенесено в empire.js
    if (!empire.shouldRunSellPrep()) return;
    if (!room.terminal || !room.storage) return;

    const totalEnergy =
      (room.storage.store[RESOURCE_ENERGY] || 0) +
      (room.terminal.store[RESOURCE_ENERGY] || 0);

    const inTerminal = room.terminal.store[RESOURCE_ENERGY] || 0;

    if (
      totalEnergy > empire.energy.sellPrepThreshold &&
      inTerminal < TERMINAL_ENERGY_MIN
    ) {
      this._addNeed(room, RESOURCE_ENERGY, TERMINAL_ENERGY_MIN, null);
    }
  },

  _addNeed(room, resource, amount, toRoom) {
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

  _clearNeed(room, resource, toRoom) {
    if (!room.memory.terminalNeeds) return;

    room.memory.terminalNeeds = room.memory.terminalNeeds.filter(
      n => !(n.resource === resource && n.toRoom === toRoom),
    );
  },
};
