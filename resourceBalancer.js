const Logger = require("./logger");
const empire = require("./empire"); // ТЗ №1: резервы теперь берутся из empire.js

const resourceBalancer = {
  getTotal(room, resource) {
    return (
      (room.storage ? room.storage.store[resource] || 0 : 0) +
      (room.terminal ? room.terminal.store[resource] || 0 : 0)
    );
  },

  addNeed(room, resource, amount, toRoom) {
    if (!room.memory.terminalNeeds) room.memory.terminalNeeds = [];

    const needs = room.memory.terminalNeeds;

    const existing = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );

    if (existing) {
      existing.amount = amount;
      return false;
    }

    needs.push({ resource, amount, toRoom });
    return true;
  },

  registerIncoming(toRoomName, resource, amount) {
    if (!Memory.rooms) Memory.rooms = {};
    if (!Memory.rooms[toRoomName]) Memory.rooms[toRoomName] = {};
    if (!Memory.rooms[toRoomName].terminalIncoming) {
      Memory.rooms[toRoomName].terminalIncoming = [];
    }

    const incoming = Memory.rooms[toRoomName].terminalIncoming;
    const existing = incoming.find(i => i.resource === resource);

    if (existing) {
      existing.amount = Math.max(existing.amount, amount);
      return;
    }

    incoming.push({ resource, amount, registeredAt: Game.time });
  },

  processIncoming(room) {
    if (!room.terminal || !room.storage) return;

    const incoming = room.memory.terminalIncoming;
    if (!incoming || incoming.length === 0) return;

    const stillWaiting = [];

    for (const entry of incoming) {
      const inTerminal = room.terminal.store[entry.resource] || 0;

      if (inTerminal <= 0) {
        if (
          Game.time - entry.registeredAt <
          empire.getIncomingTransferTimeout()
        ) {
          stillWaiting.push(entry);
        }
        continue;
      }

      this.addNeed(room, entry.resource, inTerminal, null);
    }

    room.memory.terminalIncoming = stillWaiting;
  },

  run() {
    if (Memory.balancerEnabled === false) return;
    if (Game.time % empire.getBalanceInterval() !== 0) return;

    const rooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    if (rooms.length < 2) return;

    const allResources = new Set([RESOURCE_ENERGY]);

    for (const room of rooms) {
      for (const r of Object.keys(room.storage.store)) allResources.add(r);
      for (const r of Object.keys(room.terminal.store)) allResources.add(r);
    }

    const busy = new Set();

    for (const resource of allResources) {
      // ТЗ №1: резерв берётся из empire.js
      const reserve = empire.getReserveMin(resource);
      // ТЗ №2: дефицит берётся из empire.js
      const deficit = empire.getDeficitThreshold(resource);
      // ТЗ №3: объём поставки берётся из empire.js
      const send = empire.getSendAmount(resource);

      // ТЗ №6: критерий дефицита комнаты определяет empire.js
      const poor = rooms.filter(r =>
        empire.isResourceDeficitRoom(r, this.getTotal(r, resource), deficit),
      );

      if (!poor.length) continue;

      // ТЗ №7: критерий комнаты-донора определяет empire.js
      const rich = rooms.filter(r =>
        empire.isResourceDonorRoom(
          r,
          this.getTotal(r, resource),
          reserve,
          send,
          busy.has(r.name),
        ),
      );

      if (!rich.length) continue;

      // ТЗ №4: решение о выборе получателя принимает empire.js
      const target = empire.selectBalanceTarget(resource, poor);
      if (!target) continue;

      // ТЗ №16: единый метод выбора донора (заменяет selectBalanceDonor)
      const donor = empire.selectDonor(rich, target);
      if (!donor) continue;

      const amount = Math.min(send, this.getTotal(donor, resource) - reserve);

      if (amount <= 0) continue;

      const inTerminal = donor.terminal.store[resource] || 0;

      if (inTerminal < amount) {
        this.addNeed(donor, resource, amount, target.name);
        this.registerIncoming(target.name, resource, amount);
        busy.add(donor.name);
        continue;
      }

      const cost = Game.market.calcTransactionCost(
        amount,
        donor.name,
        target.name,
      );

      const energy = donor.terminal.store[RESOURCE_ENERGY] || 0;

      if (cost > energy - empire.getTerminalEnergyReserve()) continue;

      const result = donor.terminal.send(resource, amount, target.name);

      if (result === OK) {
        this.registerIncoming(target.name, resource, amount);
        busy.add(donor.name);
      }
    }
  },
};

module.exports = resourceBalancer;
