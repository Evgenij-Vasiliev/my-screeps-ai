const Logger = require("./logger");
const empire = require("./empire");

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
    // Метод умышленно пуст.
    // Логика принятия решений полностью перенесена в empire.js
  },
};

module.exports = resourceBalancer;
