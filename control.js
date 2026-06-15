/**
 * ===================================================
 * CONTROL.JS — Модуль управления империей
 * ===================================================
 * VERSION: 1.0
 *
 * Использование из консоли:
 *   const C = require("control");
 *
 *   C.Empire.pause()           — остановить всю империю
 *   C.Empire.resume()          — возобновить работу
 *
 *   C.Room.pause("E35S37")     — остановить комнату
 *   C.Room.resume("E35S37")    — возобновить комнату
 *   C.Room.setMode("E35S37", "toStorage") — установить режим
 *
 *   C.Creep.move("имя", 25, 25, "E35S37") — отправить крипа
 *   C.Creep.return("имя")      — вернуть крипа на базу
 *   C.Creep.task("имя", "build") — сменить задачу
 *   C.Creep.clear("имя")       — сбросить все override
 * ===================================================
 */

const Control = {
  // ── EMPIRE ───────────────────────────────────────────────────────────────
  Empire: {
    pause: function () {
      Memory.empire = Memory.empire || {};
      Memory.empire.paused = true;
      return "Империя остановлена";
    },
    resume: function () {
      Memory.empire = Memory.empire || {};
      Memory.empire.paused = false;
      return "Империя возобновлена";
    },
  },

  // ── ROOM ─────────────────────────────────────────────────────────────────
  Room: {
    pause: function (roomName) {
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName].paused = true;
      return roomName + " остановлена";
    },
    resume: function (roomName) {
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName].paused = false;
      return roomName + " возобновлена";
    },
    setMode: function (roomName, mode) {
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      Memory.rooms[roomName].terminalMode = mode;
      return roomName + " режим: " + mode;
    },
  },

  // ── CREEP ─────────────────────────────────────────────────────────────────
  Creep: {
    move: function (name, x, y, room) {
      const creep = Game.creeps[name];
      if (!creep) return "Крип не найден: " + name;
      creep.memory.override = {
        type: "move",
        once: false,
        target: { x, y, room: room || creep.room.name },
      };
      return name + " → (" + x + "," + y + ") " + (room || creep.room.name);
    },
    return: function (name) {
      const creep = Game.creeps[name];
      if (!creep) return "Крип не найден: " + name;
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
      if (!creep) return "Крип не найден: " + name;
      creep.memory.override = { type: "task", task };
      return name + " задача: " + task;
    },
    clear: function (name) {
      const creep = Game.creeps[name];
      if (!creep) return "Крип не найден: " + name;
      creep.memory.override = null;
      return name + " override сброшен";
    },
  },
};

module.exports = Control;
