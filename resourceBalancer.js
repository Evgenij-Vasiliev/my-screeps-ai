const Logger = require("./logger");

const BALANCE_INTERVAL = 100;
const TERMINAL_ENERGY_MIN = 20000;

// минимальные резервы
const RESERVE_MIN = {
  energy: 50000,
  battery: 10000,
  O: 3000,
  H: 3000,
  Z: 15000,
  K: 15000,
  L: 15000,
  U: 15000,
  X: 15000,
  OH: 8000,
  ZK: 8000,
  ZO: 8000,
  KH: 8000,
  LO: 8000,
  UO: 8000,
  UH: 8000,
  LH: 8000,
  GH: 8000,
  ZHO2: 3000,
  KHO2: 3000,
  LHO2: 3000,
  UHO2: 3000,
  UH2O: 3000,
  KH2O: 3000,
  LH2O: 3000,
  GH2O: 3000,
};

// дефицит
const DEFICIT_THRESHOLD = {
  energy: 20000,
  battery: 3000,
  O: 1000,
  H: 1000,
  Z: 5000,
  K: 5000,
  L: 5000,
  U: 5000,
  X: 5000,
  OH: 2000,
  ZK: 2000,
  ZO: 2000,
  KH: 2000,
  LO: 2000,
  UO: 2000,
  UH: 2000,
  LH: 2000,
  GH: 2000,
  ZHO2: 1000,
  KHO2: 1000,
  LHO2: 1000,
  UHO2: 1000,
  UH2O: 1000,
  KH2O: 1000,
  LH2O: 1000,
  GH2O: 1000,
};

// отправка
const SEND_AMOUNT = {
  energy: 30000,
  battery: 5000,
  O: 2000,
  H: 2000,
  Z: 10000,
  K: 10000,
  L: 10000,
  U: 10000,
  X: 10000,
  OH: 5000,
  ZK: 5000,
  ZO: 5000,
  KH: 5000,
  LO: 5000,
  UO: 5000,
  UH: 5000,
  LH: 5000,
  GH: 5000,
  ZHO2: 2000,
  KHO2: 2000,
  LHO2: 2000,
  UHO2: 2000,
  UH2O: 2000,
  KH2O: 2000,
  LH2O: 2000,
  GH2O: 2000,
};

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
        if (Game.time - entry.registeredAt < 500) {
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
    if (Game.time % BALANCE_INTERVAL !== 0) return;

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
      const reserve = RESERVE_MIN[resource] || 5000;
      const deficit = DEFICIT_THRESHOLD[resource] || 2000;
      const send = SEND_AMOUNT[resource] || 3000;

      const poor = rooms.filter(r => this.getTotal(r, resource) < deficit);

      if (!poor.length) continue;

      const rich = rooms.filter(
        r =>
          this.getTotal(r, resource) > reserve + send &&
          r.terminal.cooldown === 0 &&
          !busy.has(r.name),
      );

      if (!rich.length) continue;

      const target = poor[0];
      const donor = rich.find(r => r.name !== target.name);
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

      if (cost > energy - TERMINAL_ENERGY_MIN) continue;

      const result = donor.terminal.send(resource, amount, target.name);

      if (result === OK) {
        this.registerIncoming(target.name, resource, amount);
        busy.add(donor.name);
      }
    }
  },
};

module.exports = resourceBalancer;
