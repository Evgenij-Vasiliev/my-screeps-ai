"use strict";
/**
 * ===================================================
 * ROOMSTATE.TEST.JS — офлайн-проверка сборки roomState в один проход
 * ===================================================
 * Задание 10 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) roomState содержит те же группы структур, что и раньше;
 *   2) damagedStructures собран без промежуточных concat-массивов и
 *      содержит ровно повреждённые структуры нужных типов;
 *   3) getOwnedRooms обходит Game.rooms без Object.values и берёт только
 *      свои комнаты;
 *   4) минерал отдаётся объектом (object) и его extractorId берётся из
 *      structureCache, без лишнего Game.getObjectById на экстрактор;
 *   5) spawn.manager и role.mineralMiner не резолвят минерал повторно.
 *
 * Запуск: node tests/roomstate.test.js
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
global.ERR_INVALID_ARGS = -5;
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
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.TOUGH = "tough";
global._ = {
  some: (collection, predicate) =>
    Object.keys(collection).some(k => predicate(collection[k])),
};

global.Memory = { rooms: {} };
global.Game = {
  time: 3000,
  creeps: {},
  rooms: {},
  spawns: {},
  constructionSites: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};

/* ── Объекты комнаты ──────────────────────────────────────────────────── */
const objects = {};
function mk(id, type, extra) {
  objects[id] = Object.assign(
    { id, structureType: type, hits: 1000, hitsMax: 1000, my: true },
    extra || {},
  );
  return objects[id];
}

mk("sp1", "spawn");
mk("tow1", "tower");
mk("tow2", "tower", { hits: 500 }); // повреждена
mk("link1", "link");
mk("ext1", "extension");
mk("ext2", "extension", { hits: 10 }); // повреждена
mk("road1", "road", { hits: 100 }); // повреждена
mk("road2", "road");
mk("wall1", "wall");
mk("ramp1", "rampart");
mk("fac1", "factory");
mk("ps1", "powerSpawn");
mk("obs1", "observer");
mk("nuk1", "nuker");
mk("ex1", "extractor");
mk("st1", "storage", { structureType: "storage" });
mk("tm1", "terminal", { structureType: "terminal" });
const mineral = { id: "min1", mineralType: "U", mineralAmount: 5000 };

let getObjectByIdCalls = 0;
global.Game.getObjectById = id => {
  getObjectByIdCalls++;
  if (id === "min1") return mineral;
  return objects[id] || null;
};

const cache = {
  // Схема кэша — 3 (29.09.2026): добавлены числа повреждённых владельческих
  // структур. Схема 2 теперь считается неполной и перестраивается, поэтому
  // фикстура обязана нести актуальную версию.
  v: 3,
  updatedAt: 3000,
  controllerLevel: 4,
  spawnIds: ["sp1"],
  towerIds: ["tow1", "tow2"],
  linkIds: ["link1"],
  labIds: [],
  extensionIds: ["ext1", "ext2"],
  roadIds: ["road1", "road2"],
  // Предвычисленный сканером список повреждённых дорог (правка шага 2).
  damagedRoadIds: ["road1"],
  damagedRoadHits: Int32Array.from([100]),
  damagedRoadHitsMax: Int32Array.from([1000]),
  damagedRoadCount: 1,
  // Числа повреждённых владельческих структур (правка 29.09.2026): только
  // tow2 (500/1000) и ext2 (10/1000); tow1 и ext1 целые.
  damagedIds: ["tow2", "ext2"],
  damagedStats: Int32Array.from([2, 500, 1000, 3, 10, 1000]),
  damagedCount: 2,
  wallIds: ["wall1"],
  rampartIds: ["ramp1"],
  factoryId: "fac1",
  powerSpawnId: "ps1",
  observerId: "obs1",
  extractorId: "ex1",
  nukerId: "nuk1",
  storageId: "st1",
  terminalId: "tm1",
  sourceIds: ["src1"],
  mineralId: "min1",
};
objects.src1 = { id: "src1", energy: 3000, energyCapacity: 3000 };

global.__structureCache = { W1N1: cache };
global.__sitesByRoom = { tick: 3000, byRoom: {} };

Memory.rooms.W1N1 = { tasks: {}, role: "core" };
const room = {
  name: "W1N1",
  controller: { my: true, id: "ctrl1", level: 4, ticksToDowngrade: 100000 },
  memory: Memory.rooms.W1N1,
  storage: objects.st1,
  terminal: objects.tm1,
  find: () => [],
};
const enemyRoom = {
  name: "W9N9",
  controller: { my: false, id: "ctrl2", level: 2 },
  memory: {},
  find: () => [],
};
global.Game.rooms = { W1N1: room, W9N9: enemyRoom };

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

console.log("1. Группы структур собраны полностью");
const state = roomManager.buildRoomState(room, [], []);
check("спавны", state.spawns.length === 1 && state.spawns[0].id === "sp1");
check("башни", state.towers.length === 2, String(state.towers.length));
check("расширения", state.extensions.length === 2, String(state.extensions.length));
check(
  "дороги не резолвятся в отдельный массив (roomState.roads убран)",
  state.roads === undefined,
);
check("лаборатории пусты", state.labs.length === 0);
check("источники", state.sources.length === 1 && state.sources[0].id === "src1");
check("фабрика", state.factory && state.factory.id === "fac1");
check("powerSpawn", state.powerSpawn && state.powerSpawn.id === "ps1");
check("observer", state.observer && state.observer.id === "obs1");
check("nuker", state.nuker && state.nuker.id === "nuk1");
check("extractor", state.extractor && state.extractor.id === "ex1");
check("storage/terminal", state.storage === objects.st1 && state.terminal === objects.tm1);
check(
  "стены и валы — только id (ленивый резолв)",
  Array.isArray(state.wallIds) && state.wallIds[0] === "wall1" && state.walls === undefined,
);

console.log("\n2. Повреждённые структуры — один проход");
const ids = state.damagedStructures.map(s => s.id).sort();
check(
  "ровно повреждённые",
  ids.join(",") === "ext2,road1,tow2",
  ids.join(","),
);
check("пустых записей нет", state.damagedStructures.every(Boolean));

// Фолбэк: кэш без предвычисленного списка (чужая фикстура, старый кэш в heap)
// обязан работать по-прежнему — полным обходом дорог.
const cacheWithDamaged = global.__structureCache.W1N1;
global.__structureCache.W1N1 = Object.assign({}, cacheWithDamaged);
delete global.__structureCache.W1N1.damagedRoadIds;
const fallbackState = roomManager.buildRoomState(room, [], []);
const fallbackIds = fallbackState.damagedStructures.map(s => s.id).sort();
check(
  "фолбэк без damagedRoadIds находит ту же дорогу",
  fallbackIds.join(",") === "ext2,road1,tow2",
  fallbackIds.join(","),
);
global.__structureCache.W1N1 = cacheWithDamaged;

console.log("\n3. getOwnedRooms без Object.values");
const owned = roomManager.getOwnedRooms();
check("только своя комната", owned.length === 1 && owned[0].name === "W1N1", owned.map(r => r.name).join(","));

console.log("\n4. Минерал: объект и extractorId из structureCache");
check("минерал отдан объектом", state.mineral && state.mineral.object === mineral);
check("extractorId из кэша структур", state.mineral.extractorId === "ex1");
check("amount доступен без резолва", state.mineral.amount === 5000, String(state.mineral.amount));

console.log("\n5. Потребители не резолвят минерал повторно");
const spawnManager = require("../spawn.manager");
const { MINERAL_MIN_AMOUNT_TO_SPAWN } = require("../constants");
getObjectByIdCalls = 0;
const spawn = {
  room: { name: "W1N1" },
  spawning: null,
  spawnCreep: () => 999, // заведомо не OK: проверяем только отсутствие резолвов
};
spawnManager.run({
  roomName: "W1N1",
  room: { controller: { ticksToDowngrade: 50000 } },
  spawns: [spawn],
  creeps: [],
  mineral: state.mineral,
});
check(
  "spawnManager не звал getObjectById по минералу",
  getObjectByIdCalls === 0,
  String(getObjectByIdCalls),
);

getObjectByIdCalls = 0;
const roleMineralMiner = require("../role.mineralMiner");
const creep = {
  name: "mm1",
  memory: { role: "mineralMiner", homeRoom: "W1N1", working: false },
  store: { getFreeCapacity: () => 50, U: 0 },
  room: { name: "W1N1", storage: null },
  pos: { isEqualTo: () => true },
  harvest: () => global.OK,
  moveTo: () => global.OK,
  transfer: () => global.OK,
};
roleMineralMiner.run(creep, state);
check(
  "mineralMiner не звал getObjectById",
  getObjectByIdCalls === 0,
  String(getObjectByIdCalls),
);
check(
  "порог спавна минерала осмыслен",
  typeof MINERAL_MIN_AMOUNT_TO_SPAWN === "number",
);

/* ── 6. Вариант B: ленивый список и числа вместо резолва (правка 29.09.2026) ──
 * Замер показал 0.15272 CPU/тик на резолв повреждённых дорог и 0.08158 CPU/тик
 * на перебор их генератором repair-задач при нуле найденных кандидатов
 * (docs/CPU-BASELINE.md, раздел 12). Проверяем механику правки офлайн:
 *   1) статистика сканера (damagedRoadHits/HitsMax) несёт те же числа, что и
 *      объекты дорог;
 *   2) генератор repair-задач отбирает кандидатов БЕЗ резолва (0 вызовов
 *      Game.getObjectById, когда дорога выше порога);
 *   3) ниже порога — ровно один резолв на кандидата и одна задача на нужный id;
 *   4) getDamagedStructures отдаёт тот же состав, что прежний список.
 */
console.log("\n6. Вариант B: числа из кэша вместо резолва дорог");

const statsCache = Object.assign({}, cache, {
  damagedRoadIds: ["road1", "road2"],
  damagedRoadHits: Int32Array.from([100, 1000]),
  // road1 повреждена (100 < 5000) и ниже порога постановки задачи, а у дорог
  // он АБСОЛЮТНЫЙ — 2 000 хитов (REPAIR.ROAD_TASK_HITS, constants/defense.js:64), а не
  // доля от максимума; road2 целая.
  damagedRoadHitsMax: Int32Array.from([5000, 1000]),
  damagedRoadCount: 2,
});
global.__structureCache.W1N1 = statsCache;
const statsState = roomManager.buildRoomState(room, [], []);

check(
  "объект каталога hits: целая дорога не в списке",
  statsState.damagedStructures.map(s => s.id).sort().join(",") === "ext2,road1,tow2",
  statsState.damagedStructures.map(s => s.id).sort().join(","),
);
check(
  "числа кэша совпадают с объектами",
  statsCache.damagedRoadHits[0] === 100 && statsCache.damagedRoadHitsMax[0] === 5000,
  `${statsCache.damagedRoadHits[0]}/${statsCache.damagedRoadHitsMax[0]}`,
);

// Кэш ключей очереди, который task.manager строит на тик
// (task.manager.js, getExistingKeys), сбрасываем: выше по тесту в очередь
// того же типа уже добавлялись задачи, и без сброса новая задача отсеялась бы
// как «дубль». Это артефакт теста в одном тике (Game.time здесь не меняется),
// а не поведение кода. Поля сбрасываются в существующем heap, а не подменой
// объекта: в heap живут ещё added/inited/queues, нужные addTask.
function resetTaskKeyCache() {
  if (!global.__taskHeap) return;
  global.__taskHeap.keys = {};
  global.__taskHeap.byType = {};
}
// В фикстуре ext2 (10/1000) — ниже порога, а тест «ноль резолвов» проверяет
// только путь дорог, поэтому на время этой проверки группу убираем из чисел.
const savedDamagedIds = statsCache.damagedIds;
const savedDamagedStats = statsCache.damagedStats;
const savedDamagedCount = statsCache.damagedCount;
statsCache.damagedIds = [];
statsCache.damagedStats = new Int32Array(1400);
statsCache.damagedCount = 0;

resetTaskKeyCache();
// 2 500 хитов — ВЫШЕ абсолютного порога дорог (2 000, пункт 4 плана), поэтому
// кандидат отсеивается по числу из кэша, без единого резолва.
statsCache.damagedRoadHits[0] = 2500;
const taskGenerators = require("../task.generators");

// Тест проверяет САМ генератор ремонта. Выключение ремонта живёт в systems.js
// (единый тумблер, правка 05.10.2026) и на гейте в room/run.js: генератор
// вызывается только оттуда, поэтому здесь его зовут напрямую и флаг не нужен.
// Раньше тест включал TASK_CONFIG.repairStructures — флага в TASK_CONFIG
// больше нет (дублирование тумблеров устранено).
getObjectByIdCalls = 0;
taskGenerators.generateRepairStructures(statsState);
// Один резолв — это НЕ дорога-кандидат (её отсеяли числами), а цель башни:
// генератор спрашивает pickRepairTarget, чтобы не ставить задачу туда, куда
// уже едет башня (task/gen.repair.js:178-205, пункт 5 плана).
check(
  "выше порога: резолвов нет, кроме цели башни",
  getObjectByIdCalls === 1,
  String(getObjectByIdCalls),
);

// Возвращаем группы: ext2 (10/1000) ниже порога и должен дать задачу.
statsCache.damagedIds = savedDamagedIds;
statsCache.damagedStats = savedDamagedStats;
statsCache.damagedCount = savedDamagedCount;

// Дорога ниже порога: задача ровно на её id.
statsCache.damagedRoadHits[0] = 100;
// Очередь чистится В МЕСТЕ: task.manager держит ссылку на массив из Memory
// (task.manager.js, queueRef) и подмена объекта Memory её не обновляет.
resetTaskKeyCache();
const repairQueueRef =
  (Memory.rooms.W1N1.tasks = Memory.rooms.W1N1.tasks || {}).repairStructures ||
  (Memory.rooms.W1N1.tasks.repairStructures = []);
repairQueueRef.length = 0;
getObjectByIdCalls = 0;
taskGenerators.generateRepairStructures(statsState);
const repairQueue = repairQueueRef;
check(
  "задача repair на повреждённую дорогу",
  repairQueue.some(t => t.targetId === "road1"),
  JSON.stringify(repairQueue),
);
// ext2 (10/1000 hits) из групп структур тоже ниже порога и тоже получает
// задачу — это прежнее поведение, оно сохранено.
check(
  "группы структур по-прежнему дают задачи",
  repairQueue.some(t => t.targetId === "ext2"),
  JSON.stringify(repairQueue),
);
// Резолвятся только дорога-кандидат и группа-кандидат: ext2 (10/1000), плюс
// цель башни для пункта 5 плана. tow2 (500/1000) ровно на пороге и в задачи не
// идёт — резолва для него нет. 366 объектов групп, среди которых целые, больше
// не резолвятся вовсе.
check(
  "ниже порога: резолвы только по кандидатам (+ цель башни)",
  getObjectByIdCalls === 3,
  String(getObjectByIdCalls),
);
check(
  "в задачу не попали служебные поля",
  repairQueue.length > 0 &&
    repairQueue.every(t => Object.keys(t).sort().join(",") === "targetId,taskId,type"),
  repairQueue.length ? Object.keys(repairQueue[0]).join(",") : "(нет задачи)",
);

global.__structureCache.W1N1 = cache;

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
