/**
 * ===================================================
 * CONTROL.JS — Модуль управления империей
 * ===================================================
 * VERSION: 2.1
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
 *   C.Terminal.move("E35S37", "E36S38", "energy", 10000)
 *     — полный цикл: storage(A) → terminal(A) → terminal(B) → storage(B)
 *     — unloader комнаты A перенесёт ресурс в терминал,
 *       терминал отправит в B, unloader B разгрузит в storage
 *   C.Terminal.moveStatus("E35S37")
 *     — статус активных заданий на переброску из комнаты
 *   C.Terminal.moveCancel("E35S37", "E36S38", "energy")
 *     — отменить задание на переброску
 *
 * ПАМЯТЬ
 *   C.Memory.clearRoom("E35S37")
 *   C.Memory.setRoom("E35S37", "key", value)
 *   C.Memory.show("E35S37")
 *   C.Memory.deleteField("E35S37", "key")
 *   C.Memory.compare()
 *   C.Memory.restore("E35S37")
 * ===================================================
 */

const resourceBalancer = require("resourceBalancer");

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
    /**
     * Прямая отправка из терминала в терминал (ресурс уже в терминале).
     * C.Terminal.send("E35S37", "E36S38", "energy", 10000)
     */
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

    /**
     * Переброска ресурса из ХРАНИЛИЩА одной комнаты в ХРАНИЛИЩЕ другой.
     * Полный цикл: storage(A) → terminal(A) → terminal(B) → storage(B)
     *
     * Шаг 1: ставит задачу в terminalNeeds комнаты A (unloader перенесёт из storage в terminal)
     * Шаг 2: terminal.manager подхватит и выполнит send в следующем цикле
     * Шаг 3: на стороне B unloader в режиме toStorage разгрузит terminal в storage
     *
     * C.Terminal.move("E35S37", "E36S38", "energy", 10000)
     */
    move: function (fromRoom, toRoom, resource, amount) {
      // Валидация комнат
      if (!Memory.rooms) return "❌ Memory.rooms не инициализирована";

      const roomA = Game.rooms[fromRoom];
      const roomB = Game.rooms[toRoom];

      if (!roomA) return "❌ Комната-источник не видна: " + fromRoom;
      if (!roomB) return "❌ Комната-получатель не видна: " + toRoom;
      if (!roomA.storage)
        return "❌ Нет storage в комнате-источнике: " + fromRoom;
      if (!roomB.storage)
        return "❌ Нет storage в комнате-получателе: " + toRoom;
      if (!roomA.terminal)
        return "❌ Нет terminal в комнате-источнике: " + fromRoom;
      if (!roomB.terminal)
        return "❌ Нет terminal в комнате-получателе: " + toRoom;

      // Проверяем наличие ресурса в storage источника
      const inStorage = roomA.storage.store[resource] || 0;
      if (inStorage < amount) {
        return (
          "❌ В storage " +
          fromRoom +
          " только " +
          inStorage +
          " " +
          resource +
          " (нужно " +
          amount +
          ")"
        );
      }

      // Шаг 1: ставим задачу unloader'у комнаты A — перенести из storage в terminal
      Memory.rooms[fromRoom] = Memory.rooms[fromRoom] || {};
      const needs = Memory.rooms[fromRoom].terminalNeeds || [];

      // Проверяем дубликат
      const existing = needs.find(
        n => n.resource === resource && n.toRoom === toRoom,
      );
      if (existing) {
        existing.amount = amount;
        Memory.rooms[fromRoom].terminalNeeds = needs;
        return (
          "♻ Задача обновлена: " +
          resource +
          " x" +
          amount +
          "  storage(" +
          fromRoom +
          ") → storage(" +
          toRoom +
          ")" +
          "\n  Unloader перенесёт в terminal, затем terminal.manager отправит."
        );
      }

      needs.push({ resource, amount, toRoom });
      Memory.rooms[fromRoom].terminalNeeds = needs;

      // Шаг 2: регистрируем ожидание на стороне получателя —
      // resourceBalancer.processIncoming автоматически разгрузит терминал в storage
      resourceBalancer.registerIncoming(toRoom, resource, amount);

      return (
        "✅ Задача поставлена: " +
        resource +
        " x" +
        amount +
        "\n  storage(" +
        fromRoom +
        ") → terminal(" +
        fromRoom +
        ") → terminal(" +
        toRoom +
        ") → storage(" +
        toRoom +
        ")" +
        "\n  Unloader в " +
        fromRoom +
        " перенесёт ресурс в терминал." +
        "\n  Terminal.manager выполнит отправку в следующем цикле (до 100 тиков)." +
        "\n  После получения — автоматически разгрузится в storage(" +
        toRoom +
        ")."
      );
    },

    /**
     * Статус активных заданий на переброску из комнаты.
     * C.Terminal.moveStatus("E35S37")
     */
    moveStatus: function (roomName) {
      const mem = Memory.rooms && Memory.rooms[roomName];
      if (!mem) return "❌ Память комнаты не найдена: " + roomName;

      const needs = mem.terminalNeeds || [];
      if (needs.length === 0) return "✅ " + roomName + ": очередь пуста";

      const lines = ["=== MOVE STATUS: " + roomName + " ==="];
      for (const n of needs) {
        const dest = n.toRoom ? " → storage(" + n.toRoom + ")" : " → terminal";
        lines.push("  " + n.resource + " x" + n.amount + dest);

        // Показываем сколько уже в терминале
        const room = Game.rooms[roomName];
        if (room && room.terminal) {
          const inTerm = room.terminal.store[n.resource] || 0;
          if (inTerm > 0) {
            lines.push("    в терминале уже: " + inTerm);
          }
        }
      }
      return lines.join("\n");
    },

    /**
     * Отменить задание на переброску.
     * C.Terminal.moveCancel("E35S37", "E36S38", "energy")
     */
    moveCancel: function (fromRoom, toRoom, resource) {
      const mem = Memory.rooms && Memory.rooms[fromRoom];
      if (!mem || !mem.terminalNeeds) return "❌ Нет заданий в: " + fromRoom;

      const before = mem.terminalNeeds.length;
      mem.terminalNeeds = mem.terminalNeeds.filter(
        n => !(n.resource === resource && n.toRoom === toRoom),
      );
      const after = mem.terminalNeeds.length;

      if (before === after) {
        return (
          "❌ Задание не найдено: " + resource + " " + fromRoom + " → " + toRoom
        );
      }
      return (
        "✅ Задание отменено: " +
        resource +
        " storage(" +
        fromRoom +
        ") → storage(" +
        toRoom +
        ")"
      );
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
    deleteField: function (roomName, key) {
      if (!Memory.rooms || !Memory.rooms[roomName])
        return "❌ Память комнаты не найдена: " + roomName;
      delete Memory.rooms[roomName][key];
      return "✅ " + roomName + "." + key + " удалено";
    },
    compare: function () {
      const D = require("diagnostic");
      return D.memoryAll();
    },
    restore: function (roomName) {
      const DEFAULTS = {
        energyTargets: [],
        hasSites: false,
        needsRepair: false,
        earlySpawnThresholds: { miner: 43 },
        terminalNeeds: [],
        terminalMode: "toTerminal",
        labWorkerIndex: 0,
      };
      Memory.rooms = Memory.rooms || {};
      Memory.rooms[roomName] = Memory.rooms[roomName] || {};
      const mem = Memory.rooms[roomName];
      const restored = [];
      for (const key in DEFAULTS) {
        if (!(key in mem)) {
          mem[key] = DEFAULTS[key];
          restored.push(key);
        }
      }
      if (restored.length === 0) return "✅ " + roomName + " — всё на месте";
      return "✅ восстановлено в " + roomName + ": " + restored.join(", ");
    },
  },
};

module.exports = Control;
