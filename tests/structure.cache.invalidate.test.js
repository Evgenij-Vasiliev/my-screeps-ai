"use strict";
/**
 * ===================================================
 * STRUCTURE.CACHE.INVALIDATE.TEST.JS — инвалидация heap-кэша структур
 * ===================================================
 * Проблема (subagent_cpu, п. 2): scanner держит кэш id структур комнаты до
 * STRUCTURE_CACHE_TTL = 1000 тиков, а clearStructureCache не вызывался нигде.
 * Построенное расширение/линк/лаба/башня поэтому не попадало в roomState — и,
 * значит, в задачи fillSpawnsExtensions/fillTowers и в ремонт башен — до 1000
 * тиков (спасал только Global Reset).
 *
 * Правка: момент появления нового здания — исчезновение стройплощадки, которую
 * строил крип; на этот переход (executeBuildStructures: цель не найдена либо
 * ERR_INVALID_TARGET) вешается scanner.clearStructureCache(roomName). Новый
 * состав структур попадает в roomState уже на следующем тике.
 *
 * Проверяем:
 *   1) стройка идёт штатно — кэш не трогается;
 *   2) стройплощадка исчезла (!target) — кэш комнаты сброшен, задача завершена;
 *   3) ERR_INVALID_TARGET — то же;
 *   4) после сброса scanner ПЕРЕсобирает кэш и видит новое здание;
 *   5) сброс затрагивает только свою комнату.
 *
 * Запуск: node tests/structure.cache.invalidate.test.js
 */

// ── Глобалы движка ───────────────────────────────────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_POWER = "power";
global.FIND_MY_STRUCTURES = 1;
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "constructedWall";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_STORAGE = "storage";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_NUKER = "nuker";
global.STRUCTURE_TERMINAL = "terminal";

// ── Разрешение bare-require в стиле Screeps ─────────────────────────────
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

// ── Комнаты с изменяемым составом структур ──────────────────────────────
const rooms = {};

function addStructure(roomName, id, structureType) {
  rooms[roomName].structures.push({ id, structureType });
}

function makeRoom(name) {
  rooms[name] = { name, memory: {}, structures: [], sites: [], finds: 0 };
  return {
    name,
    memory: rooms[name].memory,
    storage: null,
    terminal: null,
    find(type, opts) {
      rooms[name].finds++;
      if (type === FIND_MY_STRUCTURES) return rooms[name].structures;
      if (type === FIND_STRUCTURES) {
        const all = rooms[name].structures;
        return opts && opts.filter ? all.filter(opts.filter) : all;
      }
      if (type === FIND_SOURCES) return [];
      if (type === FIND_MINERALS) return [];
      return [];
    },
  };
}

const sites = {};
global.Game = {
  time: 500,
  getObjectById: id => sites[id] || null,
};

global.Memory = {};

const scanner = require("../scanner");
const executors = require("../task.executors");

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

// Следим за вызовами инвалидации через сам scanner (модуль-синглтон).
const cleared = [];
const origClear = scanner.clearStructureCache;
scanner.clearStructureCache = function (roomName) {
  cleared.push(roomName === undefined ? "*" : roomName);
  return origClear.call(this, roomName);
};

function makeCreep(roomName, buildResult) {
  return {
    name: "w1",
    room: { name: roomName },
    memory: { working: true },
    store: { energy: 100 },
    build: () => buildResult,
    travelTo: () => undefined,
  };
}

function runBuild(roomName, targetId, buildResult) {
  const task = { type: "build", targetId };
  return executors.executors.buildStructures(
    makeCreep(roomName, buildResult),
    task,
  );
}

// ── 1. Штатная стройка: кэш не трогаем ───────────────────────────────────
{
  console.log("\n1. Стройка идёт штатно — инвалидации нет");
  scanner.clearStructureCache();
  global._structureCache = {};
  rooms.A = null;
  const roomA = makeRoom("A");
  addStructure("A", "E1", STRUCTURE_EXTENSION);
  sites["S1"] = { id: "S1", structureType: STRUCTURE_EXTENSION };

  cleared.length = 0;
  const result = runBuild("A", "S1", OK);
  check("результат CONTINUE", result === "CONTINUE", String(result));
  check("кэш не сброшен", cleared.length === 0, JSON.stringify(cleared));

  // Прогрев кэша структур комнаты A.
  scanner.getStructureCache(roomA);
  check(
    "в кэше только построенное расширение",
    global._structureCache.A.extensionIds.length === 1,
    JSON.stringify(global._structureCache.A.extensionIds),
  );
}

// ── 2. Площадка исчезла: сброс кэша + задача завершена ───────────────────
{
  console.log("\n2. Стройплощадка исчезла — кэш комнаты сброшен");
  cleared.length = 0;
  delete sites["S1"]; // стройка завершена: площадки больше нет
  const result = runBuild("A", "S1", OK);
  check("задача завершена (DONE)", result === "DONE", String(result));
  check("кэш комнаты A сброшен", cleared.length === 1 && cleared[0] === "A", JSON.stringify(cleared));
}

// ── 3. ERR_INVALID_TARGET — тот же сброс ────────────────────────────────
{
  console.log("\n3. ERR_INVALID_TARGET — кэш комнаты тоже сброшен");
  sites["S2"] = { id: "S2", structureType: STRUCTURE_TOWER };
  cleared.length = 0;
  const result = runBuild("A", "S2", ERR_INVALID_TARGET);
  check("задача завершена (DONE)", result === "DONE", String(result));
  check("кэш комнаты A сброшен", cleared.length === 1 && cleared[0] === "A", JSON.stringify(cleared));
}

// ── 4. После сброса новое здание видно в кэше ───────────────────────────
{
  console.log("\n4. После сброса кэш пересобран и видит новое здание");
  global._structureCache = {};
  delete rooms.A;
  const roomA = makeRoom("A");
  addStructure("A", "E1", STRUCTURE_EXTENSION);
  const before = scanner.getStructureCache(roomA);
  const findsBefore = rooms.A.finds;
  check("до стройки — одно расширение", before.extensionIds.length === 1);

  // Здание построено: в комнате появилось второе расширение.
  addStructure("A", "E2", STRUCTURE_EXTENSION);
  const stillCached = scanner.getStructureCache(roomA);
  check(
    "без инвалидации кэш не замечает новое здание (TTL 1000)",
    stillCached.extensionIds.length === 1 && rooms.A.finds === findsBefore,
    `${stillCached.extensionIds.length} / ${rooms.A.finds}`,
  );

  scanner.clearStructureCache("A");
  const rebuilt = scanner.getStructureCache(roomA);
  check(
    "после инвалидации новое здание в roomState-кэше",
    rebuilt.extensionIds.length === 2 &&
      rebuilt.extensionIds.indexOf("E2") !== -1,
    JSON.stringify(rebuilt.extensionIds),
  );
}

// ── 5. Сброс не задевает другую комнату ─────────────────────────────────
{
  console.log("\n5. Сброс затрагивает только свою комнату");
  global._structureCache = {};
  delete rooms.B;
  const roomB = makeRoom("B");
  addStructure("B", "E9", STRUCTURE_EXTENSION);
  scanner.getStructureCache(roomB);
  const marker = global._structureCache.B;

  scanner.clearStructureCache("A");
  check(
    "кэш комнаты B остался тем же объектом",
    global._structureCache.B === marker,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
