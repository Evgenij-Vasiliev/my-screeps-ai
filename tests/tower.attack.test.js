"use strict";
/**
 * ===================================================
 * TOWER.ATTACK.TEST.JS — офлайн-проверка детектора атаки и ленивых стен
 * ===================================================
 * Задание 7 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) стены и валы резолвятся ЛЕНИВО: в обычный тик Game.getObjectById
 *      по ним не вызывается вообще (объекты не нужны — башни не ремонтируют);
 *   2) в тик ремонта они резолвятся, и ровно один раз (мемоизация на тик);
 *   3) враждебные крипы ищутся дешёвым room.find каждый тик;
 *   4) дорогой обход hits выполняется только раз в HOSTILE_CHECK_INTERVAL;
 *   5) атака обнаруживается сразу по крипам, без ожидания обхода стен;
 *   6) Memory.towerState больше не создаётся.
 *
 * Запуск: node tests/tower.attack.test.js
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
global.OK = 0;
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

const { TOWER } = require("../constants");
const scanner = require("../scanner");

global.Memory = { rooms: {} };
global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  spawns: {},
  constructionSites: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};

const WALL_COUNT = 120;
const RAMPART_COUNT = 80;

/* ── Тик ремонта башен — СВОЙ у каждой комнаты (room.manager.isTowerRepairTick) ──
 * Условие `(Game.time + фаза) % TOWER.REPAIR_INTERVAL === 0`, фаза — хэш имени
 * комнаты. Тест считает тики от фазы, иначе он проверял бы прежнее, общее для
 * всей империи условие `Game.time % 15 === 0`.
 *
 * Правка пункта 1 плана (docs/REPAIR-PLAN.md:158): REPAIR_INTERVAL = 1, то есть
 * ремонт идёт КАЖДЫЙ тик. Тогда фаза вырождается (`x % 1 === 0`) и тика БЕЗ
 * ремонта не существует вовсе. Тест поддерживает оба режима: EVERY_TICK_REPAIR
 * меняет только те ожидания, которые зависят от наличия неремонтного тика. */
const EVERY_TICK_REPAIR = TOWER.REPAIR_INTERVAL === 1;
const PHASE = scanner.rebuildStagger("W1N1") % TOWER.REPAIR_INTERVAL;
function isRepairTick(t) {
  return (t + PHASE) % TOWER.REPAIR_INTERVAL === 0;
}
/** Ближайший тик ремонта, начиная с from. */
function repairTick(from) {
  let t = from;
  while (!isRepairTick(t)) t++;
  return t;
}
/** Тик БЕЗ ремонта (существует только при интервале > 1) и без проверки атаки. */
function plainTick(from) {
  let t = from;
  // При REPAIR_INTERVAL = 1 неремонтных тиков нет: без этой оговорки цикл
  // не завершился бы никогда (isRepairTick истинно на каждом тике).
  while ((!EVERY_TICK_REPAIR && isRepairTick(t)) || t % TOWER.HOSTILE_CHECK_INTERVAL === 0) t++;
  return t;
}
/** Тик проверки атаки (кратный 100); при интервале > 1 — ещё и без ремонта. */
function hostileCheckTick(from) {
  let t = from;
  while (t % TOWER.HOSTILE_CHECK_INTERVAL !== 0 || (!EVERY_TICK_REPAIR && isRepairTick(t))) t++;
  return t;
}
const CHECK_TICK = hostileCheckTick(TOWER.HOSTILE_CHECK_INTERVAL * 3);

let idLookups = 0;
let wallLookups = 0;
let rampartLookups = 0;
let hostileFinds = 0;
let hitsReads = 0;
/** Чтения hits раздельно: стены и валы — разные статьи расхода. */
let wallHitsReads = 0;
let rampartHitsReads = 0;
let hostiles = [];

const wallObjects = {};
for (let i = 0; i < WALL_COUNT + RAMPART_COUNT; i++) {
  const isWall = i < WALL_COUNT;
  // id должны совпадать с теми, что попадают в кэш: w0..w119 и r0..r79.
  const id = isWall ? "w" + i : "r" + (i - WALL_COUNT);
  const obj = {
    id,
    _hits: 1000,
    hitsMax: 1000000,
    structureType: isWall ? "wall" : "rampart",
  };
  // _hits, а не hits: значение должно быть изменяемым для проверок 8-го блока,
  // а getter считает чтения (по ним проверяется, что стены не обходят вовсе).
  Object.defineProperty(obj, "hits", {
    get() {
      hitsReads++;
      if (isWall) wallHitsReads++;
      else rampartHitsReads++;
      return obj._hits;
    },
  });
  wallObjects[id] = obj;
}

/** Дороги для проверок выбора цели (в кэш идут только их id и числа). */
const roadObjects = {};

let towerRepairs = 0;
let tower2Repairs = 0;

const tower = {
  id: "t1",
  store: { energy: 1000 },
  pos: { findClosestByRange: list => list[0], getRangeTo: () => 3 },
  attack: () => global.OK,
  repair: () => {
    towerRepairs++;
    return global.OK;
  },
  heal: () => global.OK,
};

const tower2 = {
  id: "t2",
  store: { energy: 1000 },
  pos: { findClosestByRange: list => list[0], getRangeTo: () => 9 },
  attack: () => global.OK,
  repair: () => {
    tower2Repairs++;
    return global.OK;
  },
  heal: () => global.OK,
};

function makeRoom(name) {
  const cache = {
    // Схема 3 (29.09.2026): добавлены числа повреждённых структур.
    v: 3,
    updatedAt: global.Game.time,
    controllerLevel: 4,
    spawnIds: [],
    towerIds: ["t1"],
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
  for (let i = 0; i < WALL_COUNT; i++) cache.wallIds.push("w" + i);
  for (let i = 0; i < RAMPART_COUNT; i++) cache.rampartIds.push("r" + i);

  global.__structureCache = global.__structureCache || {};
  global.__structureCache[name] = cache;

  Memory.rooms[name] = Memory.rooms[name] || {};
  Memory.rooms[name].tasks = {};
  Memory.rooms[name].links = null;

  const room = {
    name,
    controller: { my: true, id: "c_" + name, level: 4, ticksToDowngrade: 100000 },
    memory: Memory.rooms[name],
    storage: null,
    terminal: null,
    find(kind) {
      if (kind === global.FIND_HOSTILE_CREEPS) {
        hostileFinds++;
        return hostiles;
      }
      return [];
    },
  };
  room.find = room.find.bind(room);
  return room;
}

global.Game.getObjectById = id => {
  if (id === "t1") return tower;
  if (id === "t2") return tower2;
  if (roadObjects[id]) return roadObjects[id];
  const o = wallObjects[id];
  if (o) {
    idLookups++;
    if (o.structureType === "wall") wallLookups++;
    else rampartLookups++;
    return o;
  }
  return null;
};

const roomManager = require("../room.manager");
const room = makeRoom("W1N1");
global.Game.rooms.W1N1 = room;

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

function buildState() {
  global.__structureCache.W1N1.updatedAt = global.Game.time;
  return roomManager.buildRoomState(room, [], []);
}

console.log("1. Обычный тик: стены не резолвятся");
idLookups = 0;
wallLookups = 0;
rampartLookups = 0;
hitsReads = 0;
wallHitsReads = 0;
rampartHitsReads = 0;
hostileFinds = 0;
global.Game.time = plainTick(1001); // не тик проверки атаки; тик ремонта — если интервал 1
roomManager.runTowerLogic(buildState());
check(
  "Game.getObjectById по стенам не вызывался",
  wallLookups === 0,
  `стены ${wallLookups}, валы ${rampartLookups}`,
);
if (EVERY_TICK_REPAIR) {
  // При интервале 1 этот тик — тик ремонта, поэтому валы резолвятся и их hits
  // читаются (pickRepairTarget). Это ожидаемая цена правки
  // (docs/REPAIR-PLAN.md:158), а не регресс; важно, что СТЕН в проходе нет.
  check(
    "резолвятся только валы (цель ремонта), и ровно один раз",
    idLookups === rampartLookups && rampartLookups === RAMPART_COUNT,
    `id ${idLookups}, валы ${rampartLookups}`,
  );
  check(
    "hits читаются только у валов, у стен — нет",
    wallHitsReads === 0 && rampartHitsReads >= RAMPART_COUNT,
    `стены ${wallHitsReads}, валы ${rampartHitsReads}`,
  );
} else {
  check("hits стен не читались", hitsReads === 0, String(hitsReads));
}
check(
  "враждебные ищутся дешёвым room.find",
  hostileFinds === 1,
  String(hostileFinds),
);

console.log("\n2. Тик ремонта: СТЕНЫ не резолвятся вовсе, валы — один раз");
idLookups = 0;
wallLookups = 0;
rampartLookups = 0;
hitsReads = 0;
global.Game.time = repairTick(1005); // тик ремонта ЭТОЙ комнаты (фаза по имени)
// REPAIR_INTERVAL = 15, HOSTILE_CHECK_INTERVAL = 100 — выбран не кратный 100
const repairState = buildState();
roomManager.runTowerLogic(repairState);
check(
  "стены не резолвятся (ремонт стен убран: они не распадаются)",
  wallLookups === 0,
  String(wallLookups),
);
check(
  "валы резолвятся ровно один раз",
  rampartLookups === RAMPART_COUNT,
  String(rampartLookups),
);
check(
  "мемоизация на тик: повторный проход не резолвит снова",
  (() => {
    const before = idLookups;
    roomManager.runTowerLogic(repairState);
    return idLookups === before;
  })(),
  String(idLookups),
);

console.log("\n3. Тик проверки атаки: hits читаются, но не каждый тик");
global.Game.time = CHECK_TICK; // тик проверки атаки (и не тик ремонта)
hitsReads = 0;
idLookups = 0;
roomManager.runTowerLogic(buildState());
check("обход hits выполнен на тике проверки", hitsReads > 0, String(hitsReads));

global.Game.time = plainTick(CHECK_TICK + 1); // не тик проверки атаки
hitsReads = 0;
wallHitsReads = 0;
rampartHitsReads = 0;
roomManager.runTowerLogic(buildState());
// Обхода СТЕН нет ни в одном режиме. При интервале 1 этот тик — ещё и тик
// ремонта, поэтому читаются hits валов (цель ремонта в этом стенде).
check(
  EVERY_TICK_REPAIR
    ? "тик ремонта: hits валов читаются, стен — нет"
    : "на обычном тике обхода hits нет",
  EVERY_TICK_REPAIR
    ? rampartHitsReads >= RAMPART_COUNT && wallHitsReads === 0
    : hitsReads === 0,
  `стены ${wallHitsReads}, валы ${rampartHitsReads}`,
);

console.log("\n4. Атака обнаруживается сразу по крипам");
hostiles = [{ id: "h1", hits: 100, hitsMax: 100 }];
global.Game.time = plainTick(1002); // не тик проверки атаки — обход стен не поможет
let attacked = 0;
tower.attack = () => {
  attacked++;
  return global.OK;
};
roomManager.runTowerLogic(buildState());
check("башня атаковала в тот же тик", attacked === 1, String(attacked));
check(
  "флаг атаки записан в Memory",
  Memory.rooms.W1N1.underAttack === true,
  String(Memory.rooms.W1N1.underAttack),
);
hostiles = [];

console.log("\n5. Memory.towerState не создаётся");
// Флаг атаки снят, но ключ towerState не должен появиться ни при каком раскладе.
global.Game.time = plainTick(1003);
roomManager.runTowerLogic(buildState());
check("Memory.towerState отсутствует", Memory.towerState === undefined);

console.log("\n6. Мирное время: флаг атаки снят");
check(
  "underAttack = false",
  Memory.rooms.W1N1.underAttack === false,
  String(Memory.rooms.W1N1.underAttack),
);

console.log("\n7. Тик ремонта башен");
// Правка 29.09.2026: условие ремонта стало ПОКОМНАТНЫМ
// ((Game.time + фаза имени комнаты) % TOWER.REPAIR_INTERVAL === 0).
// Раньше все 16 башен империи били в один тик — 4.5031 CPU в этом тике.
// Правка пункта 1 плана (docs/REPAIR-PLAN.md:158): интервал 1 — ремонт идёт
// каждый тик, фазовый разнос вырождается (см. EVERY_TICK_REPAIR выше).
const REAL_ROOMS = ["E35S37", "E35S39", "E37S37", "E37S38", "E36S38"];

// (а) В любом окне TOWER.REPAIR_INTERVAL тиков у комнаты ровно один тик ремонта.
//     При интервале 1 окно — это один тик, и он же тик ремонта.
let exactlyOne = true;
for (const name of REAL_ROOMS) {
  for (let from = 1000; from < 1000 + TOWER.REPAIR_INTERVAL; from++) {
    let n = 0;
    for (let k = 0; k < TOWER.REPAIR_INTERVAL; k++) {
      global.Game.time = from + k;
      if (roomManager.isTowerRepairTick(name)) n++;
    }
    if (n !== 1) exactlyOne = false;
  }
}
check(
  `в любом окне ${TOWER.REPAIR_INTERVAL} тиков у комнаты ровно один тик ремонта`,
  exactlyOne,
);

// (б) При интервале > 1 комнаты ремонтируют в РАЗНЫЕ тики (разнос фазой);
//     при интервале 1 разноса нет по построению — ремонтируют все комнаты.
global.Game.time = 1015;
const repairing = REAL_ROOMS.filter(n => roomManager.isTowerRepairTick(n));
check(
  EVERY_TICK_REPAIR
    ? "при интервале 1 ремонтируют все комнаты (разнос фазой вырожден)"
    : "в одном тике ремонтируют не все комнаты империи",
  EVERY_TICK_REPAIR
    ? repairing.length === REAL_ROOMS.length
    : repairing.length < REAL_ROOMS.length,
  `ремонтируют ${repairing.length} из ${REAL_ROOMS.length}`,
);

// (в) Поведение башни не изменилось: за окно TOWER.REPAIR_INTERVAL тиков ровно
//     один ремонт (окно начинается с тика ремонта, поэтому при интервале 1 это
//     ровно один тик), и бьёт только ОДНА башня — ближайшая к цели.
const cache7 = global.__structureCache.W1N1;
cache7.towerIds = ["t1", "t2"];
towerRepairs = 0;
tower2Repairs = 0;
for (let k = 0; k < TOWER.REPAIR_INTERVAL; k++) {
  global.Game.time = 1010 + k;
  roomManager.runTowerLogic(buildState());
}
check(
  `за ${TOWER.REPAIR_INTERVAL} тиков башня ремонтировала ровно один раз`,
  towerRepairs === 1,
  String(towerRepairs),
);
check(
  "бьёт только ближайшая башня (у дальней — ноль интентов)",
  tower2Repairs === 0,
  String(tower2Repairs),
);

console.log("\n8. Цель ремонта: доля потерянных хитов, а не абсолют");
// Вал почти цел (0.1 % потерь), дорога повреждена на 60 % — цель дорога.
// Абсолютный дефицит у вала при этом БОЛЬШЕ (1 000 против 3 000 хитов у дороги
// по доле, но 1 000 у вала против 3 000 у дороги — оба ≥ действия башни):
// именно поэтому правило считает ДОЛЮ, а не абсолют.
const cache8 = global.__structureCache.W1N1;
// Все валы комнаты — почти целые (0.1 % потерь): иначе именно они выиграли бы
// у дороги по доле, ведь в стенде у них hits 1000 из 1000000.
for (const id in wallObjects) {
  if (wallObjects[id].structureType === "rampart") wallObjects[id]._hits = 999000;
}
// 2 000 из 5 000 — НИЖЕ линии синхронизации с воркером (REPAIR.ROAD_DONE_HITS
// = 3 000, constants/defense.js), поэтому дорога вообще может стать целью.
roadObjects["road1"] = { id: "road1", hits: 2000, hitsMax: 5000 }; // 60 % потерь
cache8.damagedRoadIds = ["road1"];
cache8.damagedRoadHits[0] = 2000;
cache8.damagedRoadHitsMax[0] = 5000;

towerRepairs = 0;
tower2Repairs = 0;
let repairedTargetId = null;
tower.repair = target => {
  towerRepairs++;
  repairedTargetId = target && target.id;
  return global.OK;
};
global.Game.time = repairTick(1100);
roomManager.runTowerLogic(buildState());
check("цель — повреждённая дорога, а не почти целый вал", repairedTargetId === "road1", String(repairedTargetId));

// СИНХРОНИЗАЦИЯ С ВОРКЕРОМ: дорога на линии «отремонтировано» (3 000) и выше
// целью башни не становится — это ровно тот порог, на котором воркер закрывает
// задачу (task/exec.repair.js, isDoneRepair). Без него башня гнала болотную
// дорогу (25 000) до максимума, пока воркер считал её сделанной.
roadObjects["road1"].hits = 3000;
cache8.damagedRoadHits[0] = 3000;
towerRepairs = 0;
repairedTargetId = null;
global.Game.time = repairTick(1110);
roomManager.runTowerLogic(buildState());
check(
  "дорога на линии 3 000 целью башни не становится",
  repairedTargetId !== "road1",
  String(repairedTargetId),
);

// Дефицит меньше одного действия не чинится: движок обрезал бы хиты по
// hitsMax, и 10 энергии ушли бы в 1 хит. На дороге это правило теперь не
// проверить (её отсекает линия синхронизации), поэтому проверяем на ВАЛАХ.
roadObjects["road1"].hits = 4500;
cache8.damagedRoadHits[0] = 4500;
for (const id in wallObjects) {
  if (wallObjects[id].structureType === "rampart") wallObjects[id]._hits = 999999;
}
towerRepairs = 0;
global.Game.time = repairTick(1120);
roomManager.runTowerLogic(buildState());
check(
  "почти целые цели не ремонтируются (дефицит меньше действия)",
  towerRepairs === 0,
  String(towerRepairs),
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
