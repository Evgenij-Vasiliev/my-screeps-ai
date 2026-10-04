"use strict";
/**
 * ===================================================
 * FILL.SPAWNS.TEST.JS — дешёвый отсев и дешёвый скан в generateFillSpawnsExtensions
 * ===================================================
 * Две правки, которые здесь проверяются:
 *
 * 1) 29.09.2026 — генератор не обходит 285 объектов империи, когда свободного
 *    места нет ни в одном из них (`energyAvailable === energyCapacityAvailable`,
 *    task/gen.spawns.js:76-82). Замер, из которого это выросло
 *    (scripts/cpu.peaks.measure.js, флаг Memory.cpuGenProfile, 92 окна):
 *    gen.fillSpawnsExtensions = 0.7921 CPU/тик, 77 % блока taskManager.
 *
 * 2) 30.09.2026 — «нужна ли энергия» проверяется алиасами .energy/.energyCapacity
 *    вместо вызова store.getFreeCapacity(RESOURCE_ENERGY)
 *    (task/gen.spawns.js:28-58, needsEnergy). Замер на живом shard3
 *    (scripts/task.manager.bench.js, N=300, реплика этого же цикла): скан
 *    62 объектов комнаты стоил 0.0209-0.0240 CPU с вызовом getFreeCapacity и
 *    0.0034-0.0061 CPU с алиасами. Живая сверка эквивалентности: 282 объекта
 *    spawn+extension, 0 расхождений между `energy < energyCapacity` и
 *    `getFreeCapacity(ENERGY) > 0`.
 *
 * Проверяем ровно то, что обещано:
 *   1) полны все — обход НЕ начинается и задач не ставится;
 *   2) место есть — обход идёт как раньше, задача ставится;
 *   3) потолок постановки исчерпан — обход обрывается, а не идёт до конца;
 *   4) заглушка roomState без полей room — поведение прежнее (обход);
 *   5) дубль по-прежнему не ставится второй раз;
 *   6) store.getFreeCapacity НЕ вызывается ни разу, а .energy/.energyCapacity
 *      читаются по разу на объект (иначе правка 2 откатилась бы молча).
 *
 * Запуск: node tests/fill.spawns.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("task.manager") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

global.OK = 0;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_UTRIUM = "U";
// Константы структур нужны scanner'у: он строит по ним таблицу на загрузке.
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";
global.Memory = {};
global.Game = { time: 1000, cpu: { getUsed: () => 0 }, creeps: {} };

const { TASK_CONFIG } = require("../constants");
const taskManager = require("../task.manager");
const taskGenerators = require("../task.generators");

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

/** Сколько раз генератор прочитал .energy/.energyCapacity (мера «обход шёл»). */
let touched = 0;
/** Сколько раз был вызван store.getFreeCapacity — должно остаться нулём. */
let freeCapacityCalls = 0;

/**
 * Цель генератора: spawn или extension.
 * `energy`/`energyCapacity` — те самые алиасы, которыми теперь пользуется
 * needsEnergy; `store` оставлен намеренно, чтобы поймать откат к вызову
 * getFreeCapacity (он считает вызовы и падает).
 */
function target(id, energy, capacity) {
  const t = { id, energy, energyCapacity: capacity };
  Object.defineProperty(t, "store", {
    get() {
      return {
        getFreeCapacity: () => {
          freeCapacityCalls++;
          throw new Error("store.getFreeCapacity не должен вызываться");
        },
      };
    },
  });
  return t;
}

/** Цель со счётчиком чтений .energy (проверка «читаем по разу на объект»). */
function countingTarget(id, energy, capacity) {
  const t = { id, energyCapacity: capacity };
  Object.defineProperty(t, "energy", {
    get() {
      touched++;
      return energy;
    },
  });
  return t;
}

/** Очередь задач типа fillSpawnsExtensions в комнате room. */
function queue(room) {
  const tasks =
    Memory.rooms && Memory.rooms[room] && Memory.rooms[room].tasks;
  return (tasks && tasks.fillSpawnsExtensions) || [];
}

function state(room, available, capacity, spawns, extensions) {
  return {
    roomName: room,
    room: {
      energyAvailable: available,
      energyCapacityAvailable: capacity,
    },
    storage: { id: "st1" },
    spawns,
    extensions,
  };
}

console.log("\n1. Все spawn/extension полны — обхода нет");
Game.time = 2001;
touched = 0;
taskGenerators.generateFillSpawnsExtensions(
  state("R1", 1000, 1000, [countingTarget("s1", 100, 100)], [
    countingTarget("e1", 50, 50),
    countingTarget("e2", 50, 50),
  ]),
);
check("обход не начался (.energy не читался)", touched === 0, `touched=${touched}`);
check("задач не поставлено", queue("R1").length === 0, `len=${queue("R1").length}`);

console.log("\n2. Место есть — обход идёт, задача ставится");
Game.time = 2002;
touched = 0;
freeCapacityCalls = 0;
taskGenerators.generateFillSpawnsExtensions(
  state("R2", 900, 1000, [target("s1", 0, 100)], [
    target("e1", 100, 100),
    target("e2", 100, 100),
  ]),
);
check(
  "задача поставлена на того, кому нужна энергия",
  queue("R2").length === 1 && queue("R2")[0].targetId === "s1",
  JSON.stringify(queue("R2")),
);
check(
  "store.getFreeCapacity не вызван ни разу",
  freeCapacityCalls === 0,
  `вызовов=${freeCapacityCalls}`,
);

console.log("\n3. Потолок постановки — обход обрывается");
Game.time = 2003;
touched = 0;
const many = [];
for (let i = 0; i < 12; i++) many.push(countingTarget("e" + i, 0, 100));
taskGenerators.generateFillSpawnsExtensions(state("R3", 900, 1000, [], many));
check(
  `поставлено ровно ${TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK} задач`,
  queue("R3").length === TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK,
  `len=${queue("R3").length}`,
);
check(
  "обход оборван, а не пройден до конца",
  touched === TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK + 1,
  `touched=${touched} из 12`,
);

console.log("\n4. Заглушка roomState без полей room — прежнее поведение");
Game.time = 2004;
touched = 0;
taskGenerators.generateFillSpawnsExtensions({
  roomName: "R4",
  storage: { id: "st1" },
  spawns: [target("s9", 0, 100)],
  extensions: [],
});
check("задача поставлена", queue("R4").length === 1, `len=${queue("R4").length}`);

console.log("\n5. Дубль не ставится второй раз");
Game.time = 2005;
touched = 0;
const dup = state("R5", 900, 1000, [], [target("e1", 0, 100)]);
taskGenerators.generateFillSpawnsExtensions(dup);
taskGenerators.generateFillSpawnsExtensions(dup);
check("в очереди одна задача, а не две", queue("R5").length === 1, `len=${queue("R5").length}`);

// Правка 30.09.2026: вместо вызова store.getFreeCapacity(RESOURCE_ENERGY)
// читаются алиасы .energy/.energyCapacity (@types/screeps:5104-5116). Смысл
// правки — убрать вызов метода у игрового объекта, поэтому проверяем и число
// чтений (по разу на объект), и отсутствие вызова.
console.log("\n6. Алиасы читаются по разу на объект, вызова getFreeCapacity нет");
Game.time = 2006;
touched = 0;
freeCapacityCalls = 0;
let storageIdReads = 0;
const countingStorage = {
  get id() {
    storageIdReads++;
    return "st1";
  },
};
taskGenerators.generateFillSpawnsExtensions({
  roomName: "R6",
  room: { energyAvailable: 900, energyCapacityAvailable: 1000 },
  storage: countingStorage,
  spawns: [countingTarget("s1", 0, 100)],
  extensions: [countingTarget("e1", 0, 100), countingTarget("e2", 0, 100)],
});
check("energy прочитан ровно по разу на объект", touched === 3, `reads=${touched} на 3 объекта`);
check("id хранилища прочитан один раз на комнату", storageIdReads === 1, `reads=${storageIdReads}`);
check(
  "store.getFreeCapacity не вызван",
  freeCapacityCalls === 0,
  `вызовов=${freeCapacityCalls}`,
);

console.log("\n7. Заглушка без .energy/.energyCapacity — «места нет», как раньше");
Game.time = 2007;
taskGenerators.generateFillSpawnsExtensions(
  state("R7", 900, 1000, [{ id: "s1" }], [{ id: "e1" }]),
);
check(
  "задач не поставлено",
  queue("R7").length === 0,
  `len=${queue("R7").length}`,
);

/*
 * Гейт по глубине очереди (решение человека 30.09.2026, K = 3).
 * Пока свободных задач этого типа в комнате ≥ K, скан spawn/extension не
 * начинается: замер shard3 30.09.2026 (read-only) — в 4 комнатах из 5 очередь
 * 12-18 задач, свободных 10-16, воркеров 2 на комнату; скан стоит
 * 0.021-0.025 CPU на неполную комнату за тик.
 */
console.log("\n8. Гейт по глубине очереди: свободных >= K — скана нет");
Game.time = 2008;
touched = 0;
taskGenerators.generateFillSpawnsExtensions(
  state("R8", 900, 1000, [countingTarget("s8", 0, 100)], []),
);
check("очередь не пуста (задача поставлена)", queue("R8").length === 1, `len=${queue("R8").length}`);

// Доводим число свободных задач до порога вручную.
while (queue("R8").length < TASK_CONFIG.FILLSPAWNS_QUEUE_GATE) {
  taskManager.addTask("R8", "fillSpawnsExtensions", {
    type: "transfer",
    targetId: "seed" + queue("R8").length,
    sourceId: "st1",
    resourceType: "energy",
  });
}
touched = 0;
taskGenerators.generateFillSpawnsExtensions(
  state("R8", 900, 1000, [countingTarget("s8", 0, 100)], []),
);
check(
  `свободных ${queue("R8").length} >= ${TASK_CONFIG.FILLSPAWNS_QUEUE_GATE}: обхода нет`,
  touched === 0,
  `touched=${touched}`,
);
check(
  "новых задач не поставлено",
  queue("R8").length === TASK_CONFIG.FILLSPAWNS_QUEUE_GATE,
  `len=${queue("R8").length}`,
);

console.log("\n9. Гейт: свободных меньше K — скан идёт как раньше");
Game.time = 2009;
// Занимаем одну задачу живым крипом: свободных становится K-1.
Game.creeps["gateWorker"] = { name: "gateWorker" };
queue("R8")[0].reservedBy = "gateWorker";
check(
  "свободных стало K-1",
  taskManager.freeTasks("R8", "fillSpawnsExtensions") ===
    TASK_CONFIG.FILLSPAWNS_QUEUE_GATE - 1,
  String(taskManager.freeTasks("R8", "fillSpawnsExtensions")),
);
touched = 0;
taskGenerators.generateFillSpawnsExtensions(
  state("R8", 900, 1000, [countingTarget("s8b", 0, 100)], []),
);
check("скан выполнен", touched === 1, `touched=${touched}`);
check(
  "задача поставлена (свободных снова K)",
  queue("R8").length === TASK_CONFIG.FILLSPAWNS_QUEUE_GATE + 1,
  `len=${queue("R8").length}`,
);

console.log("\n10. Гейт выключается нулём (точка отката)");
Game.time = 2010;
const savedGate = TASK_CONFIG.FILLSPAWNS_QUEUE_GATE;
TASK_CONFIG.FILLSPAWNS_QUEUE_GATE = 0;
touched = 0;
taskGenerators.generateFillSpawnsExtensions(
  state("R8", 900, 1000, [countingTarget("s8c", 0, 100)], []),
);
check("при 0 скан идёт даже на глубокой очереди", touched === 1, `touched=${touched}`);
check(
  "и задача ставится",
  queue("R8").length === savedGate + 2,
  `len=${queue("R8").length}`,
);
TASK_CONFIG.FILLSPAWNS_QUEUE_GATE = savedGate;

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
