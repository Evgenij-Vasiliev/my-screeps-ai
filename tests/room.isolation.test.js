"use strict";
/**
 * ===================================================
 * ROOM.ISOLATION.TEST.JS — офлайн-проверка изоляции сбоев
 * ===================================================
 * Инцидент 18.09.2026: ошибка внутри одной подсистемы комнаты (рынок/фабрика/
 * PowerSpawn/лаборатории/линки) прерывала runRoom, а с ней — и обработку
 * остальных комнат в тике (empire.js ловил исключение только вокруг всего
 * roomManager.run). Комната могла остаться без спавна и генерации задач из-за
 * падения совешенно другой подсистемы.
 *
 * Проверяем:
 *   1) падение labManager не мешает spawnManager выполниться;
 *   2) падение в одной комнате не мешает обработать следующую;
 *   3) падение runRoom не роняет run() целиком.
 *
 * Запуск: node tests/room.isolation.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Минимальные глобалы ──────────────────────────────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_TARGET = -7;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_H = "H";
global.RESOURCE_O = "O";
global.RESOURCE_BATTERY = "battery";
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_STORAGE = "storage";
global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};
global.Memory = { rooms: { R: { tasks: {} } }, creeps: {} };

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

// Профилирование нейтрализуем — тестируем изоляцию, а не метрики.
const cpuMonitor = require("../cpuMonitor");
cpuMonitor.trackRole = (label, fn) => fn();

const spawnManager = require("../spawn.manager");
const labManager = require("../lab.manager");
const taskGenerators = require("../task.generators");
const roomManager = require("../room.manager");

// ── Фасад комнаты для runRoom ────────────────────────────────────────────
function makeRoomState(name) {
  const room = {
    name,
    storage: null,
    terminal: null,
    controller: null,
    find: () => [],
    energyAvailable: 0,
    energyCapacityAvailable: 0,
  };
  return {
    roomName: name,
    room,
    spawns: [],
    extensions: [],
    creeps: [],
    sources: [],
    towers: [],
    links: [],
  };
}

// ── 1. Падение labManager не мешает spawnManager и генерации задач ───────
{
  console.log("\n1. Сбой подсистемы не отменяет остальные");

  let spawnRuns = 0;
  let taskRuns = 0;
  const origSpawn = spawnManager.run;
  const origLab = labManager.run;
  const origTasks = taskGenerators.runAll;
  spawnManager.run = () => {
    spawnRuns++;
  };
  labManager.run = () => {
    throw new Error("lab subsystem down");
  };
  taskGenerators.runAll = () => {
    taskRuns++;
  };

  const origLog = console.log;
  console.log = () => {};
  roomManager.runRoom(makeRoomState("R"));
  console.log = origLog;

  spawnManager.run = origSpawn;
  labManager.run = origLab;
  taskGenerators.runAll = origTasks;

  check("spawnManager выполнился", spawnRuns === 1, String(spawnRuns));
  check(
    "генераторы задач выполнились, несмотря на падение лабораторий",
    taskRuns === 1,
    String(taskRuns),
  );
}

// ── 2. Падение в одной комнате не мешает следующей ───────────────────────
{
  console.log("\n2. Сбой комнаты не отменяет остальные комнаты");

  const processed = [];
  roomManager.buildAllRoomStates = () => [
    makeRoomState("R1"),
    makeRoomState("R2"),
    makeRoomState("R3"),
  ];
  roomManager.runRoom = state => {
    processed.push(state.roomName);
    if (state.roomName === "R2") throw new Error("room R2 down");
  };

  const origLog = console.log;
  console.log = () => {};
  roomManager.run();
  console.log = origLog;

  check(
    "обработаны все три комнаты",
    processed.join(",") === "R1,R2,R3",
    processed.join(","),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
