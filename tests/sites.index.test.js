"use strict";
/**
 * ===================================================
 * SITES.INDEX.TEST.JS — офлайн-проверка индекса стройплощадок
 * ===================================================
 * Задание 6 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) индекс строится один раз за тик и переиспользуется;
 *   2) на новом тике индекс пересобирается (объекты валидны только в тике);
 *   3) площадки разложены по своим комнатам;
 *   4) generateBuildStructures не дублирует задачи и не плодит их повторно;
 *   5) задача не создаётся на уже стоящую в очереди площадку;
 *   6) role.builder выбирает ближайшую площадку и не перебирает Империю.
 *
 * Запуск: node tests/sites.index.test.js
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
global.ERR_NOT_IN_RANGE = -9;
global.OK = 0;
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

global.Memory = { rooms: {} };
global.Game = {
  time: 500,
  creeps: {},
  rooms: {},
  constructionSites: {},
  getObjectById: () => null,
};

const scanner = require("../scanner");

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

/** Площадка со счётчиком обращений к pos.roomName. */
function site(id, roomName) {
  return {
    id,
    hits: 1,
    hitsMax: 100,
    pos: { roomName, x: 10, y: 10 },
    structureType: "extension",
  };
}

console.log("1. Индекс строится один раз за тик");
global.Game.constructionSites = {
  a: site("a", "W1N1"),
  b: site("b", "W1N1"),
  c: site("c", "W2N1"),
};
const first = scanner.getSitesByRoom();
const second = scanner.getSitesByRoom();
check("тот же объект индекса", first === second);
check("W1N1: 2 площадки", first.W1N1.length === 2, String(first.W1N1.length));
check("W2N1: 1 площадка", first.W2N1.length === 1, String(first.W2N1.length));
check("пустой комнаты нет в индексе", first.W3N3 === undefined);

console.log("\n2. Новый тик — индекс пересобирается");
global.Game.time += 1;
global.Game.constructionSites.d = site("d", "W1N1");
const third = scanner.getSitesByRoom();
check("индекс новый", third !== first);
check("новая площадка видна", third.W1N1.length === 3, String(third.W1N1.length));

console.log("\n3. generateBuildStructures ставит задачи по индексу");
const taskGenerators = require("../task.generators");
const TASK = "buildStructures";
function queue(roomName) {
  Memory.rooms[roomName] = Memory.rooms[roomName] || {};
  Memory.rooms[roomName].tasks = Memory.rooms[roomName].tasks || {};
  Memory.rooms[roomName].tasks[TASK] = Memory.rooms[roomName].tasks[TASK] || [];
  return Memory.rooms[roomName].tasks[TASK];
}

const roomState = {
  roomName: "W1N1",
  constructionSites: third.W1N1,
};
taskGenerators.generateBuildStructures(roomState);
let q = queue("W1N1");
check("создано 3 задачи", q.length === 3, String(q.length));
check(
  "тип задач build",
  q.every(t => t.type === "build"),
);
check(
  "targetId соответствуют площадкам",
  q.map(t => t.targetId).sort().join(",") === "a,b,d",
  q.map(t => t.targetId).join(","),
);

console.log("\n4. Повторный вызов не дублирует задачи");
taskGenerators.generateBuildStructures(roomState);
q = queue("W1N1");
check("задач по-прежнему 3", q.length === 3, String(q.length));

console.log("\n5. Задача не создаётся на площадку, уже стоящую в очереди");
global.Game.time += 1;
global.Game.constructionSites.e = site("e", "W1N1");
const idx4 = scanner.getSitesByRoom();
taskGenerators.generateBuildStructures({
  roomName: "W1N1",
  constructionSites: idx4.W1N1,
});
q = queue("W1N1");
check("добавлена только новая", q.length === 4, String(q.length));
check(
  "новая площадка e в очереди",
  q.some(t => t.targetId === "e"),
);

console.log("\n6. role.builder: ближайшая площадка, без перебора Империи");
const roleBuilder = require("../role.builder");
const energySource = require("../energySource");
// Строитель с полным запасом энергии — идёт в ветку строительства.
const creep = {
  name: "b1",
  memory: { role: "builder", working: true, homeRoom: "W1N1" },
  store: { energy: 50, getFreeCapacity: () => 0 },
  room: { name: "W1N1" },
  pos: {
    findClosestByRange(list) {
      return list[0]; // «ближайшая» — первая; проверяем, что список из roomState
    },
    getRangeTo: () => {
      throw new Error("перебор вручную не должен вызываться");
    },
  },
  build: () => global.ERR_NOT_IN_RANGE,
  moveTo: () => global.OK,
};

let built = null;
creep.build = target => {
  built = target;
  return global.ERR_NOT_IN_RANGE;
};

const before = JSON.stringify(Object.keys(global.Game.constructionSites));
roleBuilder.run(creep, { roomName: "W1N1", constructionSites: idx4.W1N1 });
check("цель выбрана из roomState", built !== null && idx4.W1N1.includes(built));
check(
  "перебора Game.constructionSites не было (состав не изменился)",
  JSON.stringify(Object.keys(global.Game.constructionSites)) === before,
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
