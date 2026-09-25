"use strict";
/**
 * ===================================================
 * TRAVELER.BORDER.TEST.JS — оффлайн-проверка перехода границы комнат
 * ===================================================
 * Симптом из игры: крипы дальней добычи (remoteMiner / remoteHauler /
 * reserver) не могут перейти границу между комнатами — они идут к границе,
 * но в соседнюю комнату не попадают.
 *
 * Харнесс подменяет только окружение Screeps (Game / Memory / RoomPosition /
 * PathFinder / Room), а движение выполняет НАСТОЯЩИЙ код traveler.js.
 *
 * Запуск: node tests/traveler.border.test.js
 */

const assert = require("assert");
const _ = require("lodash");

// ── ГЕОМЕТРИЯ МИРА ──────────────────────────────────────────────────────
// Направления Screeps: 1 top, 2 top-right, 3 right, 4 bottom-right,
// 5 bottom, 6 bottom-left, 7 left, 8 top-left.
const DIR_OFFSET = {
  1: [0, -1],
  2: [1, -1],
  3: [1, 0],
  4: [1, 1],
  5: [0, 1],
  6: [-1, 1],
  7: [-1, 0],
  8: [-1, -1],
};

const ROOM_RE = /^([WE])(\d+)([NS])(\d+)$/;

function parseRoom(name) {
  const m = ROOM_RE.exec(name);
  return { ew: m[1], e: Number(m[2]), ns: m[3], s: Number(m[4]) };
}

function formatRoom(r) {
  return `${r.ew}${r.e}${r.ns}${r.s}`;
}

/** Соседняя комната в направлении dir (мир без краёв: E/W и N/S бесконечны). */
function neighborRoom(name, dir) {
  const r = parseRoom(name);
  const [dx, dy] = DIR_OFFSET[dir];
  if (dx !== 0) {
    if (r.ew === "E") {
      if (dx > 0) r.e += 1;
      else if (r.e > 1) r.e -= 1;
      else {
        r.ew = "W";
        r.e = 0;
      }
    } else {
      if (dx < 0) r.e += 1;
      else if (r.e > 0) r.e -= 1;
      else {
        r.ew = "E";
        r.e = 1;
      }
    }
  }
  if (dy !== 0) {
    if (r.ns === "S") {
      if (dy > 0) r.s += 1;
      else if (r.s > 1) r.s -= 1;
      else {
        r.ns = "N";
        r.s = 0;
      }
    } else {
      if (dy < 0) r.s += 1;
      else if (r.s > 0) r.s -= 1;
      else {
        r.ns = "S";
        r.s = 1;
      }
    }
  }
  return formatRoom(r);
}

/**
 * Позиция после шага в направлении dir с учётом перехода границы комнаты.
 * Именно так ведёт себя creep.move() в игре.
 */
function step(pos, dir) {
  let x = pos.x + DIR_OFFSET[dir][0];
  let y = pos.y + DIR_OFFSET[dir][1];
  let roomName = pos.roomName;
  if (x < 0) {
    roomName = neighborRoom(roomName, 7);
    x = 49;
  } else if (x > 49) {
    roomName = neighborRoom(roomName, 3);
    x = 0;
  }
  if (y < 0) {
    roomName = neighborRoom(roomName, 1);
    y = 49;
  } else if (y > 49) {
    roomName = neighborRoom(roomName, 5);
    y = 0;
  }
  return new RoomPosition(x, y, roomName);
}

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  inRangeTo(target, range) {
    return this.getRangeTo(target) <= range;
  }
  getRangeTo(target) {
    if (target.roomName !== undefined && target.roomName !== this.roomName) {
      return Infinity; // как в игре: разные комнаты -> Infinity
    }
    return Math.max(Math.abs(this.x - target.x), Math.abs(this.y - target.y));
  }
  getDirectionTo(target) {
    const dx = Math.sign(target.x - this.x);
    const dy = Math.sign(target.y - this.y);
    for (const dir of Object.keys(DIR_OFFSET)) {
      if (DIR_OFFSET[dir][0] === dx && DIR_OFFSET[dir][1] === dy) {
        return Number(dir);
      }
    }
    return 0;
  }
  isEqualTo(x, y) {
    if (typeof x === "object") return this.x === x.x && this.y === x.y;
    return this.x === x && this.y === y;
  }
  toString() {
    return `[room ${this.roomName} pos ${this.x},${this.y}]`;
  }
}

// ── ОКРУЖЕНИЕ SCREEPS ───────────────────────────────────────────────────
global._ = _;
global.Memory = {};
global.OK = 0;
global.ERR_NO_PATH = -2;
global.ERR_BUSY = -4;
global.ERR_INVALID_ARGS = -10;
global.FIND_STRUCTURES = 1;
global.FIND_CONSTRUCTION_SITES = 2;
global.FIND_CREEPS = 3;
global.FIND_SOURCES = 4;
global.FIND_DROPPED_RESOURCES = 5;
global.STRUCTURE_CONTAINER = "container";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_RAMPART = "rampart";
global.StructureRampart = class StructureRampart {};
global.StructureRoad = class StructureRoad {};
global.RoomPosition = RoomPosition;

global.Game = {
  time: 1000,
  cpu: { getUsed: () => 0 },
  rooms: {},
  map: {
    getRoomLinearDistance: (a, b) => {
      const ra = parseRoom(a);
      const rb = parseRoom(b);
      return (
        Math.abs(
          (ra.ew === "E" ? ra.e : -ra.e) - (rb.ew === "E" ? rb.e : -rb.e),
        ) +
        Math.abs(
          (ra.ns === "S" ? ra.s : -ra.s) - (rb.ns === "S" ? rb.s : -rb.s),
        )
      );
    },
    findRoute: () => ERR_NO_PATH,
  },
};

function makeRoom(name) {
  return {
    name,
    controller: null,
    find: () => [],
    storage: null,
  };
}

/**
 * PathFinder-стаб: BFS по сетке комнат (8 направлений, без стен).
 * Возвращает {path, ops, incomplete, cost} — как настоящий API.
 */
global.PathFinder = {
  CostMatrix: class CostMatrix {
    clone() {
      return this;
    }
    set() {}
  },
  search(origin, goal, opts) {
    const goalPos = goal.pos;
    const range = goal.range === undefined ? 0 : goal.range;
    const key = p => `${p.roomName}:${p.x}:${p.y}`;
    const allowed = roomName => {
      if (!opts || !opts.roomCallback) return true;
      return opts.roomCallback(roomName) !== false;
    };

    const start = { roomName: origin.roomName, x: origin.x, y: origin.y };
    const from = { [key(start)]: null };
    const queue = [start];
    let found = null;

    while (queue.length > 0) {
      const cur = queue.shift();
      const pos = new RoomPosition(cur.x, cur.y, cur.roomName);
      if (pos.inRangeTo(goalPos, range)) {
        found = cur;
        break;
      }
      for (const dir of Object.keys(DIR_OFFSET)) {
        const next = step(pos, Number(dir));
        if (!allowed(next.roomName)) continue;
        const nk = key(next);
        if (from[nk] !== undefined) continue;
        from[nk] = cur;
        queue.push({ roomName: next.roomName, x: next.x, y: next.y });
      }
    }

    if (!found) return { path: [], ops: 0, incomplete: true, cost: Infinity };

    const path = [];
    let node = found;
    while (
      node &&
      !(
        node.roomName === start.roomName &&
        node.x === start.x &&
        node.y === start.y
      )
    ) {
      path.unshift(new RoomPosition(node.x, node.y, node.roomName));
      node = from[key(node)];
    }
    return { path, ops: path.length, incomplete: false, cost: path.length };
  },
};

const Traveler = require("../traveler")({
  exportTraveler: true,
  installTraveler: false,
  installPrototype: false,
});

// ── ФЕЙКОВЫЙ КРИП ───────────────────────────────────────────────────────
function makeCreep(x, y, roomName) {
  return {
    name: `remoteMiner_${roomName}_1`,
    pos: new RoomPosition(x, y, roomName),
    memory: {},
    fatigue: 0,
    spawning: false,
    moved: 0,
    get room() {
      // Путь через границу может задеть промежуточную комнату, которой нет в
      // Game.rooms (в игре она всегда существует, пока крип в ней). Создаём
      // пустую комнату на лету, иначе обращения вида creep.room.controller
      // роняют тест — это ограничение харнесса, а не кода Traveler.
      const name = this.pos.roomName;
      if (!global.Game.rooms[name]) {
        global.Game.rooms[name] = makeRoom(name);
      }
      return global.Game.rooms[name];
    },
    move(dir) {
      if (this.fatigue > 0) return ERR_BUSY;
      this.pos = step(this.pos, dir);
      this.moved++;
      return OK;
    },
  };
}

let passed = 0;
const originalLog = console.log;
function ok(msg) {
  passed++;
  originalLog("  ok  " + msg);
}

// ── СЦЕНАРИЙ 1: переход границы из домашней комнаты в соседнюю ──────────
function simulateCrossRoom(startX, startY, destX, destY, opts = {}) {
  global.Game.rooms = {
    E35S37: makeRoom("E35S37"),
    E35S38: makeRoom("E35S38"),
  };
  global.Memory = {};
  const traveler = new Traveler();
  const creep = makeCreep(startX, startY, "E35S37");
  const dest = new RoomPosition(destX, destY, "E35S38");

  if (opts.debug) {
    const ret = traveler.findTravelPath(creep, dest, {});
    originalLog("DEBUG path:", ret.path.map(String).join(" "));
    originalLog(
      "DEBUG serialized:",
      JSON.stringify(Traveler.serializePath(creep.pos, ret.path)),
    );
  }

  const trace = [];
  for (let i = 0; i < (opts.maxTicks || 120); i++) {
    global.Game.time = 1000 + i;
    const td = creep.memory._travel || {};
    const before = `${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}`;
    let outcome;
    try {
      outcome = traveler.travelTo(creep, dest);
    } catch (e) {
      originalLog(
        `CRASH tick=${i} pos=${before} path=${JSON.stringify(td.path)} ` +
          `dest=${JSON.stringify(td.dest)} err=${e.message}`,
      );
      throw e;
    }
    if (opts.debug) {
      originalLog(
        `  t=${i} ${before} -> ${creep.pos.roomName}:${creep.pos.x},${creep.pos.y} ` +
          `out=${outcome} path=${JSON.stringify(creep.memory._travel.path)}`,
      );
    }
    trace.push(`${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}`);
    if (creep.pos.roomName === "E35S38" && creep.pos.inRangeTo(dest, 1)) break;
  }
  return { creep, trace };
}

// сценарий A: цель строго на восток (прямой проход через границу)
{
  const { creep, trace } = simulateCrossRoom(25, 25, 25, 25, { debug: true });
  if (creep.pos.roomName !== "E35S38") {
    originalLog("Трасса A (провал): " + trace.join(" -> "));
  }
  assert.strictEqual(creep.pos.roomName, "E35S38", "A: крип вышел в соседнюю комнату");
  ok("переход границы по прямой (25,25) -> (25,25) в E35S38");
}

// сценарий B: цель в центре соседней комнаты, но старт со смещением —
// путь входит в комнату под углом (после границы первый шаг не «продолжение»)
{
  const { creep, trace } = simulateCrossRoom(10, 40, 25, 25);
  if (creep.pos.roomName !== "E35S38") {
    originalLog("Трасса B (провал): " + trace.join(" -> "));
  }
  assert.strictEqual(creep.pos.roomName, "E35S38", "B: крип вышел в соседнюю комнату");
  ok("переход границы при старте со смещением (10,40) -> (25,25)");
}

// сценарий C: цель у самой границы соседней комнаты
{
  const { creep, trace } = simulateCrossRoom(25, 25, 1, 25);
  if (creep.pos.roomName !== "E35S38") {
    originalLog("Трасса C (провал): " + trace.join(" -> "));
  }
  assert.strictEqual(creep.pos.roomName, "E35S38", "C: крип вышел в соседнюю комнату");
  ok("переход границы к цели у самой кромки (1,25)");
}

// ── СЦЕНАРИЙ 2: движение внутри комнаты (не должно сломаться) ───────────
{
  global.Game.rooms = { E35S37: makeRoom("E35S37") };
  global.Memory = {};
  const traveler = new Traveler();
  const creep = makeCreep(10, 10, "E35S37");
  const dest = new RoomPosition(10, 6, "E35S37");
  global.Game.time = 1000;
  traveler.travelTo(creep, dest);
  assert.strictEqual(creep.moved, 1, "обычный путь: один шаг");
  assert.strictEqual(creep.pos.y, 9, "обычный путь: шаг вверх");
  ok("движение внутри комнаты не изменено");
}

// ── СЦЕНАРИЙ 3: разбор сериализации пути через границу ──────────────────
{
  const start = new RoomPosition(48, 25, "E35S37");
  const path = [
    new RoomPosition(49, 25, "E35S37"),
    new RoomPosition(0, 25, "E35S38"), // <- переход границы
    new RoomPosition(1, 25, "E35S38"),
  ];
  const serialized = Traveler.serializePath(start, path);
  originalLog("  сериализованный путь через границу: " + JSON.stringify(serialized));
  assert.strictEqual(
    serialized.length,
    path.length,
    "каждая клетка пути должна дать ровно один шаг",
  );
  ok("сериализация пути сохраняет шаг перехода границы");
}

originalLog("\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: " + passed);
