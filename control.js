/**
 * ===================================================
 * CONTROL.JS — Модуль управления империей
 * ===================================================
 * VERSION: 2.0
 *
 * Использование из консоли:
 *   const C = require("control");
 *
 * ИМПЕРИЯ
 *   C.Empire.pause()
 *   C.Empire.resume()
 *   C.Empire.status()
 *
 * КОМНАТА
 *   C.Room.pause("E35S37")
 *   C.Room.resume("E35S37")
 *   C.Room.setMode("E35S37", "toStorage")
 *   C.Room.clearMode("E35S37")
 *   C.Room.status("E35S37")
 *
 * КРИП
 *   C.Creep.move("имя", x, y, "комната")
 *   C.Creep.return("имя")
 *   C.Creep.task("имя", "build")
 *   C.Creep.transfer("имя", "targetId", "energy", 1000)
 *   C.Creep.attack("имя", "targetId")
 *   C.Creep.heal("имя", "targetId")
 *   C.Creep.clear("имя")
 *   C.Creep.status("имя")
 *   C.Creep.clearAll("E35S37")
 *
 * ТЕРМИНАЛ
 *   C.Terminal.send("E35S37", "E36S38", "energy", 10000)
 *   C.Terminal.status("E35S37")
 *
 * ПАМЯТЬ
 *   C.Memory.clearRoom("E35S37")
 *   C.Memory.setRoom("E35S37", "key", value)
 *   C.Memory.show("E35S37")
 * ===================================================
 */

const Control = {
  // ── EMPIRE ───────────────────────────────────────────────────────────────
  Empire: {
    pause: function () {
      Memory.empire = Memory.empire || {};
      Memory.empire.paused = true;
      return "⛔ Империя остановлена";
    },
    resume: function () {
      Memory.empire = Memory.empire || {};
      Memory.empire.paused = false;
      return "✅ Империя возобновлена";
    },
    status: function () {
      const mem = Memory.empire || {};
      const paused = mem.paused ? "⛔ PAUSED" : "✅ AUTO";
      const lines = ["=== EMPIRE STATUS ==="];
      lines.push("Режим: " + paused);
      lines.push("Тик: " + Game.time);
      lines.push("CPU bucket: " + Game.cpu.bucket);
      lines.push("Крипов: " + Object.keys(Game.creeps).length);
      return lines.join("\n");
    },
  },

  // ── ROOM ─────────────────────────────────────────────────────────────────
  Room: {
    pause: function (roomName) {
      Memory.rooms = Memory.rooms || {};
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName].paused = true;
      return "⛔ " + roomName + " остановлена";
    },
    resume: function (roomName) {
      Memory.rooms = Memory.rooms || {};
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName].paused = false;
      return "✅ " + roomName + " возобновлена";
    },
    setMode: function (roomName, mode) {
      Memory.rooms = Memory.rooms || {};
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName].terminalMode = mode;
      return roomName + " → режим: " + mode;
    },
    clearMode: function (roomName) {
      if (Memory.rooms && Memory.rooms[roomName]) {
        Memory.rooms[roomName].terminalMode = null;
      }
      return roomName + " → режим сброшен";
    },
    status: function (roomName) {
      const mem = (Memory.rooms && Memory.rooms[roomName]) || {};
      const room = Game.rooms[roomName];
      const lines = ["=== ROOM STATUS: " + roomName + " ==="];
      lines.push("paused: " + (mem.paused ? "⛔ да" : "нет"));
      lines.push("terminalMode: " + (mem.terminalMode || "—"));
      if (room) {
        lines.push(
          "storage energy: " +
            (room.storage ? room.storage.store[RESOURCE_ENERGY] : "нет"),
        );
        lines.push(
          "terminal energy: " +
            (room.terminal ? room.terminal.store[RESOURCE_ENERGY] : "нет"),
        );
        lines.push(
          "terminal cooldown: " +
            (room.terminal ? room.terminal.cooldown : "—"),
        );
      }
      return lines.join("\n");
    },
  },

  // ── CREEP ─────────────────────────────────────────────────────────────────
  Creep: {
    move: function (name, x, y, room) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      creep.memory.override = {
        type: "move",
        once: false,
        target: { x, y, room: room || creep.room.name },
      };
      return (
        name + " → move (" + x + "," + y + ") " + (room || creep.room.name)
      );
    },
    return: function (name) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      const home = creep.memory.room;
      creep.memory.override = {
        type: "move",
        once: false,
        target: { x: 25, y: 25, room: home },
      };
      return name + " → домой (" + home + ")";
    },
    task: function (name, task) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      creep.memory.override = { type: "task", task };
      return name + " → задача: " + task;
    },
    transfer: function (name, targetId, resource, amount) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      creep.memory.override = {
        type: "transfer",
        once: true,
        target: targetId,
        resource: resource || RESOURCE_ENERGY,
        amount: amount || 10000,
      };
      return (
        name +
        " → transfer " +
        (resource || "energy") +
        " x" +
        (amount || 10000) +
        " → " +
        targetId
      );
    },
    attack: function (name, targetId) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      creep.memory.override = { type: "attack", once: false, target: targetId };
      return name + " → attack " + targetId;
    },
    heal: function (name, targetId) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      creep.memory.override = { type: "heal", once: false, target: targetId };
      return name + " → heal " + targetId;
    },
    clear: function (name) {
      const creep = Game.creeps[name];
      if (!creep) return "❌ Крип не найден: " + name;
      creep.memory.override = null;
      return name + " → override сброшен";
    },
    clearAll: function (roomName) {
      let count = 0;
      for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (roomName && c.memory.room !== roomName) continue;
        if (c.memory.override) {
          c.memory.override = null;
          count++;
        }
      }
      return (
        "✅ сброшено override: " +
        count +
        (roomName ? " в " + roomName : " по всей империи")
      );
    },
    status: function (name) {
      const c = Game.creeps[name];
      if (!c) return "❌ Крип не найден: " + name;
      const lines = ["=== CREEP: " + name + " ==="];
      lines.push(
        "role: " + (c.memory.role || "?") + "  room: " + c.memory.room,
      );
      lines.push(
        "HP: " +
          c.hits +
          "/" +
          c.hitsMax +
          "  TTL: " +
          (c.ticksToLive || "N/A"),
      );
      lines.push("pos: " + c.pos.x + "," + c.pos.y + " в " + c.room.name);
      lines.push(
        "груз: " + c.store.getUsedCapacity() + "/" + c.store.getCapacity(),
      );
      lines.push(
        "override: " +
          (c.memory.override ? JSON.stringify(c.memory.override) : "нет"),
      );
      return lines.join("\n");
    },
  },

  // ── TERMINAL ─────────────────────────────────────────────────────────────
  Terminal: {
    send: function (fromRoom, toRoom, resource, amount) {
      const room = Game.rooms[fromRoom];
      if (!room) return "❌ Комната не видна: " + fromRoom;
      const term = room.terminal;
      if (!term) return "❌ Терминал не найден: " + fromRoom;
      if (term.cooldown > 0)
        return "❌ Терминал на cooldown: " + term.cooldown + " тиков";
      const inTerminal = term.store[resource] || 0;
      if (inTerminal < amount)
        return (
          "❌ В терминале только " +
          inTerminal +
          " " +
          resource +
          " (нужно " +
          amount +
          ")"
        );
      const result = term.send(resource, amount, toRoom);
      if (result === OK)
        return (
          "✅ Отправлено: " +
          resource +
          " x" +
          amount +
          "  " +
          fromRoom +
          " → " +
          toRoom
        );
      return "❌ Ошибка отправки: код " + result;
    },
    status: function (roomName) {
      const room = Game.rooms[roomName];
      if (!room) return "❌ Комната не видна: " + roomName;
      const term = room.terminal;
      if (!term) return "❌ Терминал не найден: " + roomName;
      const used = term.store.getUsedCapacity();
      const cap = term.store.getCapacity();
      const pct = Math.round((used / cap) * 100);
      const lines = ["=== TERMINAL: " + roomName + " ==="];
      lines.push(
        "заполнен: " +
          used +
          "/" +
          cap +
          " (" +
          pct +
          "%)  cooldown: " +
          term.cooldown,
      );
      const resources = Object.entries(term.store)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a);
      for (const [res, amt] of resources) lines.push("  " + res + ": " + amt);
      return lines.join("\n");
    },
  },

  // ── MEMORY ───────────────────────────────────────────────────────────────
  Memory: {
    clearRoom: function (roomName) {
      if (Memory.rooms && Memory.rooms[roomName]) {
        const keep = { paused: false };
        Memory.rooms[roomName] = keep;
      }
      return "✅ Memory комнаты " + roomName + " очищена";
    },
    setRoom: function (roomName, key, value) {
      Memory.rooms = Memory.rooms || {};
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName][key] = value;
      return roomName + "." + key + " = " + JSON.stringify(value);
    },
    show: function (roomName) {
      const mem = Memory.rooms && Memory.rooms[roomName];
      if (!mem) return "Memory.rooms[" + roomName + "] пуста";
      return JSON.stringify(mem, null, 2);
    },
  },
};

module.exports = Control;
