/**
 * ===================================================
 * TERMINAL MANAGER
 * ===================================================
 */

const resourceBalancer = require("resourceBalancer");
const empire = require("empire");

const ENERGY_SEND_AMOUNT = empire.energy.sendAmount;
const TERMINAL_ENERGY_MIN = empire.energy.terminalMin;
const TERMINAL_ENERGY_MAX = empire.energy.terminalMax;

const CHECK_INTERVAL = empire.energy.balanceInterval;

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
    if (Game.time % CHECK_INTERVAL !== 0) return;

    const rooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    // ТЗ №13: решение "бедная ли комната" перенесено в empire.js
    const poorRooms = rooms.filter(r =>
      empire.isEnergyPoorRoom(r, r.storage.store[RESOURCE_ENERGY] || 0),
    );

    // ТЗ №11: решение "богатая ли комната" перенесено в empire.js
    const richRooms = rooms.filter(r =>
      empire.isEnergyRichRoom(r, r.storage.store[RESOURCE_ENERGY] || 0),
    );

    if (!poorRooms.length || !richRooms.length) return;

    for (const poorRoom of poorRooms) {
      const terminalEnergy = poorRoom.terminal.store[RESOURCE_ENERGY] || 0;
      if (terminalEnergy >= TERMINAL_ENERGY_MAX) continue;

      // ТЗ №16: единый метод выбора донора
      const donor = empire.selectDonor(richRooms, poorRoom);
      if (!donor) continue;

      const donorEnergy = donor.terminal.store[RESOURCE_ENERGY] || 0;

      // ТЗ №17: условие достаточности энергии у донора перенесено в empire.js
      if (empire.canSendEnergy(donorEnergy)) {
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
    if (Game.time % CHECK_INTERVAL !== 0) return;
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
