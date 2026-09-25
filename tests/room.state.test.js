"use strict";
/**
 * ===================================================
 * ROOM.STATE.TEST.JS — офлайн-проверка сборки roomState
 * ===================================================
 * buildRoomState оптимизирован без изменения поведения:
 *   1) группы структур разыменовываются по id из heap-кэша scanner одним
 *      циклом (resolveIds) вместо map(...).filter(Boolean) — без двух массивов
 *      и двух замыканий на группу;
 *   2) одиночные структуры (фабрика, PowerSpawn, обсервер, экстрактор, нюкер)
 *      разыменовываются напрямую, а не через [obj].filter(Boolean);
 *   3) storage и терминал разыменовываются РОВНО ОДИН РАЗ за тик (раньше —
 *      дважды: в списке на ремонт и в самом roomState);
 *   4) damagedStructures собирается одним проходом по группам без
 *      промежуточного allStructuresForRepair (шесть concat'ов) и без замыкания
 *      в filter;
 *   5) getOwnedRooms/buildAllRoomStates обходят Game.rooms и Game.creeps через
 *      for..in без промежуточных массивов Object.values(...);
 *   6) стены и валы по-прежнему НЕ разыменовываются (их читает только
 *      runTowerLogic раз в TOWER.WALL_SCAN_INTERVAL тиков по id из кэша).
 *
 * Замер на живом shard3 показал, что вариант «собирать группы одним
 * room.find(FIND_STRUCTURES)» ХУЖЕ (buildAllRoomStates 177 мкс, min из 20, и
 * профиль roomState не улучшился: 0.7265 -> 0.7549), поэтому от него отказались
 * — этот тест закрывает текущее поведение.
 *
 * Проверяем:
 *   1) состав и порядок групп (spawns/towers/links/labs/extensions/roads)
 *      совпадают с прежним алгоритмом по id-кэшу;
 *   2) порядок damagedStructures — как в прежней сборке concat + filter
 *      (спавны, башни, расширения, линки, лаборатории, дороги, затем фабрика,
 *      PowerSpawn, storage, терминал, обсервер, экстрактор, нюкер): от него
 *      зависит порядок создания задач на ремонт;
 *   3) одиночные структуры, storage/terminal, sources и spawn — те же объекты;
 *   4) инварианты разыменования: каждый нужный id запрошен ровно один раз,
 *      стены/валы/контейнеры и чужие структуры не запрашиваются вообще;
 *   5) внешний интерфейс roomState — тот же набор полей;
 *   6) группировка крипов в buildAllRoomStates (for..in вместо
 *      Object.values) сохраняет прежнее правило «homeRoom или текущая комната».
 *
 * Запуск: node tests/room.state.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Разрешение bare-require в стиле Screeps (как в игре: от корня проекта) ──
const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Глобалы Screeps ──────────────────────────────────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_TARGET = -7;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_H = "H";
global.RESOURCE_O = "O";

global.FIND_STRUCTURES = 1;
global.FIND_MY_STRUCTURES = 2;
global.FIND_SOURCES = 3;

global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "constructedWall";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_CONTAINER = "container";
global.STRUCTURE_STORAGE = "storage";
global.STRUCTURE_TERMINAL = "terminal";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";

// Счётчики обращений к движку: сколько раз запрошен каждый id и сколько всего.
const objectsById = {};
const callCount = {};
let getObjectByIdCalls = 0;

global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  getObjectById: id => {
    getObjectByIdCalls++;
    callCount[id] = (callCount[id] || 0) + 1;
    return objectsById[id] || null;
  },
};
global.Memory = { rooms: {}, creeps: {} };

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

// Профилирование в тесте не нужно — нейтрализуем обёртки замера CPU.
const cpuMonitor = require("../cpuMonitor");
cpuMonitor.trackRole = (label, fn) => fn();

const roomManager = require("../room.manager");

// ── Синтетическая комната ────────────────────────────────────────────────
let nextId = 0;
function makeStructure(type, opts) {
  const id = `${type}#${nextId++}`;
  const o = opts || {};
  const s = {
    id,
    structureType: type,
    my: o.my !== false,
    hits: o.hits === undefined ? 1000 : o.hits,
    hitsMax: o.hitsMax === undefined ? 1000 : o.hitsMax,
  };
  objectsById[id] = s;
  return s;
}

const foreignTower = makeStructure(STRUCTURE_TOWER, { my: false });
const foreignSpawn = makeStructure(STRUCTURE_SPAWN, { my: false });
const foreignRoad = makeStructure(STRUCTURE_ROAD, { my: false });
const enemyWall = makeStructure(STRUCTURE_WALL, { my: false, hits: 5 });

const spawns = [
  makeStructure(STRUCTURE_SPAWN, { hits: 900, hitsMax: 1000 }), // повреждён
  makeStructure(STRUCTURE_SPAWN),
];
const towers = [makeStructure(STRUCTURE_TOWER), makeStructure(STRUCTURE_TOWER)];
const links = [
  makeStructure(STRUCTURE_LINK),
  makeStructure(STRUCTURE_LINK, { hits: 500, hitsMax: 1000 }), // повреждён
];
const labs = [makeStructure(STRUCTURE_LAB), makeStructure(STRUCTURE_LAB)];
const extensions = [
  makeStructure(STRUCTURE_EXTENSION),
  makeStructure(STRUCTURE_EXTENSION, { hits: 100, hitsMax: 200 }), // повреждено
  makeStructure(STRUCTURE_EXTENSION),
];
const myRoads = [
  makeStructure(STRUCTURE_ROAD, { hits: 50, hitsMax: 5000 }), // повреждена
  makeStructure(STRUCTURE_ROAD),
];
const factory = makeStructure(STRUCTURE_FACTORY);
const powerSpawn = makeStructure(STRUCTURE_POWER_SPAWN);
const observer = makeStructure(STRUCTURE_OBSERVER);
const extractor = makeStructure(STRUCTURE_EXTRACTOR);
const nuker = makeStructure(STRUCTURE_NUKER);
const storage = makeStructure(STRUCTURE_STORAGE, { hits: 900, hitsMax: 1000 });
const terminal = makeStructure(STRUCTURE_TERMINAL);
const walls = [makeStructure(STRUCTURE_WALL), makeStructure(STRUCTURE_WALL)];
const ramparts = [makeStructure(STRUCTURE_RAMPART)];
const container = makeStructure(STRUCTURE_CONTAINER);
const sources = [{ id: "source#1" }, { id: "source#2" }];
for (const s of sources) objectsById[s.id] = s;

// Порядок, в котором движок отдаёт структуры комнаты (вперемешку по типам):
// кэш scanner строится по этому же списку, как в scanner.js.
const roomStructures = [
  foreignTower,
  myRoads[0],
  spawns[0],
  extensions[0],
  enemyWall,
  towers[0],
  container,
  links[1],
  walls[0],
  labs[0],
  foreignRoad,
  spawns[1],
  extensions[1],
  factory,
  myRoads[1],
  towers[1],
  links[0],
  ramparts[0],
  labs[1],
  powerSpawn,
  foreignSpawn,
  extensions[2],
  observer,
  extractor,
  nuker,
  storage,
  terminal,
  walls[1],
];

const room = {
  name: "R",
  controller: { id: "controller#1", my: true, level: 8 },
  storage,
  terminal,
  memory: {},
  find: type => {
    if (type === FIND_STRUCTURES) return roomStructures.slice();
    if (type === FIND_SOURCES) return sources.slice();
    return [];
  },
};

// mineral-состояние комнаты отключаем через heap-кэш (у фейкового источника
// нет pos), иначе buildMineralState попытается пересобрать кэш.
global._mineralCache = { R: { none: true } };

// ── 1. Прежний алгоритм (эталон) на том же наборе структур ───────────────
// Дословный повтор кода, который был в buildRoomState до оптимизации.
function buildReferenceState() {
  const cache = {
    _updatedAt: Game.time, // свежий кэш: ensureStructureCache не будет пересобирать
    spawnIds: [],
    towerIds: [],
    linkIds: [],
    labIds: [],
    extensionIds: [],
    roadIds: [],
    wallIds: [],
    rampartIds: [],
    factoryId: null,
    powerSpawnId: null,
    invaderCoreId: null,
    observerId: null,
    extractorId: null,
    nukerId: null,
    storageId: storage.id,
    terminalId: terminal.id,
    sourceIds: sources.map(s => s.id),
    sourcePositions: [],
    mineralId: null,
  };
  for (const s of roomStructures) {
    switch (s.structureType) {
      case STRUCTURE_SPAWN:
        if (s.my) cache.spawnIds.push(s.id);
        break;
      case STRUCTURE_TOWER:
        if (s.my) cache.towerIds.push(s.id);
        break;
      case STRUCTURE_LINK:
        if (s.my) cache.linkIds.push(s.id);
        break;
      case STRUCTURE_LAB:
        if (s.my) cache.labIds.push(s.id);
        break;
      case STRUCTURE_EXTENSION:
        if (s.my) cache.extensionIds.push(s.id);
        break;
      case STRUCTURE_ROAD:
        cache.roadIds.push(s.id);
        break;
      case STRUCTURE_FACTORY:
        if (s.my) cache.factoryId = s.id;
        break;
      case STRUCTURE_POWER_SPAWN:
        if (s.my) cache.powerSpawnId = s.id;
        break;
      case STRUCTURE_OBSERVER:
        if (s.my) cache.observerId = s.id;
        break;
      case STRUCTURE_EXTRACTOR:
        if (s.my) cache.extractorId = s.id;
        break;
      case STRUCTURE_NUKER:
        if (s.my) cache.nukerId = s.id;
        break;
    }
  }
  global._structureCache = { R: cache };
  global._mineralCache = { R: { none: true } };

  const grouped = {
    spawns: cache.spawnIds.map(id => Game.getObjectById(id)).filter(Boolean),
    towers: cache.towerIds.map(id => Game.getObjectById(id)).filter(Boolean),
    links: cache.linkIds.map(id => Game.getObjectById(id)).filter(Boolean),
    labs: cache.labIds.map(id => Game.getObjectById(id)).filter(Boolean),
    extensions: cache.extensionIds
      .map(id => Game.getObjectById(id))
      .filter(Boolean),
    roads: cache.roadIds.map(id => Game.getObjectById(id)).filter(Boolean),
    factories: cache.factoryId
      ? [Game.getObjectById(cache.factoryId)].filter(Boolean)
      : [],
    powerSpawns: cache.powerSpawnId
      ? [Game.getObjectById(cache.powerSpawnId)].filter(Boolean)
      : [],
    observers: cache.observerId
      ? [Game.getObjectById(cache.observerId)].filter(Boolean)
      : [],
    extractors: cache.extractorId
      ? [Game.getObjectById(cache.extractorId)].filter(Boolean)
      : [],
    nukers: cache.nukerId
      ? [Game.getObjectById(cache.nukerId)].filter(Boolean)
      : [],
  };

  const allStructuresForRepair = []
    .concat(grouped.spawns)
    .concat(grouped.towers)
    .concat(grouped.extensions)
    .concat(grouped.links)
    .concat(grouped.labs)
    .concat(grouped.roads);

  if (grouped.factories[0]) allStructuresForRepair.push(grouped.factories[0]);
  if (grouped.powerSpawns[0])
    allStructuresForRepair.push(grouped.powerSpawns[0]);
  if (cache.storageId) {
    const s = Game.getObjectById(cache.storageId);
    if (s) allStructuresForRepair.push(s);
  }
  if (cache.terminalId) {
    const t = Game.getObjectById(cache.terminalId);
    if (t) allStructuresForRepair.push(t);
  }
  if (grouped.observers[0]) allStructuresForRepair.push(grouped.observers[0]);
  if (grouped.extractors[0]) allStructuresForRepair.push(grouped.extractors[0]);
  if (grouped.nukers[0]) allStructuresForRepair.push(grouped.nukers[0]);

  const damagedStructures = allStructuresForRepair.filter(
    s => s.hits < s.hitsMax,
  );
  const refSources = cache.sourceIds
    .map(id => Game.getObjectById(id))
    .filter(Boolean);

  return {
    spawns: grouped.spawns,
    towers: grouped.towers,
    links: grouped.links,
    labs: grouped.labs,
    extensions: grouped.extensions,
    roads: grouped.roads,
    damagedStructures,
    sources: refSources,
    spawn: grouped.spawns[0] || null,
    factory: grouped.factories[0] || null,
    powerSpawn: grouped.powerSpawns[0] || null,
    observer: grouped.observers[0] || null,
    extractor: grouped.extractors[0] || null,
    nuker: grouped.nukers[0] || null,
  };
}

const ids = list => list.map(x => (x && x.id) || String(x)).join(",");
const names = list => list.map(c => c.name).join(",");

// ── 2. Новый buildRoomState ──────────────────────────────────────────────
console.log("\n1. roomState совпадает с прежним алгоритмом");

const reference = buildReferenceState();
getObjectByIdCalls = 0;
for (const k of Object.keys(callCount)) delete callCount[k];
const state = roomManager.buildRoomState(room, []);
const callsDuringBuild = getObjectByIdCalls;

check("spawns: состав и порядок", ids(state.spawns) === ids(reference.spawns), ids(state.spawns));
check("towers: состав и порядок", ids(state.towers) === ids(reference.towers), ids(state.towers));
check("links: состав и порядок", ids(state.links) === ids(reference.links), ids(state.links));
check("labs: состав и порядок", ids(state.labs) === ids(reference.labs), ids(state.labs));
check(
  "extensions: состав и порядок",
  ids(state.extensions) === ids(reference.extensions),
  ids(state.extensions),
);
check("roads: состав и порядок", ids(state.roads) === ids(reference.roads), ids(state.roads));
check(
  "damagedStructures: состав и порядок (порядок задач ремонта)",
  ids(state.damagedStructures) === ids(reference.damagedStructures),
  `${ids(state.damagedStructures)} != ${ids(reference.damagedStructures)}`,
);
check("sources: те же объекты", ids(state.sources) === ids(reference.sources), ids(state.sources));
check("spawn: первый спавн", state.spawn === reference.spawn, String(state.spawn && state.spawn.id));
check("factory", state.factory === reference.factory);
check("powerSpawn", state.powerSpawn === reference.powerSpawn);
check("observer", state.observer === reference.observer);
check("extractor", state.extractor === reference.extractor);
check("nuker", state.nuker === reference.nuker);
check("storage: тот же объект", state.storage === storage);
check("terminal: тот же объект", state.terminal === terminal);
check("controller: тот же объект", state.controller === room.controller);
check("room/roomName", state.room === room && state.roomName === "R");
check("mineral: null (в комнате нет минерала)", state.mineral === null);
check(
  "damagedStructures: только реально повреждённые",
  state.damagedStructures.every(s => s.hits < s.hitsMax),
);
check(
  "damagedStructures: порядок групп соблюдён (спавн раньше дороги)",
  state.damagedStructures.indexOf(spawns[0]) <
    state.damagedStructures.indexOf(myRoads[0]),
);

// ── 3. Инварианты разыменования ──────────────────────────────────────────
console.log("\n2. Инварианты разыменования id");

const onceEach = (list, label) =>
  check(
    `${label}: каждый id запрошен ровно один раз`,
    list.every(s => callCount[s.id] === 1),
    JSON.stringify(list.map(s => callCount[s.id])),
  );
onceEach(state.spawns, "spawns");
onceEach(state.towers, "towers");
onceEach(state.links, "links");
onceEach(state.labs, "labs");
onceEach(state.extensions, "extensions");
onceEach(state.roads, "roads");
onceEach(state.sources, "sources");

check(
  "storage разыменован ровно один раз за тик (было дважды)",
  callCount[storage.id] === 1,
  String(callCount[storage.id]),
);
check(
  "terminal разыменован ровно один раз за тик (было дважды)",
  callCount[terminal.id] === 1,
  String(callCount[terminal.id]),
);
check(
  "стены, валы, контейнеры и чужие структуры по id не запрашиваются",
  [enemyWall, walls[0], walls[1], ramparts[0], container, foreignTower, foreignSpawn].every(
    s => callCount[s.id] === undefined,
  ),
);
check(
  "чужая дорога попала в roads (как FIND_STRUCTURES + фильтр по типу)",
  state.roads.indexOf(foreignRoad) !== -1 && callCount[foreignRoad.id] === 1,
);
check(
  "чужие структуры не попали в свои группы",
  [foreignSpawn, foreignTower].every(
    s =>
      state.spawns.indexOf(s) === -1 &&
      state.towers.indexOf(s) === -1 &&
      state.damagedStructures.indexOf(s) === -1,
  ),
);

const expectedCalls =
  state.spawns.length +
  state.towers.length +
  state.links.length +
  state.labs.length +
  state.extensions.length +
  state.roads.length +
  state.sources.length +
  7; // factory, powerSpawn, observer, extractor, nuker, storage, terminal
check(
  "всего обращений к Game.getObjectById = сумме нужных структур",
  callsDuringBuild === expectedCalls,
  `${callsDuringBuild} != ${expectedCalls}`,
);

// ── 4. Интерфейс roomState ───────────────────────────────────────────────
console.log("\n3. Внешний интерфейс roomState не изменён");

const expectedKeys = [
  "room",
  "roomName",
  "spawn",
  "spawns",
  "controller",
  "storage",
  "terminal",
  "towers",
  "extensions",
  "roads",
  "damagedStructures",
  "creeps",
  "sources",
  "links",
  "labs",
  "factory",
  "powerSpawn",
  "observer",
  "extractor",
  "nuker",
  "mineral",
].sort();
const actualKeys = Object.keys(state).sort();
check(
  "набор полей тот же",
  actualKeys.join(",") === expectedKeys.join(","),
  actualKeys.join(","),
);

// ── 5. Группировка крипов в buildAllRoomStates ───────────────────────────
console.log("\n4. Группировка крипов по комнатам");

function makeCreep(name, homeRoom, currentRoom) {
  return {
    name,
    memory: { homeRoom },
    room: { name: currentRoom },
  };
}

const homeOnly = makeCreep("homeOnly", "R", "R");
const remote = makeCreep("remote", "R", "W1N1"); // ушёл в ремоут
const foreignInRoom = makeCreep("foreignInRoom", "R2", "R"); // гость в комнате
const other = makeCreep("other", "R2", "R2"); // чужая комната, не наш крип
Game.creeps = { homeOnly, remote, foreignInRoom, other };
Game.rooms = { R: room };

const states = roomManager.buildAllRoomStates();
check("собрано состояние одной своей комнаты", states.length === 1, String(states.length));
const creeps = states[0].creeps;
check("крип с homeRoom == R попал в список", creeps.indexOf(homeOnly) !== -1);
check("крип в remote-комнате попал в список по homeRoom", creeps.indexOf(remote) !== -1);
check("крип-гость попал в список по текущей комнате", creeps.indexOf(foreignInRoom) !== -1);
check("чужой крип не попал", creeps.indexOf(other) === -1);
// homeOnly физически в R и homeRoom == R: попадает ровно один раз (как раньше,
// потому что второй push идёт только при currentRoom !== homeRoom).
check(
  "крип не дублируется, когда homeRoom == текущая комната",
  creeps.filter(c => c === homeOnly).length === 1,
  String(creeps.filter(c => c === homeOnly).length),
);
check(
  "порядок крипов = порядок Game.creeps",
  names(creeps) === "homeOnly,remote,foreignInRoom",
  names(creeps),
);

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
