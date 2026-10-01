"use strict";
/**
 * ===================================================
 * TASK.INDEX2.TEST.JS — офлайн-проверка taskId вместо копии задачи
 * ===================================================
 * Задание 9, часть 2 (пп. 1 и 3 плана). Проверяем:
 *   1) в памяти крипа НЕТ копии задачи — только taskId;
 *   2) задача резолвится из очереди за O(1) (byId), а не поиском;
 *   3) воркер продолжает работу по своей задаче на следующем тике;
 *   4) завершённая задача уходит из очереди, задача исчезает из индекса;
 *   5) getNextTask не отдаёт зарезервированную живым крипом задачу
 *      и мгновенно отвечает «нет свободных» по счётчику;
 *   6) задача, зарезервированная умершим крипом, освобождается;
 *   7) миграция старого формата: memory.task -> memory.taskId;
 *   8) завершение задачи НЕ сдвигает массив (позиции в индексе остаются
 *      верными), а compactAll() убирает надгробия до сериализации Memory.
 *
 * Запуск: node tests/task.index2.test.js
 */

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

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_UTRIUM = "U";
global.Memory = {};
const controller = {
  id: "ctrl1",
  ticksToDowngrade: 1000, // ниже CONTROLLER.DOWNGRADE_MAX — задача не завершится сама
};
global.Game = {
  time: 2000,
  cpu: { getUsed: () => 0 },
  creeps: {},
  getObjectById: id => (id === "ctrl1" ? controller : null),
};

const taskManager = require("../task.manager");
const workerRunner = require("../worker.runner");

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

const ROOM = "W1N1";
const TYPE = "upgradeController";
// Воркер смотрит очередь по taskIndex, а не по имени типа.
const TYPE_INDEX = taskManager.TASK_CHAIN.indexOf(TYPE);
global.Memory.creeps = {};

function queue() {
  return Memory.rooms[ROOM].tasks[TYPE];
}

function addTask(id) {
  taskManager.addTask(ROOM, TYPE, { type: "upgrade", targetId: "ctrl1", taskId: id });
}

// Новая игровая секунда: heap-индексы сбрасываются, Memory остаётся.
function nextTick() {
  global.Game.time += 1;
}

function makeCreep(name, memory) {
  const creep = {
    name,
    memory: Object.assign(
      { role: "worker", homeRoom: ROOM, taskIndex: TYPE_INDEX },
      memory,
    ),
    room: { name: ROOM },
    pos: { isEqualTo: () => true, getRangeTo: () => 1 },
    store: { energy: 50, getFreeCapacity: () => 0 },
    upgradeController: () => global.OK,
    withdraw: () => global.OK,
  };
  global.Game.creeps[name] = creep;
  return creep;
}

console.log("1. В памяти крипа только taskId");
for (let i = 0; i < 3; i++) addTask("task_" + (i + 1));
const creep = makeCreep("w1", {});
workerRunner.run(creep);
check("taskId записан", typeof creep.memory.taskId === "string", String(creep.memory.taskId));
check("копии задачи в памяти нет", creep.memory.task === undefined);
check("задача зарезервирована", queue()[0].reservedBy === "w1", String(queue()[0].reservedBy));
check(
  "Memory.creeps не содержит объекта задачи",
  JSON.stringify(Memory.creeps.w1 || creep.memory).indexOf("targetId") === -1,
);

console.log("\n2. Воркер продолжает свою задачу на следующем тике");
nextTick();
creep.memory.taskIndex = TYPE_INDEX;
workerRunner.run(creep);
check(
  "задача та же",
  queue().some(t => t.taskId === creep.memory.taskId && t.reservedBy === "w1"),
  String(creep.memory.taskId),
);
check("очередь не выросла", queue().length === 3, String(queue().length));

console.log("\n3. GetTaskById — O(1) по индексу");
nextTick();
const t = taskManager.getTaskById(ROOM, TYPE, "task_2");
check("задача найдена по id", t !== null && t.taskId === "task_2");
check("несуществующий id — null", taskManager.getTaskById(ROOM, TYPE, "нетТакого") === null);

console.log("\n4. getNextTask не отдаёт зарезервированное");
nextTick();
const free1 = taskManager.getNextTask(ROOM, TYPE);
check("свободная задача есть", free1 !== null && free1.taskId !== creep.memory.taskId);
check("это не задача воркера", free1.taskId !== "task_1");

console.log("\n5. Все заняты — «нет свободных» без обхода");
nextTick();
const creep2 = makeCreep("w2", {});
workerRunner.run(creep2);
const creep3 = makeCreep("w3", {});
workerRunner.run(creep3);
check("все три задачи разобраны", queue().every(q => q.reservedBy), queue().map(q => q.reservedBy).join(","));
nextTick();
check("getNextTask вернул null", taskManager.getNextTask(ROOM, TYPE) === null);

console.log("\n6. Задача умершего крипа освобождается");
nextTick();
delete global.Game.creeps.w2;
const freed = taskManager.getNextTask(ROOM, TYPE);
check(
  "задача w2 снова доступна",
  freed !== null && freed.reservedBy === "w2",
  freed ? freed.reservedBy : "null",
);

console.log("\n7. Завершение задачи удаляет её из очереди и индекса");
nextTick();
const taskOfW3 = taskManager.getTaskById(ROOM, TYPE, creep3.memory.taskId);
const lenBefore = queue().length;
const indexBefore = queue().indexOf(taskOfW3);
const done = taskManager.completeTask(ROOM, TYPE, taskOfW3);
check("completeTask вернул true", done === true);
check(
  "массив НЕ сдвинулся (надгробие вместо splice)",
  queue().length === lenBefore && queue()[indexBefore] === null,
  `len ${lenBefore}->${queue().length}, слот ${indexBefore}=${queue()[indexBefore]}`,
);
check(
  "соседи остались на своих местах",
  queue().filter(Boolean).length === lenBefore - 1,
  String(queue().filter(Boolean).length),
);
check(
  "задачи нет в очереди",
  !queue().some(q => q && q.taskId === taskOfW3.taskId),
);
check("задачи нет в индексе", taskManager.getTaskById(ROOM, TYPE, taskOfW3.taskId) === null);
check(
  "до сжатия в очереди есть надгробие",
  queue().some(q => q === null),
  JSON.stringify(queue()),
);

// Сжатие — то, что вызывает empire.js в конце тика.
const compacted = taskManager.compactAll();
check("compactAll сжал очередь", compacted >= 1, String(compacted));
check(
  "после сжатия дыр нет",
  queue().every(q => q && q.taskId),
  JSON.stringify(queue()),
);
check(
  "задача по-прежнему не находится",
  taskManager.getTaskById(ROOM, TYPE, taskOfW3.taskId) === null,
);
check(
  "соседняя задача находится после переиндексации",
  taskManager.getTaskById(ROOM, TYPE, "task_2") !== null,
);

console.log("\n8. Миграция старого формата memory.task -> memory.taskId");
nextTick();
// Свежая задача, зарезервированная этим же крипом в старом формате.
addTask("task_migrate");
const migrated = queue().find(q => q && q.taskId === "task_migrate");
migrated.reservedBy = "w4";
const creep4 = makeCreep("w4", {
  task: { type: "upgrade", targetId: "ctrl1", taskId: "task_migrate" },
});
workerRunner.run(creep4);
check("taskId перенесён из старой копии", creep4.memory.taskId === "task_migrate", String(creep4.memory.taskId));
check("старая копия удалена", creep4.memory.task === undefined);
check(
  "резервация осталась за этим же крипом",
  queue().find(q => q && q.taskId === "task_migrate").reservedBy === "w4",
  queue().filter(Boolean).map(q => q.taskId + ":" + q.reservedBy).join(","),
);

console.log("\n9. Надгробия не ломают обход очереди (защита до сжатия)");
nextTick();
makeCreep("w5", {});
makeCreep("w6", {});
// Две свежие задачи, чтобы в очереди точно были свободные.
addTask("task_9a");
addTask("task_9b");
// Разбираем две задачи воркерами, затем завершаем одну — в очереди дыра.
const t5 = taskManager.getNextTask(ROOM, TYPE);
check("есть свободная задача", t5 !== null);
taskManager.reserveTask(ROOM, TYPE, t5, "w5");
const t6 = taskManager.getNextTask(ROOM, TYPE);
taskManager.reserveTask(ROOM, TYPE, t6, "w6");
taskManager.completeTask(ROOM, TYPE, t5);
check("в очереди есть дыра", queue().some(q => q === null));

const stillThere = taskManager.getTaskById(ROOM, TYPE, t6.taskId);
check("соседняя задача резолвится через дыру", stillThere !== null && stillThere.taskId === t6.taskId);

// Снимаем резервацию — задача снова свободна, обход обязан её найти.
taskManager.releaseTask(ROOM, TYPE, t6);
check(
  "getNextTask находит задачу, перешагнув надгробие",
  taskManager.getNextTask(ROOM, TYPE) === t6,
);
check(
  "hasDuplicate не падает на надгробии",
  taskManager.hasDuplicate(ROOM, TYPE, { targetId: "ctrl1" }, ["targetId"]) === true,
);

/*
 * Правка 30.09.2026 (оптимизация по CPU): позиции задач (indexById) строятся
 * ЛЕНИВО — только когда задачу ищут по taskId. getNextTask обходится
 * счётчиками free/dead и Map не создаёт.
 *
 * Замер на живом shard3 (scripts/task.manager.bench.js, 5 прогонов):
 * построение индекса непустой очереди — 0.0014-0.0029 CPU, а трогается за тик
 * 45 пар (комната, тип), и лишь в 1-3 из них задачу ищут по taskId
 * (scripts/task.manager.calls.js: getTaskById 4.95 + reserveTask 0.91 +
 * completeTask 0.24 за тик против 42.9 getNextTask и 42.8 hasDuplicate).
 *
 * Проверяем: (1) после getNextTask позиции НЕ построены; (2) счётчик свободных
 * при этом верен; (3) getTaskById строит позиции и находит задачу;
 * (4) reserve/complete работают на ленивом индексе; (5) после compactAll
 * старые позиции не используются.
 */
console.log("\n10. Позиции (indexById) строятся лениво");
nextTick();
const LAZY_ROOM = "W9N1";
Memory.rooms[LAZY_ROOM] = { tasks: {} };
for (let i = 0; i < 3; i++) {
  taskManager.addTask(LAZY_ROOM, "fillTowers", {
    type: "transfer",
    targetId: "tower" + i,
    taskId: "lazy_" + i,
  });
}
taskManager.getNextTask(LAZY_ROOM, "fillTowers");
const lazyEntry = global.__taskHeap.queues[LAZY_ROOM + "\u0001fillTowers"];
check(
  "после getNextTask позиции не построены",
  lazyEntry !== undefined && lazyEntry.indexById === null,
  String(lazyEntry && lazyEntry.indexById),
);
check(
  "счётчик свободных посчитан без Map",
  lazyEntry !== undefined && lazyEntry.free === 3,
  String(lazyEntry && lazyEntry.free),
);

const lazyFound = taskManager.getTaskById(LAZY_ROOM, "fillTowers", "lazy_1");
check(
  "getTaskById строит позиции и находит задачу",
  lazyFound !== null && lazyFound.taskId === "lazy_1",
);
check(
  "после getTaskById позиции построены",
  lazyEntry.indexById instanceof Map,
  String(lazyEntry.indexById),
);

const lazyNext = taskManager.getNextTask(LAZY_ROOM, "fillTowers");
check(
  "reserveTask на ленивом индексе",
  taskManager.reserveTask(LAZY_ROOM, "fillTowers", lazyNext, "w9") === true,
);
check("счётчик свободных уменьшился", lazyEntry.free === 2, String(lazyEntry.free));
check(
  "completeTask на ленивом индексе",
  taskManager.completeTask(LAZY_ROOM, "fillTowers", lazyNext) === true,
);

taskManager.compactAll();
check(
  "после compactAll позиции сброшены",
  lazyEntry.indexById === null,
  String(lazyEntry.indexById),
);
check(
  "очередь сжата (3 добавлено, 1 завершена)",
  Memory.rooms[LAZY_ROOM].tasks.fillTowers.length === 2,
  String(Memory.rooms[LAZY_ROOM].tasks.fillTowers.length),
);
check(
  "getTaskById работает после сжатия",
  taskManager.getTaskById(LAZY_ROOM, "fillTowers", "lazy_1") !== null,
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
