"use strict";
/**
 * ===================================================
 * TASK.INDEX.TEST.JS — офлайн-проверка heap-индекса задач
 * ===================================================
 * Задание 9 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) проверка дубля ищет существующую задачу (поведение не изменилось);
 *   2) ключ строится по своему набору полей: у repair достаточно targetId,
 *      у transfer важен ещё и resourceType;
 *   3) кэш ключей строится один раз на пару (комната, тип) за тик;
 *   4) задача, добавленная в том же тике, сразу видна проверке дубля
 *      (иначе генератор создал бы две одинаковые задачи);
 *   5) на новом тике кэш пересобирается;
 *   6) initRoomTasks не переинициализирует очереди повторно в том же тике;
 *   7) TASK_TYPE_SET отсекает неизвестный тип задачи.
 *
 * Запуск: node tests/task.index.test.js
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
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_UTRIUM = "U";
// Константы типов структур движок даёт всегда (они объявлены в runtime).
// Тесту они нужны потому, что task.generators подключает scanner, а тот
// строит по ним таблицу DAMAGED_TYPE_CODES на этапе загрузки модуля.
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_ROAD = "road";
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

const ROOM = "W1N1";
const FIELDS_TRANSFER = ["type", "targetId", "sourceId", "resourceType"];

console.log("1. hasDuplicate находит существующую задачу");
taskManager.addTask(ROOM, "fillTowers", {
  type: "transfer",
  targetId: "tower1",
  sourceId: "storage1",
  resourceType: "energy",
});
check(
  "дубль найден",
  taskManager.hasDuplicate(
    ROOM,
    "fillTowers",
    { type: "transfer", targetId: "tower1", sourceId: "storage1", resourceType: "energy" },
    FIELDS_TRANSFER,
  ) === true,
);
check(
  "другая цель — не дубль",
  taskManager.hasDuplicate(
    ROOM,
    "fillTowers",
    { type: "transfer", targetId: "tower2", sourceId: "storage1", resourceType: "energy" },
    FIELDS_TRANSFER,
  ) === false,
);
check(
  "другой ресурс — не дубль",
  taskManager.hasDuplicate(
    ROOM,
    "fillTowers",
    { type: "transfer", targetId: "tower1", sourceId: "storage1", resourceType: "power" },
    FIELDS_TRANSFER,
  ) === false,
);

console.log("\n2. Ключ зависит от набора полей");
// Для repair дубль — это совпадение targetId, ресурс не важен.
taskManager.addTask(ROOM, "repairStructures", { type: "repair", targetId: "road1" });
check(
  "repair: дубль по targetId",
  taskManager.hasDuplicate(ROOM, "repairStructures", { type: "repair", targetId: "road1" }, ["targetId"]) === true,
);
check(
  "repair: другой targetId не дубль",
  taskManager.hasDuplicate(ROOM, "repairStructures", { type: "repair", targetId: "road2" }, ["targetId"]) === false,
);

// Именно этот набор полей использует генератор ремонта — сверяем, что
// поведение генератора совпадает с проверкой (дубль не создаётся).
const damaged = { id: "road1", hits: 1, hitsMax: 100 };
taskGenerators.generateRepairStructures({ roomName: ROOM, damagedStructures: [damaged] });
check(
  "генератор ремонта не создал дубль",
  Memory.rooms[ROOM].tasks.repairStructures.length === 1,
  String(Memory.rooms[ROOM].tasks.repairStructures.length),
);

console.log("\n3. Кэш строится один раз за тик");
const heapBefore = global.__taskHeap;
taskManager.hasDuplicate(ROOM, "fillTowers", { targetId: "x" }, FIELDS_TRANSFER);
check("тот же объект heap", global.__taskHeap === heapBefore);

console.log("\n4. Задача, добавленная в том же тике, сразу видна");
const candidate = {
  type: "transfer",
  targetId: "tower9",
  sourceId: "storage1",
  resourceType: "energy",
};
check(
  "до добавления — не дубль",
  taskManager.hasDuplicate(ROOM, "fillTowers", candidate, FIELDS_TRANSFER) === false,
);
taskManager.addTask(ROOM, "fillTowers", candidate);
check(
  "после добавления — дубль (кэш дописан)",
  taskManager.hasDuplicate(ROOM, "fillTowers", candidate, FIELDS_TRANSFER) === true,
);

console.log("\n5. Генератор не плодит дубли за тик");
// Два вызова подряд в одном тике: второй не должен создать ни одной задачи.
const storage = { id: "storage1", store: { energy: 500000 } };
// .energy/.energyCapacity — алиасы store[RESOURCE_ENERGY] и
// store.getCapacity(RESOURCE_ENERGY), которыми generateFillTowers пользуется
// с 30.09.2026 (task.generators.js, замер 0.0193 -> 0.0034 CPU на 62 объекта).
const tower = {
  id: "towerX",
  energy: 0,
  energyCapacity: 1000,
  structureType: "tower",
};
const roomState = {
  roomName: ROOM,
  storage,
  towers: [tower],
};
function queueLen(type) {
  return Memory.rooms[ROOM].tasks[type].length;
}
const before = queueLen("fillTowers");
taskGenerators.generateFillTowers(roomState);
const afterFirst = queueLen("fillTowers");
taskGenerators.generateFillTowers(roomState);
const afterSecond = queueLen("fillTowers");
check("первый вызов добавил задачу", afterFirst === before + 1, `${before} -> ${afterFirst}`);
check("второй вызов не добавил", afterSecond === afterFirst, `${afterFirst} -> ${afterSecond}`);

console.log("\n6. Новый тик — кэш пересобирается");
const oldHeap = global.__taskHeap;
global.Game.time += 1;
taskManager.hasDuplicate(ROOM, "fillTowers", { targetId: "y" }, FIELDS_TRANSFER);
check("heap пересоздан", global.__taskHeap !== oldHeap);
check(
  "задача из прошлого тика по-прежнему дубль",
  taskManager.hasDuplicate(ROOM, "fillTowers", candidate, FIELDS_TRANSFER) === true,
);

console.log("\n7. TASK_TYPE_SET и initRoomTasks");
check("известный тип принят", taskManager.addTask(ROOM, "fillTowers", { type: "transfer", targetId: "z" }) === true);
check("неизвестный тип отвергнут", taskManager.addTask(ROOM, "нетТакого", { type: "x" }) === false);
const q = Memory.rooms[ROOM].tasks.upgradeController;
taskManager.initRoomTasks(ROOM);
check("повторная инициализация не подменяет очередь", Memory.rooms[ROOM].tasks.upgradeController === q);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
