"use strict";
/**
 * ===================================================
 * REMOTE.BORDER.ROLE.TEST.JS — роль дальнего майнера + настоящий traveler.js
 * ===================================================
 * Симптом (живая игра, shard3): дальние крипы осциллируют через границу,
 *   (23,0) E35S38 -> (23,49) E35S37 -> (23,0) E35S38 -> ...
 * т.е. «не могут перейти границу» — каждый тик возвращаются назад.
 *
 * Здесь выполняется НАСТОЯЩИЙ код remote.miner.run + traveler.js в
 * минимально заглушённом мире Screeps (две комнаты: E35S37 сверху,
 * E35S38 снизу; источник (36,32) и настроенная рабочая клетка контейнера
 * (37,32) в удалённой комнате — constants.REMOTE.ROOM_TO_CONTAINER_POS).
 *
 * Запуск: node tests/remote.border.role.test.js
 */

const _ = require("lodash");

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

function neighborRoom(name, dir) {
  const r = parseRoom(name);
  const [dx, dy] = DIR_OFFSET[dir];
  if (dx !== 0) {
    if (r.ew === "E") {
      if (dx > 0) r.e += 1;
      else r.e -= 1;
    } else if (dx < 0) r.e += 1;
    else r.e -= 1;
  }
  if (dy !== 0) {
    if (r.ns === "S") {
      if (dy > 0) r.s += 1;
      else r.s -= 1;
    } else if (dy < 0) r.s += 1;
    else r.s -= 1;
  }
  return `${r.ew}${r.e}${r.ns}${r.s}`;
}

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

const WORLD = { structures: [], sources: [], sites: [], objects: {} };

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  inRangeTo(target, range) {
    return this.getRangeTo(target) <= range;
  }
  isNearTo(target) {
    return this.getRangeTo(target) <= 1;
  }
  /** Как в игре: принимает и RoomPosition, и объект с .pos. */
  resolve(target) {
    return target && target.pos ? target.pos : target;
  }
  getRangeTo(target) {
    const t = this.resolve(target);
    if (t.roomName !== undefined && t.roomName !== this.roomName) {
      return Infinity;
    }
    return Math.max(Math.abs(this.x - t.x), Math.abs(this.y - t.y));
  }
  getDirectionTo(target) {
    const t = this.resolve(target);
    const dx = Math.sign(t.x - this.x);
    const dy = Math.sign(t.y - this.y);
    for (const dir of Object.keys(DIR_OFFSET)) {
      if (DIR_OFFSET[dir][0] === dx && DIR_OFFSET[dir][1] === dy) {
        return Number(dir);
      }
    }
    return 0;
  }
  isEqualTo(x, y) {
    const t = this.resolve(x);
    if (typeof x === "object") return this.x === t.x && this.y === t.y;
    return this.x === x && this.y === y;
  }
  findInRange(type, range, opts) {
    const pool =
      type === FIND_STRUCTURES
        ? WORLD.structures
        : type === FIND_CONSTRUCTION_SITES
          ? WORLD.sites
          : type === FIND_SOURCES
            ? WORLD.sources
            : [];
    const filter = opts && opts.filter;
    return pool.filter(
      o =>
        o.pos.roomName === this.roomName &&
        this.getRangeTo(o.pos) <= range &&
        (!filter || filter(o)),
    );
  }
  // Площадка ставится в игре на ТОЙ клетке, от которой вызван метод: в моке
  // запоминаем её так же, как реальный API (в WORLD.sites и по id в
  // WORLD.objects), иначе роль не найдёт площадку поиском findInRange и будет
  // ставить её каждый тик (в игре — ERR_INVALID_TARGET).
  createConstructionSite(structureType) {
    const site = {
      id: `site-${WORLD.sites.length + 1}`,
      pos: new RoomPosition(this.x, this.y, this.roomName),
      room: { name: this.roomName },
      structureType,
      progress: 0,
      progressTotal: 5000,
    };
    WORLD.sites.push(site);
    WORLD.objects[site.id] = site;
    return OK;
  }
  findClosestByRange(type, opts) {
    // Как в игре: принимает и FIND_*-константу, и готовый массив объектов.
    const pool = Array.isArray(type)
      ? type
      : type === FIND_SOURCES
        ? WORLD.sources
        : type === FIND_STRUCTURES
          ? WORLD.structures
          : [];
    const filter = opts && opts.filter;
    let best = null;
    for (const o of pool) {
      if (filter && !filter(o)) continue;
      const r = this.getRangeTo(o.pos);
      if (r === Infinity) continue;
      if (!best || r < best.r) best = { o, r };
    }
    return best ? best.o : null;
  }
  toString() {
    return `[room ${this.roomName} pos ${this.x},${this.y}]`;
  }
}

// ── ГЛОБАЛЬНЫЕ КОНСТАНТЫ SCREEPS ────────────────────────────────────────
global._ = _;
global.Memory = {};
global.OK = 0;
global.ERR_NO_PATH = -2;
global.ERR_BUSY = -4;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_INVALID_ARGS = -10;
global.ERR_FULL = -8;
global.FIND_STRUCTURES = 1;
global.FIND_CONSTRUCTION_SITES = 2;
global.FIND_CREEPS = 3;
global.FIND_SOURCES = 4;
global.FIND_DROPPED_RESOURCES = 5;
global.FIND_MY_STRUCTURES = 6;
global.STRUCTURE_CONTAINER = "container";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_LINK = "link";
global.StructureRampart = class StructureRampart {};
global.StructureRoad = class StructureRoad {};
global.RESOURCE_ENERGY = "energy";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.HARVEST_POWER = 2;
global.ENERGY_REGEN_TIME = 300;
global.RoomPosition = RoomPosition;

global.Game = {
  time: 1000,
  cpu: { getUsed: () => 0 },
  rooms: {},
  creeps: {},
  getObjectById: id => {
    const o = WORLD.objects[id] || null;
    if (process.env.DEBUG) {
      console.log(`    [getObjectById(${id}) -> ${o ? o.pos || "?" : "null"}]`);
    }
    return o;
  },
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

// ── РЕАЛЬНЫЙ TERREIN (снимок /tmp/rooms.json) ───────────────────────────
const SNAP = require("/tmp/rooms.json");
const TERRAIN = {};
for (const room of Object.keys(SNAP)) {
  const t = SNAP[room].terrain;
  TERRAIN[room] = t && t[0] ? t[0].terrain : t;
}
function terrainCost(room, x, y) {
  const t = TERRAIN[room];
  if (!t) return 2; // неизвестная комната — равнина (как «нет видимости»)
  const c = t.charAt(y * 50 + x);
  if (c === "1") return Infinity;
  return c === "2" ? 10 : 2;
}

global.PathFinder = {
  CostMatrix: class CostMatrix {
    constructor() {
      this.cells = new Uint8Array(2500);
    }
    clone() {
      const m = new PathFinder.CostMatrix();
      m.cells.set(this.cells);
      return m;
    }
    set(x, y, v) {
      this.cells[y * 50 + x] = v;
    }
    get(x, y) {
      return this.cells[y * 50 + x];
    }
  },
  // Dijkstra со стоимостью как в игре: значение CostMatrix важнее террейна,
  // 0xff — непроходимо, 0 — стоимость террейна.
  search(origin, goal, opts) {
    const goalPos = goal.pos;
    const range = goal.range === undefined ? 0 : goal.range;
    const key = p => `${p.roomName}:${p.x}:${p.y}`;
    const matrices = {};
    const matrixFor = roomName => {
      if (roomName in matrices) return matrices[roomName];
      let m = undefined;
      if (opts && opts.roomCallback) {
        const res = opts.roomCallback(roomName);
        if (res === false) m = false;
        else if (res) m = res;
      }
      matrices[roomName] = m;
      return m;
    };
    const stepCost = roomName => {
      const m = matrixFor(roomName);
      return (x, y) => {
        const mv = m ? m.get(x, y) : 0;
        if (mv === 0xff) return Infinity;
        if (mv) return mv;
        return terrainCost(roomName, x, y);
      };
    };

    const start = { roomName: origin.roomName, x: origin.x, y: origin.y };
    const from = { [key(start)]: null };
    const dist = { [key(start)]: 0 };
    const pq = [{ p: start, d: 0 }];
    let found = null;
    while (pq.length) {
      pq.sort((a, b) => b.d - a.d);
      const { p, d } = pq.pop();
      if (d > (dist[key(p)] ?? Infinity)) continue;
      const pos = new RoomPosition(p.x, p.y, p.roomName);
      if (pos.inRangeTo(goalPos, range)) {
        found = p;
        break;
      }
      for (const dir of Object.keys(DIR_OFFSET)) {
        const next = step(pos, Number(dir));
        const m = matrixFor(next.roomName);
        if (m === false) continue;
        const c = stepCost(next.roomName)(next.x, next.y);
        if (!isFinite(c)) continue;
        const nd = d + c;
        const nk = key(next);
        if (nd < (dist[nk] ?? Infinity)) {
          dist[nk] = nd;
          from[nk] = p;
          pq.push({ p: { roomName: next.roomName, x: next.x, y: next.y }, d: nd });
        }
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
    return { path, ops: path.length, incomplete: false, cost: dist[key(found)] };
  },
};

global.Creep = class Creep {};

require("../traveler")({
  exportTraveler: false,
  installTraveler: false,
  installPrototype: true,
});

const roleRemoteMiner = require("../remote.miner");

// ── МИР ─────────────────────────────────────────────────────────────────
class Store {
  constructor(capacity) {
    this.energy = 0;
    this.capacity = capacity;
  }
  getFreeCapacity(resource) {
    if (resource !== undefined && resource !== RESOURCE_ENERGY) return 0;
    return this.capacity - this.energy;
  }
  getCapacity() {
    return this.capacity;
  }
}

// Структуры из живого снимка — чтобы addStructuresToMatrix построил
// ТУ ЖЕ матрицу, что и в игре (дороги = 1, прочие структуры = 0xff).
// API отдаёт структуры как {type:"road"} без structureType, поэтому берём
// structureType || type. Рампарты наши (комнаты империи) -> проходимы.
const STRUCT_TYPES = new Set([
  "road",
  "rampart",
  "constructedWall",
  "extension",
  "spawn",
  "storage",
  "terminal",
  "tower",
  "link",
  "lab",
  "factory",
  "powerSpawn",
  "extractor",
  "container",
  "controller",
  "nuker",
  "observer",
]);
const STRUCTS = {};
for (const room of Object.keys(SNAP)) {
  STRUCTS[room] = (SNAP[room].objects || [])
    .filter(o => STRUCT_TYPES.has(o.structureType || o.type))
    .map(o => {
      const st = o.structureType || o.type;
      const base = {
        pos: new RoomPosition(o.x, o.y, room),
        room: { name: room },
        structureType: st,
        my: st === "rampart",
        hits: o.hits || 1000,
        hitsMax: o.hits || 1000,
      };
      if (st === "road") return Object.assign(new StructureRoad(), base);
      if (st === "rampart") return Object.assign(new StructureRampart(), base);
      return base;
    })
    // источник/контроллер/минерал — не структуры для FIND_STRUCTURES
    .filter(o => o.structureType !== "controller");
}

function makeRoom(name) {
  return {
    name,
    controller: null,
    storage: null,
    find: type => {
      if (type === FIND_SOURCES) {
        return WORLD.sources.filter(o => o.pos.roomName === name);
      }
      if (type === FIND_STRUCTURES) return STRUCTS[name] || [];
      return [];
    },
    findClosestByRange: () => null,
  };
}

function makeSource(id, x, y, roomName, capacity = 3000) {
  const source = {
    id,
    pos: new RoomPosition(x, y, roomName),
    room: { name: roomName },
    energy: capacity,
    energyCapacity: capacity,
  };
  WORLD.sources.push(source);
  WORLD.objects[id] = source;
  return source;
}

function makeCreep(id, x, y, roomName, capacity = 100) {
  const creep = {
    id,
    name: id,
    body: [],
    memory: { role: "remoteMiner", targetRoom: "E35S38" },
    pos: new RoomPosition(x, y, roomName),
    store: new Store(capacity),
    fatigue: 0,
    spawning: false,
    hits: 100,
    hitsMax: 100,
    moved: 0,
    trail: [],
    get room() {
      return global.Game.rooms[this.pos.roomName];
    },
    move(dir) {
      if (!DIR_OFFSET[dir]) return ERR_INVALID_ARGS;
      if (this.fatigue > 0) return ERR_BUSY;
      this.pos = step(this.pos, dir);
      this.moved++;
      this.trail.push(`${this.pos.roomName}:${this.pos.x},${this.pos.y}`);
      return OK;
    },
    say() {},
    // Creep.prototype.travelTo ставит traveler.js; у фейкового объекта берём
    // реализацию оттуда, чтобы выполнялся настоящий код библиотеки.
    travelTo(destination, options) {
      const dp = destination.pos || destination;
      if (process.env.DEBUG) {
        console.log(
          `    [travelTo ${this.pos.roomName}:${this.pos.x},${this.pos.y} -> ` +
            `${dp.roomName}:${dp.x},${dp.y}]`,
        );
      }
      return Creep.prototype.travelTo.call(this, destination, options);
    },
    transfer(target, resource) {
      if (this.pos.getRangeTo(target.pos) > 1) return ERR_NOT_IN_RANGE;
      if (resource !== undefined && resource !== RESOURCE_ENERGY) {
        return ERR_INVALID_ARGS;
      }
      const amount = Math.min(this.store.energy, target.store.getFreeCapacity());
      this.store.energy -= amount;
      target.store.energy += amount;
      return OK;
    },
    withdraw(target) {
      if (this.pos.getRangeTo(target.pos) > 1) return ERR_NOT_IN_RANGE;
      const amount = Math.min(
        target.store.energy,
        this.store.getFreeCapacity(RESOURCE_ENERGY),
      );
      target.store.energy -= amount;
      this.store.energy += amount;
      return OK;
    },
    pickup: () => ERR_INVALID_ARGS,
    harvest(source) {
      if (this.pos.getRangeTo(source.pos) > 1) return ERR_NOT_IN_RANGE;
      const work = this.body.filter(p => p.type === WORK).length;
      const amount = Math.min(
        HARVEST_POWER * work,
        this.store.getFreeCapacity(RESOURCE_ENERGY),
        source.energy,
      );
      if (amount <= 0) return ERR_FULL;
      this.store.energy += amount;
      source.energy -= amount;
      return OK;
    },
    build: () => OK,
    repair: () => OK,
  };
  for (let i = 0; i < 10; i++) creep.body.push({ type: WORK });
  for (let i = 0; i < 2; i++) creep.body.push({ type: CARRY });
  for (let i = 0; i < 6; i++) creep.body.push({ type: MOVE });
  return creep;
}

// ── СЦЕНАРИЙ: дальний майнер идёт из E35S37 в E35S38 (как в живой игре) ──
global.Game.rooms = {
  E35S37: makeRoom("E35S37"),
  E35S38: makeRoom("E35S38"),
};

// Источник — ровно там, где он в живой комнате E35S38 (36,32).
// Контейнера в E35S38 нет (живой снимок), поэтому майнер должен дойти до
// настроенной рабочей клетки (37,32) и поставить площадку контейнера ИМЕННО
// там, а не под собой (до правки он встал на (37,33) и поставил площадку там).
const source = makeSource("src1", 36, 32, "E35S38");
const creep = makeCreep("remoteMiner_E35S37_83055217", 24, 49, "E35S37");

const TICKS = Number(process.env.TICKS || 160);
const trail = [];
let reachedSource = false;
for (let i = 0; i < TICKS; i++) {
  global.Game.time = 1000 + i;
  const before = `${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}`;
  const outcome = roleRemoteMiner.run(creep);
  if (creep.pos.getRangeTo(source.pos) <= 1) reachedSource = true;
  const t = creep.memory._travel || {};
  trail.push(
    `${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}` +
      ` [dest ${t.dest ? `${t.dest.x},${t.dest.y},${t.dest.roomName}` : "-"}` +
      ` path ${(t.path || "").length} stuck ${t.stuck || 0}` +
      (process.env.DEBUG
        ? ` srcId=${creep.memory.sourceId || "-"} contId=${creep.memory.containerId || "-"}` +
          ` checked=${creep.memory.containerCheckedAt || "-"} before=${before}` +
          ` ret=${outcome === undefined ? "void" : outcome}`
        : "") +
      `]`,
  );
}

console.log("Трасса дальнего майнера:");
trail.forEach((l, i) => console.log(`  t${i} ${l}`));
const visited = new Set(trail.map(l => l.split(" ")[0]));
console.log(`Уникальных клеток: ${visited.size}`);
console.log(
  `Итог: ${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}, ` +
    `дошёл до источника (range<=1): ${reachedSource}, ` +
    `store=${creep.store.energy}, источник=${source.energy}`,
);

// ── ПРОВЕРКА: площадка контейнера — ровно в настроенной клетке ──────────
// До правки роль ставила площадку под крипом, и клетка зависела от маршрута
// (в живой игре вышло (37,33)); теперь клетка берётся из
// constants.REMOTE.ROOM_TO_CONTAINER_POS, и майнер стоит на ней.
{
  const { REMOTE } = require("../constants");
  const cell = (REMOTE.ROOM_TO_CONTAINER_POS || {}).E35S38 || {};
  const sites = WORLD.sites.filter(s => s.structureType === STRUCTURE_CONTAINER);
  const site = sites[0];
  const siteOnCell =
    !!site &&
    site.pos.roomName === "E35S38" &&
    site.pos.x === cell.x &&
    site.pos.y === cell.y;
  const creepOnCell =
    creep.pos.roomName === "E35S38" &&
    creep.pos.x === cell.x &&
    creep.pos.y === cell.y;

  console.log(
    `\nПроверка рабочего места (настроенная клетка ${cell.x},${cell.y} E35S38):`,
  );
  console.log(
    `  площадок контейнера: ${sites.length}` +
      (site ? ` -> ${site.pos.roomName}:${site.pos.x},${site.pos.y}` : ""),
  );
  console.log(`  площадка стоит в настроенной клетке: ${siteOnCell}`);
  console.log(`  майнер стоит в настроенной клетке: ${creepOnCell}`);

  if (!siteOnCell || !creepOnCell) process.exitCode = 1;
}

// ── СЦЕНАРИЙ 2: хайлер с грузом едет домой и отдаёт энергию в линк ──────
{
  const roleRemoteHauler = require("../remote.hauler");
  const { REMOTE } = require("../constants");
  const linkId = REMOTE.ROOM_TO_LINK.E35S38;
  const link = {
    id: linkId,
    pos: new RoomPosition(24, 46, "E35S37"),
    room: { name: "E35S37" },
    structureType: "link",
    store: new Store(800),
    energy: 0,
  };
  WORLD.objects[linkId] = link;
  STRUCTS.E35S37 = (STRUCTS.E35S37 || []).concat(link);

  const hauler = makeCreep("remoteHauler_E35S37_2", 24, 1, "E35S38", 1000);
  hauler.memory = { role: "remoteHauler", targetRoom: "E35S38", working: true };
  hauler.store.energy = 1000;

  const hTrail = [];
  let delivered = 0;
  for (let i = 0; i < TICKS; i++) {
    global.Game.time = 9000 + i;
    roleRemoteHauler.run(hauler);
    if (link.store.energy > delivered) delivered = link.store.energy;
    const t = hauler.memory._travel || {};
    hTrail.push(
      `${hauler.pos.roomName}:${hauler.pos.x},${hauler.pos.y}` +
        ` [dest ${t.dest ? `${t.dest.x},${t.dest.y},${t.dest.roomName}` : "-"}` +
        ` path ${(t.path || "").length} store=${hauler.store.energy}]`,
    );
  }
  console.log("\nТрасса хайлера с грузом (доставка в линк):");
  hTrail.slice(0, 8).forEach((l, i) => console.log(`  t${i} ${l}`));
  console.log(`  ...`);
  console.log(`  t${hTrail.length - 1} ${hTrail[hTrail.length - 1]}`);
  console.log(
    `Итог: в линке ${link.store.energy} энергии (макс ${delivered}), ` +
      `в рюкзаке ${hauler.store.energy}, место: ` +
      `${hauler.pos.roomName}:${hauler.pos.x},${hauler.pos.y}`,
  );
}

// ── СЦЕНАРИЙ 3: хайлер без контейнера ждёт у источника ──────────────────
{
  const roleRemoteHauler = require("../remote.hauler");
  const hauler = makeCreep("remoteHauler_E35S37_1", 23, 0, "E35S38", 1000);
  hauler.memory = { role: "remoteHauler", targetRoom: "E35S38", working: false };
  hauler.body = [];
  for (let i = 0; i < 20; i++) hauler.body.push({ type: CARRY });
  for (let i = 0; i < 20; i++) hauler.body.push({ type: MOVE });

  const hTrail = [];
  let nearSource = false;
  for (let i = 0; i < TICKS; i++) {
    global.Game.time = 5000 + i;
    roleRemoteHauler.run(hauler);
    if (hauler.pos.getRangeTo(source.pos) <= 2) nearSource = true;
    const t = hauler.memory._travel || {};
    hTrail.push(
      `${hauler.pos.roomName}:${hauler.pos.x},${hauler.pos.y}` +
        ` [dest ${t.dest ? `${t.dest.x},${t.dest.y},${t.dest.roomName}` : "-"}` +
        ` path ${(t.path || "").length}]`,
    );
  }
  console.log("\nТрасса дальнего хайлера:");
  hTrail.forEach((l, i) => console.log(`  t${i} ${l}`));
  const hVisited = new Set(hTrail.map(l => l.split(" ")[0]));
  console.log(`Уникальных клеток: ${hVisited.size}`);
  console.log(
    `Итог хайлера: ${hauler.pos.roomName}:${hauler.pos.x},${hauler.pos.y}, ` +
      `дошёл к источнику (range<=2): ${nearSource}`,
  );
}
