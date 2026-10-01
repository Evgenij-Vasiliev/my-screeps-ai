"use strict";
/**
 * ===================================================
 * TOWER.ATTACK.TEST.JS — офлайн-проверка детектора атаки и ленивых стен
 * ===================================================
 * Задание 7 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) стены и валы резолвятся ЛЕНИВО: в обычный тик Game.getObjectById
 *      по ним не вызывается вообще (объекты не нужны — башни не ремонтируют);
 *   2) в тик ремонта они резолвятся, и ровно один раз (мемоизация на тик);
 *   3) враждебные крипы ищутся дешёвым room.find каждый тик;
 *   4) дорогой обход hits выполняется только раз в HOSTILE_CHECK_INTERVAL;
 *   5) атака обнаруживается сразу по крипам, без ожидания обхода стен;
 *   6) Memory.towerState больше не создаётся.
 *
 * Запуск: node tests/tower.attack.test.js
 */

/* ── Шим разрешения модулей (как на шарде: require("scanner")) ─────────── */
const Module = require("module");
const fs = require("fs");
const path = require("path");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

/* ── Игровые глобалы ──────────────────────────────────────────────────── */
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_UTRIUM = "U";
global.RESOURCE_HYDROGEN = "H";
global.RESOURCE_OXYGEN = "O";
global.RESOURCE_LEMERGIUM = "L";
global.RESOURCE_KEANIUM = "K";
global.RESOURCE_ZYNTHIUM = "Z";
global.RESOURCE_CATALYST = "X";
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;
global.FIND_HOSTILE_CREEPS = 5;
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "wall";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";

const { TOWER } = require("../constants");
const scanner = require("../scanner");

global.Memory = { rooms: {} };
global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  spawns: {},
  constructionSites: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};

const WALL_COUNT = 120;
const RAMPART_COUNT = 80;

/* ── Тик ремонта башен — СВОЙ у каждой комнаты (room.manager.isTowerRepairTick) ──
 * Условие `(Game.time + фаза) % TOWER.REPAIR_INTERVAL === 0`, фаза — хэш имени
 * комнаты. Тест считает тики от фазы, иначе он проверял бы прежнее, общее для
 * всей империи условие `Game.time % 15 === 0`. */
const PHASE = scanner.rebuildStagger("W1N1") % TOWER.REPAIR_INTERVAL;
function isRepairTick(t) {
  return (t + PHASE) % TOWER.REPAIR_INTERVAL === 0;
}
/** Ближайший тик ремонта, начиная с from. */
function repairTick(from) {
  let t = from;
  while (!isRepairTick(t)) t++;
  return t;
}
/** Тик, который НЕ тик ремонта и НЕ тик проверки атаки (не кратен 100). */
function plainTick(from) {
  let t = from;
  while (isRepairTick(t) || t % TOWER.HOSTILE_CHECK_INTERVAL === 0) t++;
  return t;
}
/** Тик проверки атаки (кратный 100), который при этом НЕ тик ремонта. */
function hostileCheckTick(from) {
  let t = from;
  while (t % TOWER.HOSTILE_CHECK_INTERVAL !== 0 || isRepairTick(t)) t++;
  return t;
}
const CHECK_TICK = hostileCheckTick(TOWER.HOSTILE_CHECK_INTERVAL * 3);

let idLookups = 0;
let wallLookups = 0;
let rampartLookups = 0;
let hostileFinds = 0;
let hitsReads = 0;
let hostiles = [];

const wallObjects = {};
for (let i = 0; i < WALL_COUNT + RAMPART_COUNT; i++) {
  const isWall = i < WALL_COUNT;
  // id должны совпадать с теми, что попадают в кэш: w0..w119 и r0..r79.
  const id = isWall ? "w" + i : "r" + (i - WALL_COUNT);
  const obj = {
    id,
    _hits: 1000,
    hitsMax: 1000000,
    structureType: isWall ? "wall" : "rampart",
  };
  // _hits, а не hits: значение должно быть изменяемым для проверок 8-го блока,
  // а getter считает чтения (по ним проверяется, что стены не обходят вовсе).
  Object.defineProperty(obj, "hits", {
    get() {
      hitsReads++;
      return obj._hits;
    },
  });
  wallObjects[id] = obj;
}

/** Дороги для проверок выбора цели (в кэш идут только их id и числа). */
const roadObjects = {};

let towerRepairs = 0;
let tower2Repairs = 0;

const tower = {
  id: "t1",
  store: { energy: 1000 },
  pos: { findClosestByRange: list => list[0], getRangeTo: () => 3 },
  attack: () => global.OK,
  repair: () => {
    towerRepairs++;
    return global.OK;
  },
  heal: () => global.OK,
};

const tower2 = {
  id: "t2",
  store: { energy: 1000 },
  pos: { findClosestByRange: list => list[0], getRangeTo: () => 9 },
  attack: () => global.OK,
  repair: () => {
    tower2Repairs++;
    return global.OK;
  },
  heal: () => global.OK,
};

function makeRoom(name) {
  const cache = {
    // Схема 3 (29.09.2026): добавлены числа повреждённых структур.
    v: 3,
    updatedAt: global.Game.time,
    controllerLevel: 4,
    spawnIds: [],
    towerIds: ["t1"],
    linkIds: [],
    labIds: [],
    extensionIds: [],
    roadIds: [],
    damagedRoadIds: [],
    damagedRoadHits: new Int32Array(2500),
    damagedRoadHitsMax: new Int32Array(2500),
    damagedRoadCount: 0,
    damagedIds: [],
    damagedStats: new Int32Array(1400),
    damagedCount: 0,
    wallIds: [],
    rampartIds: [],
    factoryId: null,
    powerSpawnId: null,
    observerId: null,
    extractorId: null,
    nukerId: null,
    storageId: null,
    terminalId: null,
    sourceIds: [],
    mineralId: null,
  };
  for (let i = 0; i < WALL_COUNT; i++) cache.wallIds.push("w" + i);
  for (let i = 0; i < RAMPART_COUNT; i++) cache.rampartIds.push("r" + i);

  global.__structureCache = global.__structureCache || {};
  global.__structureCache[name] = cache;

  Memory.rooms[name] = Memory.rooms[name] || {};
  Memory.rooms[name].tasks = {};
  Memory.rooms[name].links = null;

  const room = {
    name,
    controller: { my: true, id: "c_" + name, level: 4, ticksToDowngrade: 100000 },
    memory: Memory.rooms[name],
    storage: null,
    terminal: null,
    find(kind) {
      if (kind === global.FIND_HOSTILE_CREEPS) {
        hostileFinds++;
        return hostiles;
      }
      return [];
    },
  };
  room.find = room.find.bind(room);
  return room;
}

global.Game.getObjectById = id => {
  if (id === "t1") return tower;
  if (id === "t2") return tower2;
  if (roadObjects[id]) return roadObjects[id];
  const o = wallObjects[id];
  if (o) {
    idLookups++;
    if (o.structureType === "wall") wallLookups++;
    else rampartLookups++;
    return o;
  }
  return null;
};

const roomManager = require("../room.manager");
const room = makeRoom("W1N1");
global.Game.rooms.W1N1 = room;

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

function buildState() {
  global.__structureCache.W1N1.updatedAt = global.Game.time;
  return roomManager.buildRoomState(room, [], []);
}

console.log("1. Обычный тик: стены не резолвятся, hits не читаются");
idLookups = 0;
wallLookups = 0;
rampartLookups = 0;
hitsReads = 0;
hostileFinds = 0;
global.Game.time = plainTick(1001); // не тик ремонта и не тик проверки атаки
roomManager.runTowerLogic(buildState());
check("Game.getObjectById по стенам не вызывался", idLookups === 0, String(idLookups));
check("hits стен не читались", hitsReads === 0, String(hitsReads));
check(
  "враждебные ищутся дешёвым room.find",
  hostileFinds === 1,
  String(hostileFinds),
);

console.log("\n2. Тик ремонта: СТЕНЫ не резолвятся вовсе, валы — один раз");
idLookups = 0;
wallLookups = 0;
rampartLookups = 0;
hitsReads = 0;
global.Game.time = repairTick(1005); // тик ремонта ЭТОЙ комнаты (фаза по имени)
// REPAIR_INTERVAL = 15, HOSTILE_CHECK_INTERVAL = 100 — выбран не кратный 100
const repairState = buildState();
roomManager.runTowerLogic(repairState);
check(
  "стены не резолвятся (ремонт стен убран: они не распадаются)",
  wallLookups === 0,
  String(wallLookups),
);
check(
  "валы резолвятся ровно один раз",
  rampartLookups === RAMPART_COUNT,
  String(rampartLookups),
);
check(
  "мемоизация на тик: повторный проход не резолвит снова",
  (() => {
    const before = idLookups;
    roomManager.runTowerLogic(repairState);
    return idLookups === before;
  })(),
  String(idLookups),
);

console.log("\n3. Тик проверки атаки: hits читаются, но не каждый тик");
global.Game.time = CHECK_TICK; // тик проверки атаки (и не тик ремонта)
hitsReads = 0;
idLookups = 0;
roomManager.runTowerLogic(buildState());
check("обход hits выполнен на тике проверки", hitsReads > 0, String(hitsReads));

global.Game.time = plainTick(CHECK_TICK + 1); // не тик проверки
hitsReads = 0;
roomManager.runTowerLogic(buildState());
check("на обычном тике обхода hits нет", hitsReads === 0, String(hitsReads));

console.log("\n4. Атака обнаруживается сразу по крипам");
hostiles = [{ id: "h1", hits: 100, hitsMax: 100 }];
global.Game.time = plainTick(1002); // не тик проверки атаки — обход стен не поможет
let attacked = 0;
tower.attack = () => {
  attacked++;
  return global.OK;
};
roomManager.runTowerLogic(buildState());
check("башня атаковала в тот же тик", attacked === 1, String(attacked));
check(
  "флаг атаки записан в Memory",
  Memory.rooms.W1N1.underAttack === true,
  String(Memory.rooms.W1N1.underAttack),
);
hostiles = [];

console.log("\n5. Memory.towerState не создаётся");
// Флаг атаки снят, но ключ towerState не должен появиться ни при каком раскладе.
global.Game.time = plainTick(1003);
roomManager.runTowerLogic(buildState());
check("Memory.towerState отсутствует", Memory.towerState === undefined);

console.log("\n6. Мирное время: флаг атаки снят");
check(
  "underAttack = false",
  Memory.rooms.W1N1.underAttack === false,
  String(Memory.rooms.W1N1.underAttack),
);

console.log("\n7. Фаза ремонта башен: у каждой комнаты свой тик");
// Правка 29.09.2026: условие ремонта стало ПОКОМНАТНЫМ
// ((Game.time + фаза имени комнаты) % TOWER.REPAIR_INTERVAL === 0).
// Раньше все 16 башен империи били в один тик — 4.5031 CPU в этом тике.
const REAL_ROOMS = ["E35S37", "E35S39", "E37S37", "E37S38", "E36S38"];

// (а) В любом окне TOWER.REPAIR_INTERVAL тиков у комнаты ровно один тик ремонта.
let exactlyOne = true;
for (const name of REAL_ROOMS) {
  for (let from = 1000; from < 1000 + TOWER.REPAIR_INTERVAL; from++) {
    let n = 0;
    for (let k = 0; k < TOWER.REPAIR_INTERVAL; k++) {
      global.Game.time = from + k;
      if (roomManager.isTowerRepairTick(name)) n++;
    }
    if (n !== 1) exactlyOne = false;
  }
}
check("в любом окне 15 тиков у комнаты ровно один тик ремонта", exactlyOne);

// (б) Комнаты ремонтируют в РАЗНЫЕ тики: в одном тике — не все пять.
global.Game.time = 1015;
const repairing = REAL_ROOMS.filter(n => roomManager.isTowerRepairTick(n));
check(
  "в одном тике ремонтируют не все комнаты империи",
  repairing.length < REAL_ROOMS.length,
  `ремонтируют ${repairing.length} из ${REAL_ROOMS.length}`,
);

// (в) Поведение башни не изменилось: за 15 тиков ровно один ремонт,
//     и бьёт только ОДНА башня — ближайшая к цели.
const cache7 = global.__structureCache.W1N1;
cache7.towerIds = ["t1", "t2"];
towerRepairs = 0;
tower2Repairs = 0;
for (let k = 0; k < TOWER.REPAIR_INTERVAL; k++) {
  global.Game.time = 1010 + k;
  roomManager.runTowerLogic(buildState());
}
check(
  "за 15 тиков башня ремонтировала ровно один раз",
  towerRepairs === 1,
  String(towerRepairs),
);
check(
  "бьёт только ближайшая башня (у дальней — ноль интентов)",
  tower2Repairs === 0,
  String(tower2Repairs),
);

console.log("\n8. Цель ремонта: доля потерянных хитов, а не абсолют");
// Вал почти цел (0.1 % потерь), дорога повреждена на 40 % — цель дорога.
// Абсолютный дефицит у вала при этом в 500 раз больше (1000 против 2000 хитов
// у дороги): именно поэтому правило считает ДОЛЮ, а не абсолют.
const cache8 = global.__structureCache.W1N1;
// Все валы комнаты — почти целые (0.1 % потерь): иначе именно они выиграли бы
// у дороги по доле, ведь в стенде у них hits 1000 из 1000000.
for (const id in wallObjects) {
  if (wallObjects[id].structureType === "rampart") wallObjects[id]._hits = 999000;
}
roadObjects["road1"] = { id: "road1", hits: 3000, hitsMax: 5000 }; // 40 % потерь
cache8.damagedRoadIds = ["road1"];
cache8.damagedRoadHits[0] = 3000;
cache8.damagedRoadHitsMax[0] = 5000;

towerRepairs = 0;
tower2Repairs = 0;
let repairedTargetId = null;
tower.repair = target => {
  towerRepairs++;
  repairedTargetId = target && target.id;
  return global.OK;
};
global.Game.time = repairTick(1100);
roomManager.runTowerLogic(buildState());
check("цель — повреждённая дорога, а не почти целый вал", repairedTargetId === "road1", String(repairedTargetId));

// Цель с дефицитом меньше одного действия (4500/5000 = 500 < 800) не чинится:
// движок обрезал бы хиты по hitsMax, и 10 энергии ушли бы в 1 хит.
roadObjects["road1"].hits = 4500;
cache8.damagedRoadHits[0] = 4500;
for (const id in wallObjects) {
  if (wallObjects[id].structureType === "rampart") wallObjects[id]._hits = 999999;
}
towerRepairs = 0;
global.Game.time = repairTick(1120);
roomManager.runTowerLogic(buildState());
check(
  "почти целые цели не ремонтируются (дефицит меньше действия)",
  towerRepairs === 0,
  String(towerRepairs),
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
