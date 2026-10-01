"use strict";
/**
 * ===================================================
 * ROOM.CREEPS.UNIQUE.TEST.JS — один крип ровно в одном roomState
 * ===================================================
 * Проверяем исправление бага (задание 2 плана docs/CPU-OPTIMIZATION-PLAN.md):
 *   1) крип, чья homeRoom и физическая комната различаются, попадает
 *      ровно в один roomState — своей homeRoom (иначе логика роли
 *      исполнялась дважды за тик, а countRole считал его дважды);
 *   2) крип без своей homeRoom, но физически в своей комнате, по-прежнему
 *      обрабатывается (не теряется);
 *   3) creepsInRoom содержит физически находящихся в комнате — башня
 *      лечит только их;
 *   4) сумма крипов по всем roomState равна числу учтённых крипов,
 *      дублей нет.
 *
 * Запуск: node tests/room.creeps.unique.test.js
 */

/* ── Шим разрешения модулей ───────────────────────────────────────────── */
// На шарде require("scanner") — валидное имя модуля (движок ищет от корня).
// В Node так нельзя, поэтому временно учим загрузчик тому же правилу:
// голое имя, для которого рядом есть файл <имя>.js, разрешается в него.
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

/* ── Минимальные игровые глобалы ──────────────────────────────────────── */
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
global.FIND_MY_STRUCTURES = 1;
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;
global.FIND_HOSTILE_CREEPS = 5;
global.FIND_MY_CREEPS = 6;

global.Memory = { rooms: {} };

/** Полный structureCache, чтобы scanner не ходил в room.find. */
function makeCache() {
  return {
    // Схема 3 (29.09.2026): добавлены числа повреждённых структур.
    v: 3,
    updatedAt: 1000,
    controllerLevel: 4,
    spawnIds: [],
    towerIds: [],
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
}

function makeRoomState(room) {
  Memory.rooms[room.name] = Memory.rooms[room.name] || {};
  Memory.rooms[room.name].structureCache = makeCache();
  Memory.rooms[room.name].mineral = { none: true };
  room.controller = { my: true, id: "ctrl_" + room.name, level: 4 };
  room.memory = Memory.rooms[room.name];
  // Пустая комната: структур нет. Нужен на случай перестройки кэша.
  room.find = () => [];
  return room;
}

function makeCreep(name, role, homeRoom, currentRoom, hits) {
  return {
    name,
    hits: hits === undefined ? 100 : hits,
    hitsMax: 100,
    memory: { role, homeRoom },
    room: { name: currentRoom },
    pos: { getRangeTo: () => 1 },
  };
}

/* ── Сценарий ─────────────────────────────────────────────────────────── */
const W1 = makeRoomState({ name: "W1N1" });
const W2 = makeRoomState({ name: "W2N1" });

const creeps = {
  // дома W1N1, физически в W2N1 — раньше попадал в оба roomState
  remote: makeCreep("remote", "worker", "W1N1", "W2N1"),
  // дома W2N1, физически там же
  local: makeCreep("local", "miner", "W2N1", "W2N1"),
  // дома W1N1, физически в W1N1
  home: makeCreep("home", "worker", "W1N1", "W1N1"),
};

global.Game = {
  time: 1000,
  rooms: { W1N1: W1, W2N1: W2 },
  creeps,
  constructionSites: {},
  getObjectById: () => null,
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  market: null,
  spawns: {},
  shard: { name: "shard3" },
};

const roomManager = require("../room.manager");

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

console.log("1. Один крип — ровно один roomState");
const states = roomManager.buildAllRoomStates();
const byName = {};
for (const st of states) {
  for (const c of st.creeps) {
    byName[c.name] = (byName[c.name] || 0) + 1;
  }
}
const dupes = Object.keys(byName).filter(n => byName[n] > 1);
check("дублей нет", dupes.length === 0, dupes.join(","));
check(
  "все три крипа учтены",
  Object.keys(byName).length === 3,
  Object.keys(byName).join(","),
);

const w1 = states.find(s => s.roomName === "W1N1");
const w2 = states.find(s => s.roomName === "W2N1");

console.log("\n2. Приоритет homeRoom");
check(
  "remote (home W1N1, физически W2N1) — в W1N1",
  w1.creeps.some(c => c.name === "remote"),
);
check(
  "...и НЕ в W2N1",
  !w2.creeps.some(c => c.name === "remote"),
);
check("local — в W2N1", w2.creeps.some(c => c.name === "local"));
check("home — в W1N1", w1.creeps.some(c => c.name === "home"));
check("в W1N1 ровно 2 крипа", w1.creeps.length === 2, String(w1.creeps.length));
check("в W2N1 ровно 1 крип", w2.creeps.length === 1, String(w2.creeps.length));

console.log("\n3. creepsInRoom — физическое присутствие");
check(
  "remote физически в W2N1",
  w2.creepsInRoom.some(c => c.name === "remote"),
);
check(
  "remote не числится физически в W1N1",
  !w1.creepsInRoom.some(c => c.name === "remote"),
);
check("в W1N1 физически 1 крип", w1.creepsInRoom.length === 1, String(w1.creepsInRoom.length));
check("в W2N1 физически 2 крипа", w2.creepsInRoom.length === 2, String(w2.creepsInRoom.length));

console.log("\n4. Башня лечит только крипа из своей комнаты");
// Повреждённый remote физически в W2N1: башня W2N1 должна его видеть,
// башня W1N1 — нет (он в другой комнате).
creeps.remote.hits = 10;
const states2 = roomManager.buildAllRoomStates();
const w1b = states2.find(s => s.roomName === "W1N1");
const w2b = states2.find(s => s.roomName === "W2N1");
check(
  "в creepsInRoom W2N1 раненый remote виден",
  w2b.creepsInRoom.some(c => c.name === "remote" && c.hits < c.hitsMax),
);
check(
  "в creepsInRoom W1N1 раненого remote нет",
  !w1b.creepsInRoom.some(c => c.name === "remote"),
);

console.log("\n5. Крип без своей комнаты, но физически в своей — не теряется");
creeps.stray = makeCreep("stray", "worker", "W9N9", "W1N1");
const states3 = roomManager.buildAllRoomStates();
const w1c = states3.find(s => s.roomName === "W1N1");
check(
  "stray обрабатывается в W1N1",
  w1c.creeps.some(c => c.name === "stray"),
);
const allCount = states3.reduce((n, s) => n + s.creeps.length, 0);
check("сумма по roomState = 4", allCount === 4, String(allCount));

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
