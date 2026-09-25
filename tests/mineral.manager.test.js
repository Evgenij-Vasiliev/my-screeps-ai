"use strict";
/**
 * ===================================================
 * MINERAL.MANAGER.TEST.JS — офлайн-проверка тикового разрешения минерала
 * ===================================================
 * Проблема (subagent_cpu, п. 4): mineral.manager каждый тик заново вызывал
 * Game.getObjectById ради минерала и экстрактора, а потребители состояния
 * (role.mineralMiner, spawn.manager) разрешали тот же объект ещё раз — по
 * каждому крипу и каждой проверке квоты.
 *
 * Правка: разрешённые объекты кладутся в тот же heap-кеш
 * (global._mineralCache[roomName]) с меткой тика, а состояние отдаёт их
 * потребителям полями mineral/extractor. Внешний вид состояния не изменился
 * (id / mineralType / amount / extractorId на месте).
 *
 * Проверяем:
 *   1) за тик минерал и экстрактор разрешаются один раз (2 getObjectById);
 *   2) повторный вызов в том же тике не делает обращений и отдаёт то же
 *      состояние (и те же объекты);
 *   3) новый тик пересобирает состояние заново (и это НОВЫЙ объект: держать
 *      ссылки на объекты движка между тиками нельзя);
 *   4) комната без минерала: null + один лог, повторных логов нет;
 *   5) снесённый экстрактор: extractorId = null, состояние пересобрано;
 *   6) потребители берут объект из состояния (role.mineralMiner, spawn.manager).
 *
 * Запуск: node tests/mineral.manager.test.js
 */

// ── Глобалы движка ───────────────────────────────────────────────────────
global.FIND_MY_STRUCTURES = 1;
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;
global.LOOK_STRUCTURES = "structure";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "constructedWall";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_EXTRACTOR = "extractor";

function makeMineral(id, amount) {
  return {
    id,
    mineralType: "U",
    mineralAmount: amount,
    pos: { lookFor: () => (extractor ? [extractor] : []) },
  };
}
function makeExtractor(id) {
  return { id, structureType: STRUCTURE_EXTRACTOR };
}

let mineral = makeMineral("MIN", 3000);
let extractor = makeExtractor("EXT");
let objectByIdCalls = 0;

global.Game = {
  time: 1000,
  getObjectById: id => {
    objectByIdCalls++;
    if (id === "MIN") return mineral;
    if (id === "EXT") return extractor;
    return null;
  },
};

global.Memory = {};

function makeRoom(name, withMineral) {
  return {
    name,
    memory: {},
    storage: null,
    terminal: null,
    find: (type, opts) => {
      if (type === FIND_MY_STRUCTURES) return [];
      if (type === FIND_STRUCTURES) {
        const all = extractor ? [extractor] : [];
        return opts && opts.filter ? all.filter(opts.filter) : all;
      }
      if (type === FIND_SOURCES) return [];
      if (type === FIND_MINERALS) return withMineral ? [mineral] : [];
      return [];
    },
  };
}

// ── Разрешение bare-require в стиле Screeps (как в других тестах) ────────
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

const scanner = require("../scanner");
const mineralManager = require("../mineral.manager");

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

// Кеши инициализирует сам scanner при загрузке — «сброс памяти» это пустые
// объекты, а не undefined (иначе самопосборка кеша не сработала бы).
function resetHeap() {
  global._mineralCache = {};
  global._structureCache = {};
}

// ── 1-3. Одно разрешение на тик ─────────────────────────────────────────
{
  console.log("\n1. Разрешение минерала: один раз на комнату за тик");
  resetHeap();
  mineral = makeMineral("MIN", 3000);
  extractor = makeExtractor("EXT");
  const room = makeRoom("R", true);

  objectByIdCalls = 0;
  Game.time = 100;
  const first = mineralManager.buildMineralState(room);
  check(
    "состояние собрано",
    !!first && first.id === "MIN" && first.amount === 3000,
    JSON.stringify(first),
  );
  check(
    "минерал разрешён один раз (экстрактор — из lookFor)",
    objectByIdCalls === 1,
    String(objectByIdCalls),
  );
  check(
    "разрешённые объекты отдаются потребителям",
    first.mineral === mineral && first.extractor === extractor,
  );
  check("extractorId на месте", first.extractorId === "EXT", String(first.extractorId));

  const second = mineralManager.buildMineralState(room);
  check("повторный вызов: 0 обращений", objectByIdCalls === 1, String(objectByIdCalls));
  check("то же состояние в пределах тика", second === first);

  Game.time++;
  objectByIdCalls = 0;
  const third = mineralManager.buildMineralState(room);
  // Новый тик идёт по уже известным id: минерал + экстрактор, без lookFor.
  check("новый тик — состояние пересобрано (минерал + экстрактор)", objectByIdCalls === 2, String(objectByIdCalls));
  check("между тиками объект состояния новый", third !== first && third.id === "MIN");
}

// ── 4. Комната без минерала ─────────────────────────────────────────────
{
  console.log("\n4. Комната без минерала: null, лог один раз");
  resetHeap();
  const room = makeRoom("N", false);

  const logged = [];
  const origLog = console.log;
  console.log = (...args) => {
    logged.push(args.join(" "));
    origLog(...args);
  };

  objectByIdCalls = 0;
  Game.time = 200;
  const state = mineralManager.buildMineralState(room);
  check("состояние = null", state === null, String(state));
  check("обращений к Game.getObjectById нет", objectByIdCalls === 0);
  check("флаг лога выставлен", room.memory._mineralNoneLogged === true);

  logged.length = 0;
  Game.time++;
  mineralManager.buildMineralState(room);
  check("повторного лога нет", logged.length === 0, logged.join(" | "));

  console.log = origLog;
}

// ── 5. Снесённый экстрактор ─────────────────────────────────────────────
{
  console.log("\n5. Снесённый экстрактор: extractorId = null");
  resetHeap();
  mineral = makeMineral("MIN", 500);
  extractor = makeExtractor("EXT");
  const room = makeRoom("R2", true);

  Game.time = 300;
  const before = mineralManager.buildMineralState(room);
  check("экстрактор был", before.extractorId === "EXT");

  extractor = null;
  room.memory = {};
  Game.time++;
  const after = mineralManager.buildMineralState(room);
  check(
    "экстрактор исчез — состояние пересобрано",
    !!after && after.extractorId === null && after.extractor === null,
    JSON.stringify(after),
  );
  check("минерал остался", after.id === "MIN" && after.amount === 500);

  // Структурный кэш scanner тоже пересобирается — экстрактор больше не найден.
  const cache = scanner.getStructureCache(room);
  check("scanner-кэш без экстрактора", cache.extractorId === null);
}

// ── 6. Потребители не разрешают объект повторно ─────────────────────────
{
  console.log("\n6. Потребители берут объект из состояния (без getObjectById)");
  resetHeap();
  mineral = makeMineral("MIN", 7000);
  extractor = makeExtractor("EXT");
  const room = makeRoom("R3", true);

  Game.time = 400;
  const state = mineralManager.buildMineralState(room);
  const callsAfterBuild = objectByIdCalls;

  // Как role.mineralMiner и spawn.manager: state.mineral, иначе фолбэк.
  const fromState = state.mineral || Game.getObjectById(state.id);
  check("объект взят из состояния", fromState === mineral);
  check(
    "новых обращений к Game.getObjectById нет",
    objectByIdCalls === callsAfterBuild,
    `${callsAfterBuild} → ${objectByIdCalls}`,
  );
  check(
    "цена на месте (spawn.manager проверяет mineralAmount)",
    fromState.mineralAmount === 7000,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
