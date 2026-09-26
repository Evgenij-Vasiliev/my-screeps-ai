"use strict";
/**
 * ===================================================
 * TASK.GENERATORS.THROTTLE.TEST.JS — офлайн-проверка троттлинга генерации
 * ===================================================
 * Симптом: 11 генераторов задач гонялись каждый тик по всем целям комнаты,
 * хотя генератор идемпотентен. Правка: запуск раз в TASK_GEN_INTERVAL тиков
 * категории, фаза расписания сдвинута по имени комнаты (нет синхронных пиков).
 *
 * Проверяем:
 *   1) в TASK_GEN_INTERVAL есть интервал для каждой категории TASK_CHAIN;
 *   2) интервал 1 — запуск каждый тик;
 *   3) интервал 3 — ровно раз в 3 тика (без пропусков и дублей);
 *   4) разные комнаты сканируют в разные тики (фаза по имени);
 *   5) runAll: троттлинг + дедуп не создают дублей (реальный генератор).
 *
 * Запуск: node tests/task.generators.throttle.test.js
 */

global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.Game = { time: 0, creeps: {}, constructionSites: {} };
global.Memory = { rooms: { R: { tasks: {} } } };

function resetHeap() {
  global._taskGenPhase = undefined;
  global._taskScan = undefined;
  global._taskIdSeq = undefined;
}

function newMemory() {
  global.Memory = { rooms: { R: { tasks: {} } } };
}

// ── Разрешение bare-require в стиле Screeps (как в worker.runner.cargo.test) ──
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

const tg = require("../task.generators");
const { TASK_CHAIN } = require("../task.manager");
const { TASK_GEN_INTERVAL, TASK_GEN_INTERVAL_DEFAULT } = require("../constants");

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

// ── 1. Полнота конфига ───────────────────────────────────────────────────
{
  console.log("\n1. Конфиг: интервал задан для каждой категории TASK_CHAIN");
  const missing = [];
  for (const t of TASK_CHAIN) {
    if (typeof TASK_GEN_INTERVAL[t] !== "number") missing.push(t);
  }
  check("все категории покрыты", missing.length === 0, missing.join(","));
  check(
    "дефолт — число",
    typeof TASK_GEN_INTERVAL_DEFAULT === "number",
    String(TASK_GEN_INTERVAL_DEFAULT),
  );
}

// ── 2. Интервал 1: каждый тик ────────────────────────────────────────────
{
  console.log("\n2. Интервал 1: генератор запускается каждый тик");
  resetHeap();
  let runs = 0;
  const gen = () => {
    runs++;
  };
  for (let t = 0; t < 5; t++) {
    Game.time = t;
    tg.runIfDue("R", "fillSpawnsExtensions", {}, gen, 1);
  }
  check("5 запусков за 5 тиков", runs === 5, String(runs));
}

// ── 3. Интервал 3: ровно раз в 3 тика ────────────────────────────────────
{
  console.log("\n3. Интервал 3: ровно раз в 3 тика, без пропусков и дублей");
  resetHeap();
  const ticks = [];
  const gen = () => {
    ticks.push(Game.time);
  };
  for (let t = 100; t < 112; t++) {
    Game.time = t;
    tg.runIfDue("R", "fillSpawnsExtensions", {}, gen, 3);
  }
  check("4 запуска за 12 тиков", ticks.length === 4, JSON.stringify(ticks));
  let stepOk = true;
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i] - ticks[i - 1] !== 3) stepOk = false;
  }
  check("шаг ровно 3 тика", stepOk, JSON.stringify(ticks));
}

// ── 4. Десинхронизация комнат ────────────────────────────────────────────
{
  console.log("\n4. Фаза по имени: комнаты сканируют в разные тики");
  resetHeap();
  function runTicksFor(room) {
    resetHeap();
    const ticks = [];
    const gen = () => {
      ticks.push(Game.time);
    };
    for (let t = 0; t < 24; t++) {
      Game.time = t;
      tg.runIfDue(room, "fillSpawnsExtensions", {}, gen, 4);
    }
    return ticks.join(",");
  }
  const a = runTicksFor("E35S37");
  const b = runTicksFor("E35S39");
  check("расписания комнат различаются", a !== b, a + " vs " + b);
}

// ── 5. runAll: троттлинг + дедуп ─────────────────────────────────────────
{
  console.log("\n5. runAll: реальный генератор не плодит дубли при троттлинге");
  resetHeap();
  newMemory();
  Game.constructionSites = {};
  const roomState = {
    roomName: "R",
    storage: { id: "ST" },
    spawns: [{ id: "SP", energy: 0, energyCapacity: 300 }],
    extensions: [],
    towers: [],
    damagedStructures: [],
    terminal: null,
    controller: null,
  };
  for (let t = 0; t < 6; t++) {
    Game.time = t;
    tg.runAll(roomState);
  }
  const queued = Memory.rooms.R.tasks.fillSpawnsExtensions || [];
  check("создана ровно одна Task на спавн", queued.length === 1, JSON.stringify(queued));
  check(
    "Task на нужную цель",
    !!queued[0] && queued[0].targetId === "SP",
    JSON.stringify(queued[0]),
  );
}

// ── 6. Стройплощадки: один перебор империи на тик ────────────────────────
// Прежний generateBuildStructures вызывал Object.values(Game.constructionSites)
// НА КАЖДУЮ комнату и фильтровал список по имени комнаты: N комнат × M
// площадок империи. Теперь площадки группируются по комнатам один раз за тик.
{
  console.log("\n6. Стройплощадки: перебор Game.constructionSites один раз за тик");
  resetHeap();
  newMemory();
  Memory.rooms.R2 = { tasks: {} };

  let siteReads = 0;
  const sites = {
    s1: { id: "s1", pos: { roomName: "R" } },
    s2: { id: "s2", pos: { roomName: "R" } },
    s3: { id: "s3", pos: { roomName: "R2" } },
  };
  Object.defineProperty(Game, "constructionSites", {
    configurable: true,
    get() {
      siteReads++;
      return sites;
    },
  });

  const stateR = {
    roomName: "R",
    storage: null,
    spawns: [],
    extensions: [],
    towers: [],
    damagedStructures: [],
    terminal: null,
    controller: null,
  };
  const stateR2 = {
    roomName: "R2",
    storage: null,
    spawns: [],
    extensions: [],
    towers: [],
    damagedStructures: [],
    terminal: null,
    controller: null,
  };

  Game.time = 500;
  tg.generateBuildStructures(stateR);
  const readsAfterFirstRoom = siteReads;
  check(
    "площадки империи перебраны",
    readsAfterFirstRoom > 0,
    String(readsAfterFirstRoom),
  );
  tg.generateBuildStructures(stateR2);
  check(
    "вторая комната в том же тике площадки не перебирает заново",
    siteReads === readsAfterFirstRoom,
    readsAfterFirstRoom + " → " + siteReads,
  );
  check(
    "задачи созданы только по площадкам своей комнаты",
    (Memory.rooms.R.tasks.buildStructures || []).length === 2 &&
      (Memory.rooms.R2.tasks.buildStructures || []).length === 1,
    JSON.stringify([
      Memory.rooms.R.tasks.buildStructures,
      Memory.rooms.R2.tasks.buildStructures,
    ]),
  );
  check(
    "цели — площадки комнаты R",
    (Memory.rooms.R.tasks.buildStructures || [])
      .map(t => t.targetId)
      .sort()
      .join(",") === "s1,s2",
    JSON.stringify(Memory.rooms.R.tasks.buildStructures),
  );

  // Смена тика: кеш пересобирается и новая площадка попадает в задачи.
  Game.time++;
  sites.s4 = { id: "s4", pos: { roomName: "R" } };
  tg.generateBuildStructures(stateR);
  check(
    "новый тик — площадки пересобраны, новая попала в задачи",
    siteReads > readsAfterFirstRoom &&
      (Memory.rooms.R.tasks.buildStructures || []).length === 3,
    siteReads + " / " + (Memory.rooms.R.tasks.buildStructures || []).length,
  );
  delete Game.constructionSites;
  Object.defineProperty(Game, "constructionSites", {
    configurable: true,
    writable: true,
    value: {},
  });
  delete Memory.rooms.R2;
}

// ── Гейт подвоза терминала: порог = резерв склада, а не 195000 ───────────
// Смысл правки 25.09.2026: терминал обязан доходить до ENERGY_TARGET (100000),
// а единственный источник — излишек склада. Прежний порог 195000 был выше
// живого склада (191–195k), поэтому цель была недостижима.
{
  console.log("\nГейт fillTerminalEnergy: порог 150000, а не 195000");
  const { STORAGE, TERMINAL_SUPPLY } = require("../constants");

  function terminalState(storageEnergy, terminalEnergy) {
    return {
      roomName: "R",
      storage: { id: "ST", store: { energy: storageEnergy } },
      terminal: { id: "TE", store: { energy: terminalEnergy } },
    };
  }
  const queued = () => Memory.rooms.R.tasks.fillTerminalEnergy || [];

  newMemory();
  resetHeap();
  tg.generateFillTerminalEnergy(terminalState(STORAGE.ENERGY_MIN + 1, 1000));
  check(
    "склад 150001 — задача создаётся (гейт больше не 195000)",
    queued().length === 1,
    JSON.stringify(queued()),
  );

  newMemory();
  resetHeap();
  tg.generateFillTerminalEnergy(terminalState(STORAGE.ENERGY_MIN, 1000));
  check(
    "склад на резерве 150000 — задача не создаётся",
    queued().length === 0,
    JSON.stringify(queued()),
  );

  newMemory();
  resetHeap();
  tg.generateFillTerminalEnergy(
    terminalState(200000, TERMINAL_SUPPLY.ENERGY_TARGET),
  );
  check(
    "терминал на цели 100000 — задача не создаётся",
    queued().length === 0,
    JSON.stringify(queued()),
  );

  check(
    "FILL_STORAGE_MULTIPLIER = 1.0 (порог подвоза = резерв склада)",
    TERMINAL_SUPPLY.FILL_STORAGE_MULTIPLIER === 1.0,
    String(TERMINAL_SUPPLY.FILL_STORAGE_MULTIPLIER),
  );
  check(
    "донорский STORAGE_RESERVE_MULTIPLIER не тронут (1.3)",
    TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER === 1.3,
    String(TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER),
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
