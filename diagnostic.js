/**
 * ===================================================
 * DIAGNOSTIC.JS — Диагностика состояния империи
 * ===================================================
 * VERSION: 2.0
 *
 * Использование из консоли:
 *   const D = require("diagnostic");
 *
 *   D.empire()            — полная сводка по всей империи
 *   D.room("E35S37")      — детальное состояние комнаты
 *   D.terminal("E35S37")  — содержимое терминала
 *   D.creeps("E35S37")    — крипы комнаты
 *   D.creep("Worker1")    — детали одного крипа
 *   D.overrides()         — все активные override
 *   D.balance()           — энергия по всей империи
 *   D.cpu()               — использование CPU
 * ===================================================
 */

const Diagnostic = {
  // ── EMPIRE ───────────────────────────────────────────────────────────────
  empire: function () {
    const lines = [];
    const paused = Memory.empire && Memory.empire.paused;

    lines.push(
      "=== EMPIRE  tick:" +
        Game.time +
        "  CPU:" +
        Game.cpu.getUsed().toFixed(1) +
        "/" +
        Game.cpu.limit +
        "  bucket:" +
        Game.cpu.bucket +
        " ===",
    );
    lines.push("Режим: " + (paused ? "⛔ PAUSED" : "✅ AUTO"));

    const allCreeps = Object.values(Game.creeps);
    const overrideCount = allCreeps.filter(c => c.memory.override).length;
    lines.push(
      "Крипов всего: " + allCreeps.length + "  override: " + overrideCount,
    );
    lines.push("");

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const mem = (Memory.rooms && Memory.rooms[roomName]) || {};
      const roomPaused = mem.paused ? " ⛔PAUSED" : "";
      const mode = mem.terminalMode ? " mode:" + mem.terminalMode : "";

      // Storage
      const storage = room.storage;
      const stEnergy = storage ? storage.store[RESOURCE_ENERGY] : null;
      const stStr = storage ? "storage:" + _fmt(stEnergy) : "storage:❌";

      // Terminal
      const term = room.terminal;
      let termStr = "terminal:❌";
      if (term) {
        const tEnergy = term.store[RESOURCE_ENERGY] || 0;
        const used = term.store.getUsedCapacity();
        const cap = term.store.getCapacity();
        const pct = Math.round((used / cap) * 100);
        const fill = pct > 90 ? "🔴" : pct > 70 ? "🟡" : "🟢";
        termStr = "terminal:" + fill + _fmt(tEnergy) + "nrg(" + pct + "%)";
      }

      // Spawns
      const spawns = room.find(FIND_MY_SPAWNS);
      const busy = spawns.filter(s => s.spawning).length;
      const spawnStr =
        "spawns:" + spawns.length + (busy > 0 ? "(⚙" + busy + ")" : "");

      // Creeps
      const creeps = _.filter(Game.creeps, c => c.memory.room === roomName);
      const ov = creeps.filter(c => c.memory.override).length;
      const creepStr =
        "creeps:" + creeps.length + (ov > 0 ? "(ov:" + ov + ")" : "");

      lines.push(
        roomName +
          roomPaused +
          mode +
          "  " +
          stStr +
          "  " +
          termStr +
          "  " +
          spawnStr +
          "  " +
          creepStr,
      );

      // Предупреждения
      if (stEnergy !== null && stEnergy < 50000) {
        lines.push("  ⚠ storage низкий: " + _fmt(stEnergy));
      }
      if (term && (term.store[RESOURCE_ENERGY] || 0) < 20000) {
        lines.push(
          "  ⚠ terminal мало энергии: " + (term.store[RESOURCE_ENERGY] || 0),
        );
      }
    }

    return lines.join("\n");
  },

  // ── ROOM ─────────────────────────────────────────────────────────────────
  room: function (roomName) {
    const room = Game.rooms[roomName];
    if (!room) return "Комната не видна: " + roomName;

    const lines = ["=== ROOM: " + roomName + " ==="];
    const mem = (Memory.rooms && Memory.rooms[roomName]) || {};

    // Контроллер
    if (room.controller) {
      const ctrl = room.controller;
      const pct =
        ctrl.progressTotal > 0
          ? Math.floor((ctrl.progress / ctrl.progressTotal) * 100) + "%"
          : "MAX";
      lines.push("RCL: " + ctrl.level + " (" + pct + ")");
    }
    lines.push(
      "paused: " +
        (mem.paused ? "⛔ да" : "нет") +
        "  terminalMode: " +
        (mem.terminalMode || "—"),
    );

    // Spawns
    const spawns = room.find(FIND_MY_SPAWNS);
    lines.push("\n--- Спавны ---");
    for (const s of spawns) {
      lines.push(
        "  " +
          s.name +
          ": " +
          (s.spawning
            ? "⚙ [" +
              s.spawning.name +
              "] осталось " +
              s.spawning.remainingTime +
              "t"
            : "свободен"),
      );
    }

    // Storage
    lines.push("\n--- Storage ---");
    if (room.storage) {
      const st = room.storage.store;
      lines.push("  energy: " + _fmt(st[RESOURCE_ENERGY] || 0));
      for (const res in st) {
        if (res === RESOURCE_ENERGY) continue;
        if (st[res] > 0) lines.push("  " + res + ": " + st[res]);
      }
    } else {
      lines.push("  ❌ нет");
    }

    // Terminal
    lines.push("\n--- Terminal ---");
    if (room.terminal) {
      const term = room.terminal;
      const used = term.store.getUsedCapacity();
      const cap = term.store.getCapacity();
      const pct = Math.round((used / cap) * 100);
      lines.push(
        "  заполнен: " +
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
      if (resources.length === 0) {
        lines.push("  (пусто)");
      } else {
        for (const [res, amt] of resources) {
          lines.push("  " + res + ": " + amt);
        }
      }
    } else {
      lines.push("  ❌ нет");
    }

    // Sources
    const sources = room.find(FIND_SOURCES);
    lines.push("\n--- Источники ---");
    for (const src of sources) {
      lines.push(
        "  " +
          src.id.slice(-6) +
          " " +
          src.energy +
          "/" +
          src.energyCapacity +
          (src.ticksToRegeneration > 0
            ? " (regen:" + src.ticksToRegeneration + "t)"
            : ""),
      );
    }

    // Creeps by role
    const creeps = _.filter(Game.creeps, c => c.memory.room === roomName);
    const byRole = {};
    for (const c of creeps) {
      const r = c.memory.role || "?";
      byRole[r] = (byRole[r] || 0) + 1;
    }
    lines.push("\n--- Крипы (" + creeps.length + ") ---");
    for (const role in byRole) {
      lines.push("  " + role + ": " + byRole[role]);
    }

    return lines.join("\n");
  },

  // ── TERMINAL ─────────────────────────────────────────────────────────────
  terminal: function (roomName) {
    const room = Game.rooms[roomName];
    if (!room) return "Комната не видна: " + roomName;
    const term = room.terminal;
    if (!term) return "Терминал не найден: " + roomName;

    const lines = ["=== TERMINAL: " + roomName + " ==="];
    const used = term.store.getUsedCapacity();
    const cap = term.store.getCapacity();
    const pct = Math.round((used / cap) * 100);
    const fill = pct > 90 ? "🔴" : pct > 70 ? "🟡" : "🟢";

    lines.push(
      fill +
        " " +
        used +
        "/" +
        cap +
        " (" +
        pct +
        "%)  cooldown: " +
        term.cooldown,
    );
    lines.push("");

    const resources = Object.entries(term.store)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);

    if (resources.length === 0) {
      lines.push("  (пусто)");
    } else {
      for (const [res, amt] of resources) {
        lines.push("  " + _pad(res, 20) + ": " + amt);
      }
    }

    return lines.join("\n");
  },

  // ── BALANCE ───────────────────────────────────────────────────────────────
  balance: function () {
    const lines = ["=== BALANCE (энергия) ==="];

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const stE = room.storage ? room.storage.store[RESOURCE_ENERGY] || 0 : 0;
      const tE = room.terminal ? room.terminal.store[RESOURCE_ENERGY] || 0 : 0;
      const total = stE + tE;

      const icon = total < 50000 ? "🔴" : total < 150000 ? "🟡" : "🟢";
      lines.push(
        "  " +
          icon +
          " " +
          roomName +
          "  storage:" +
          _fmt(stE) +
          "  terminal:" +
          _fmt(tE) +
          "  total:" +
          _fmt(total),
      );
    }

    return lines.join("\n");
  },

  // ── CREEPS LIST ───────────────────────────────────────────────────────────
  creeps: function (roomName) {
    const creeps = _.filter(Game.creeps, c => c.memory.room === roomName);
    if (!creeps.length) return "Нет крипов в комнате: " + roomName;

    const lines = ["=== CREEPS: " + roomName + " ==="];
    for (const c of creeps) {
      const ov = c.memory.override;
      const ovStr = ov ? " [OV:" + ov.type + "]" : "";
      const ttl = c.ticksToLive ? " TTL:" + c.ticksToLive : "";
      lines.push(
        "  " +
          c.name +
          " [" +
          (c.memory.role || "?") +
          "]" +
          " ❤" +
          c.hits +
          "/" +
          c.hitsMax +
          ttl +
          ovStr,
      );
    }
    return lines.join("\n");
  },

  // ── SINGLE CREEP ─────────────────────────────────────────────────────────
  creep: function (name) {
    const c = Game.creeps[name];
    if (!c) return "Крип не найден: " + name;

    const lines = ["=== CREEP: " + name + " ==="];
    lines.push(
      "role: " +
        (c.memory.role || "?") +
        "  room: " +
        c.memory.room +
        "  pos: " +
        c.pos.x +
        "," +
        c.pos.y,
    );
    lines.push(
      "HP: " + c.hits + "/" + c.hitsMax + "  TTL: " + (c.ticksToLive || "N/A"),
    );
    lines.push(
      "груз: " + c.store.getUsedCapacity() + "/" + c.store.getCapacity(),
    );
    if (c.store.getUsedCapacity() > 0) {
      for (const res in c.store) {
        if (c.store[res] > 0) lines.push("  " + res + ": " + c.store[res]);
      }
    }
    const ov = c.memory.override;
    lines.push("override: " + (ov ? JSON.stringify(ov) : "нет"));
    const memCopy = Object.assign({}, c.memory);
    delete memCopy.override;
    lines.push("memory: " + JSON.stringify(memCopy));
    return lines.join("\n");
  },

  // ── OVERRIDES ─────────────────────────────────────────────────────────────
  overrides: function () {
    const lines = ["=== АКТИВНЫЕ OVERRIDE ==="];
    let count = 0;
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      if (!c.memory.override) continue;
      count++;
      lines.push(
        "  " +
          name +
          " [" +
          (c.memory.role || "?") +
          "] [" +
          c.memory.room +
          "] → " +
          JSON.stringify(c.memory.override),
      );
    }
    if (count === 0) lines.push("  нет");
    else lines.push("Итого: " + count);
    return lines.join("\n");
  },

  // ── CPU ───────────────────────────────────────────────────────────────────
  cpu: function () {
    const used = Game.cpu.getUsed();
    const limit = Game.cpu.limit;
    const pct = Math.floor((used / limit) * 100);
    const icon = pct > 90 ? "⛔" : pct > 70 ? "⚠" : "✅";

    const lines = ["=== CPU ==="];
    lines.push(
      icon +
        " " +
        used.toFixed(2) +
        " / " +
        limit +
        " (" +
        pct +
        "%)  bucket: " +
        Game.cpu.bucket,
    );

    try {
      const cpuMon = require("cpuMonitor");
      if (cpuMon && cpuMon.getReport) {
        lines.push("");
        lines.push(cpuMon.getReport());
      }
    } catch (e) {}

    return lines.join("\n");
  },

  // ── HELP ─────────────────────────────────────────────────────────────────
  help: function () {
    return [
      "=== DIAGNOSTIC ===",
      "  D.empire()            — сводка по всей империи",
      "  D.room('E35S37')      — детали комнаты",
      "  D.terminal('E35S37')  — содержимое терминала",
      "  D.creeps('E35S37')    — крипы комнаты",
      "  D.creep('Worker1')    — детали крипа",
      "  D.overrides()         — все активные override",
      "  D.balance()           — энергия по империи",
      "  D.cpu()               — CPU",
    ].join("\n");
  },
};

// ── УТИЛИТЫ ──────────────────────────────────────────────────────────────
function _fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function _pad(str, len) {
  while (str.length < len) str += " ";
  return str;
}

module.exports = Diagnostic;
