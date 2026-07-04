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

      // ИСПРАВЛЕНИЕ (ТЗ №26, Блок 5): раньше здесь передавался toRoom=null,
      // что role.terminalUnloader.js интерпретировал как обычную задачу
      // storage → terminal — то есть ресурс, который ТОЛЬКО ЧТО пришёл
      // В terminal через межкомнатный перевод, вместо разгрузки в storage
      // заново закачивался ИЗ storage В тот же terminal. Направление было
      // перепутано на противоположное задокументированному в control.js
      // ("Unloader в toStorage разгрузит terminal в storage").
      //
      // Теперь передаём toRoom = room.name (свою же комнату). Это не новое
      // поле и не новый параметр — toRoom уже существовал в сигнатуре
      // addNeed() и в структуре элементов terminalNeeds, здесь лишь другое
      // значение уже существующего поля. role.terminalUnloader.js проверяет
      // "toRoom === текущая комната" и обрабатывает такую задачу как
      // terminal → storage (см. правку в role.terminalUnloader.js).
      this.addNeed(room, entry.resource, inTerminal, room.name);
    }

    room.memory.terminalIncoming = stillWaiting;
  },

  run() {
    // Метод умышленно пуст.
    // Логика принятия решений полностью перенесена в empire.js
  },
};

module.exports = resourceBalancer;
