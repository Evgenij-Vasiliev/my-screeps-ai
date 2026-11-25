"use strict";
/**
 * ===================================================
 * REMOTE.ROLES.TEST.JS — поведение трёх дальних ролей
 * ===================================================
 * Проверяем ровно то, что заявлено в ТЗ блока дальней добычи:
 *
 *   reserver:
 *     1) targetRoom = null → роль не делает НИЧЕГО;
 *     2) рядом с контроллером → reserveController КАЖДЫЙ тик (2 CLAIM = +2 тика);
 *     3) вне комнаты → travelTo к запомненной позиции контроллера, иначе (25,25);
 *     4) свой контроллер не резервируется;
 *     5) позиция контроллера не переписывается, если не изменилась.
 *
 *   remoteMiner:
 *     6) targetRoom = null → ничего;
 *     7) вне комнаты → travelTo к известной рабочей цели (контейнер из памяти);
 *     8) контейнера и площадки нет → createConstructionSite ОДИН раз в
 *        настроенную клетку REMOTE.ROOM_TO_CONTAINER_POS;
 *     9) площадка есть и крип с энергией → build;
 *    10) контейнер есть → стоит НА нём, harvest пачкой (интервал от ёмкости);
 *    11) пачка не влезает в рюкзак → transfer в контейнер;
 *    12) контейнер повреждён (< 50 %) → repair своей энергией;
 *    13) пересчёт интервала при смене ёмкости источника (1500 → 3000).
 *
 *   remoteHauler:
 *    14) targetRoom = null → ничего;
 *    15) вне нужной комнаты → travelTo сразу к настоящей цели рейса;
 *    16) сбор из контейнера в isNearTo;
 *    17) доставка в линк-приёмник, когда в нём есть место;
 *    18) линк полон → fallback storage;
 *    19) пусто вокруг → ждёт у источника, поиск не каждый тик.
 *
 * Моки — обычные объекты без фреймворка (стиль tests/spawn.count.test.js).
 * Запуск: node tests/remote.roles.test.js
 */

/* ── Шим разрешения модулей (как на шарде: require("role.remoteMiner")) ─── */
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

/* ── Игровые глобалы и константы движка ───────────────────────────────── */
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.CLAIM = "claim";
global.RESOURCE_ENERGY = "energy";
global.STRUCTURE_CONTAINER = "container";
global.STRUCTURE_LINK = "link";
global.FIND_SOURCES = 105;
global.FIND_STRUCTURES = 107;
global.FIND_CONSTRUCTION_SITES = 111;
global.FIND_DROPPED_RESOURCES = 106;
global.CARRY_CAPACITY = 50;
global.ENERGY_REGEN_TIME = 300;
global.HARVEST_POWER = 2;

global._ = { some: () => false };
global.Memory = { rooms: {} };

/* ── Мир: объекты по id + call-лог действий ──────────────────────────── */
const objects = {};
const calls = [];

/**
 * RoomPosition-мок. `near` — что вернёт isNearTo, `range` — getRangeTo,
 * `closest` — что вернёт findClosestByRange для каждого FIND_*.
 */
function RoomPos(x, y, roomName) {
  const self = {
    x,
    y,
    roomName,
    near: false,
    range: 5,
    closest: {},
    inRangeResult: [],
    isNearTo: () => self.near,
    isEqualTo: (a, b) =>
      typeof a === "number"
        ? a === self.x && b === self.y
        : !!a && a.x === self.x && a.y === self.y,
    getRangeTo: () => self.range,
    findClosestByRange: type =>
      self.closest[type] === undefined ? null : self.closest[type],
    findInRange: () => self.inRangeResult,
    createConstructionSite: structureType => {
      calls.push({ what: "createConstructionSite", pos: self, type: structureType });
      return global.OK;
    },
  };
  return self;
}
global.RoomPosition = RoomPos;

global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  getObjectById: id => {
    const obj = objects[id];
    return obj === undefined ? null : obj;
  },
};

function resetWorld() {
  for (const key in objects) delete objects[key];
  calls.length = 0;
  global.Game.creeps = {};
  global.Game.rooms = {};
  global.Memory.rooms = {};
  global.Game.time = 1000;
}

/** Регистрирует объект в мире и возвращает его. */
function reg(obj) {
  objects[obj.id] = obj;
  return obj;
}

/** Хранилище крипа/структуры. */
function mkStore(energy, capacity) {
  return {
    [global.RESOURCE_ENERGY]: energy,
    getFreeCapacity: () => capacity - energy,
    getCapacity: () => capacity,
  };
}

/**
 * Крип-мок. Все действия пишутся в calls, поэтому проверяется не «что-то
 * вызвано», а конкретное действие с конкретной целью.
 */
function mkCreep(over) {
  const creep = {
    name: "c",
    ticksToLive: 1200,
    memory: { role: "x", targetRoom: null },
    body: [],
    store: mkStore(0, 100),
    room: { name: "E35S37" },
    pos: RoomPos(25, 25, "E35S37"),
    travelTo: dest => calls.push({ what: "travelTo", dest: dest }),
    reserveController: target => calls.push({ what: "reserveController", target: target }),
    harvest: target => calls.push({ what: "harvest", target: target }),
    transfer: (target, resource) => calls.push({ what: "transfer", target: target, resource: resource }),
    withdraw: (target, resource) => calls.push({ what: "withdraw", target: target, resource: resource }),
    pickup: target => calls.push({ what: "pickup", target: target }),
    build: target => calls.push({ what: "build", target: target }),
    repair: target => calls.push({ what: "repair", target: target }),
    getActiveBodyparts: type => (type === global.WORK ? 10 : 0),
  };
  return Object.assign(creep, over || {});
}

/** Сколько раз было вызвано действие. */
function count(what) {
  let n = 0;
  for (let i = 0; i < calls.length; i++) if (calls[i].what === what) n++;
  return n;
}

/** Последний вызов действия. */
function last(what) {
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].what === what) return calls[i];
  return null;
}

const { REMOTE } = require("../constants");
const roleReserver = require("../role.reserver");
const roleRemoteMiner = require("../role.remoteMiner");
const roleRemoteHauler = require("../role.remoteHauler");

const HOME = REMOTE.HOME_ROOM;
const ROOM_A = REMOTE.ROOMS[0];

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

console.log("0. spawning: ни одна дальняя роль не действует");
{
  const roles = [
    ["reserver", roleReserver],
    ["remoteMiner", roleRemoteMiner],
    ["remoteHauler", roleRemoteHauler],
  ];
  for (const [name, role] of roles) {
    resetWorld();
    const creep = mkCreep({
      spawning: true,
      memory: { role: name, targetRoom: ROOM_A },
    });
    role.run(creep);
    check(
      `${name}: спавнящийся крип без действий`,
      calls.length === 0,
      JSON.stringify(calls.map(c => c.what)),
    );
  }
}

/* ══════════════════ RESERVER ══════════════════ */

console.log("1. reserver: targetRoom = null — роль не действует");
{
  resetWorld();
  const creep = mkCreep({ memory: { role: "reserver", targetRoom: null } });
  roleReserver.run(creep);
  check("ни одного действия", calls.length === 0, JSON.stringify(calls.map(c => c.what)));
}

console.log("\n2. reserver: рядом с контроллером — резерв каждый тик");
{
  resetWorld();
  const controller = { my: false, owner: undefined, pos: RoomPos(19, 39, ROOM_A) };
  const creep = mkCreep({
    memory: { role: "reserver", targetRoom: ROOM_A },
    room: { name: ROOM_A, controller: controller },
  });
  creep.pos = RoomPos(20, 39, ROOM_A);
  creep.pos.near = true; // isNearTo(controller) === true

  roleReserver.run(creep);
  check("резерв вызван", count("reserveController") === 1, String(count("reserveController")));
  check("цель — контроллер", last("reserveController").target === controller);
  check(
    "позиция контроллера запомнена",
    creep.memory.controllerPos && creep.memory.controllerPos.x === 19 && creep.memory.controllerPos.y === 39,
    JSON.stringify(creep.memory.controllerPos),
  );

  // Второй тик: резерв снова, а запись позиции не повторяется (метка-свидетель).
  creep.memory.controllerPos.marker = "keep";
  roleReserver.run(creep);
  check("на втором тике резерв тоже вызван", count("reserveController") === 2, String(count("reserveController")));
  check("позиция не перезаписана без изменения", creep.memory.controllerPos.marker === "keep");
}

console.log("\n3. reserver: вне комнаты — travelTo, а не резерв");
{
  resetWorld();
  const creep = mkCreep({
    memory: { role: "reserver", targetRoom: ROOM_A },
    room: { name: HOME },
  });
  roleReserver.run(creep);
  const move = last("travelTo");
  check("travelTo вызван", !!move);
  check(
    "без известной позиции — центр комнаты (25,25)",
    move && move.dest.x === 25 && move.dest.y === 25 && move.dest.roomName === ROOM_A,
    move && `${move.dest.x},${move.dest.y},${move.dest.roomName}`,
  );
  check("резерва не было", count("reserveController") === 0);

  // С запомненной позицией контроллера — идёт к ней, а не в центр.
  calls.length = 0;
  creep.memory.controllerPos = { x: 19, y: 39 };
  roleReserver.run(creep);
  const move2 = last("travelTo");
  check(
    "с известной позицией — к контроллеру",
    move2 && move2.dest.x === 19 && move2.dest.y === 39 && move2.dest.roomName === ROOM_A,
    move2 && `${move2.dest.x},${move2.dest.y}`,
  );
}

console.log("\n4. reserver: свой контроллер не резервируется");
{
  resetWorld();
  const controller = { my: true, pos: RoomPos(19, 39, ROOM_A) };
  const creep = mkCreep({
    memory: { role: "reserver", targetRoom: ROOM_A },
    room: { name: ROOM_A, controller: controller },
  });
  creep.pos = RoomPos(20, 39, ROOM_A);
  creep.pos.near = true;
  roleReserver.run(creep);
  check("резерва нет", count("reserveController") === 0);
  check("комната из памяти не сброшена", creep.memory.targetRoom === ROOM_A, String(creep.memory.targetRoom));
}

/* ══════════════════ REMOTE MINER ══════════════════ */

/**
 * Источник-мок: findInRange возвращает то, что лежит в замыкании теста.
 */
function mkSource(id, x, y, roomName, capacity, energy) {
  const source = {
    id,
    energy: energy === undefined ? capacity : energy,
    energyCapacity: capacity,
    ticksToRegeneration: 0,
    structures: [],
    sites: [],
  };
  source.pos = Object.assign(RoomPos(x, y, roomName), {
    findInRange: type =>
      type === global.FIND_STRUCTURES
        ? source.structures
        : type === global.FIND_CONSTRUCTION_SITES
          ? source.sites
          : [],
  });
  return reg(source);
}

/**
 * Контейнер-мок. Хиты по умолчанию — как у настоящего: CONTAINER_HITS = 250 000
 * (@screeps/common; в движке контейнер создаётся с полными хитами), ёмкость
 * CONTAINER_CAPACITY = 2000.
 */
function mkContainer(id, x, y, roomName, energy, hits, hitsMax) {
  const container = {
    id,
    structureType: global.STRUCTURE_CONTAINER,
    store: mkStore(energy, 2000),
    hits: hits === undefined ? 250000 : hits,
    hitsMax: hitsMax === undefined ? 250000 : hitsMax,
  };
  container.pos = RoomPos(x, y, roomName);
  return reg(container);
}

console.log("\n5. remoteMiner: targetRoom = null — роль не действует");
{
  resetWorld();
  const creep = mkCreep({ memory: { role: "remoteMiner", targetRoom: null } });
  roleRemoteMiner.run(creep);
  check("ни одного действия", calls.length === 0, JSON.stringify(calls.map(c => c.what)));
}

console.log("\n6. remoteMiner: вне комнаты — travelTo к известной цели");
{
  resetWorld();
  const container = mkContainer("cont_1", 37, 32, ROOM_A, 0);
  const creep = mkCreep({
    memory: { role: "remoteMiner", targetRoom: ROOM_A, containerId: container.id },
    room: { name: HOME },
  });
  roleRemoteMiner.run(creep);
  const move = last("travelTo");
  check("travelTo к контейнеру", move && move.dest === container, move && move.dest);
  check("центр комнаты не подменяет цель", count("travelTo") === 1);
}

console.log("\n7. remoteMiner: контейнера нет — площадка в настроенной клетке");
{
  resetWorld();
  const cell = REMOTE.ROOM_TO_CONTAINER_POS[ROOM_A];
  const source = mkSource("src_1", cell.x - 1, cell.y, ROOM_A, 1500);
  const creep = mkCreep({
    memory: { role: "remoteMiner", targetRoom: ROOM_A, sourceId: source.id },
    room: { name: ROOM_A },
    store: mkStore(0, 100),
  });
  // Крип уже стоит в настроенной рабочей клетке.
  creep.pos = RoomPos(cell.x, cell.y, ROOM_A);

  roleRemoteMiner.run(creep);
  const site = last("createConstructionSite");
  check("createConstructionSite вызван", !!site, JSON.stringify(calls.map(c => c.what)));
  check("тип — контейнер", site && site.type === global.STRUCTURE_CONTAINER, site && site.type);
  check(
    `клетка — настроенная (${cell.x},${cell.y})`,
    site && site.pos.x === cell.x && site.pos.y === cell.y,
    site && `${site.pos.x},${site.pos.y}`,
  );
  check("энергии нет — стройки нет", count("build") === 0);

  // Площадка поставлена: следующий тик её находит и строит своей энергией.
  calls.length = 0;
  source.sites = [{ id: "site_1", structureType: global.STRUCTURE_CONTAINER, pos: RoomPos(cell.x, cell.y, ROOM_A) }];
  delete creep.memory.containerCheckedAt; // как после createConstructionSite
  creep.store = mkStore(80, 100);
  roleRemoteMiner.run(creep);
  check("площадка найдена кэшем, второй раз не ставится", count("createConstructionSite") === 0, JSON.stringify(calls.map(c => c.what)));
  check("строит площадку своей энергией", count("build") === 1, JSON.stringify(calls.map(c => c.what)));
}

console.log("\n8. remoteMiner: контейнер есть — harvest пачкой");
{
  resetWorld();
  global.Game.time = 1000;
  const source = mkSource("src_2", 36, 32, ROOM_A, 3000);
  const container = mkContainer("cont_2", 37, 32, ROOM_A, 0);
  source.structures = [container];
  const creep = mkCreep({
    memory: { role: "remoteMiner", targetRoom: ROOM_A, sourceId: source.id },
    room: { name: ROOM_A },
    store: mkStore(0, 100),
  });
  creep.pos = RoomPos(37, 32, ROOM_A);

  roleRemoteMiner.run(creep);
  check("harvest вызван", count("harvest") === 1, JSON.stringify(calls.map(c => c.what)));
  check("цель — источник", last("harvest").target === source);
  check(
    "пачка = 2 × 10 WORK = 20",
    creep.memory.harvestPerCall === 20,
    String(creep.memory.harvestPerCall),
  );
  check(
    "интервал при источнике 3000 = 20 / (3000/300) = 2",
    creep.memory.harvestInterval === 2,
    String(creep.memory.harvestInterval),
  );

  // Нечётный тик — вызова нет (добыча идёт пачками, а не каждый тик).
  calls.length = 0;
  global.Game.time = 1001;
  roleRemoteMiner.run(creep);
  check("нечётный тик — harvest не зовётся", count("harvest") === 0, String(count("harvest")));
}

console.log("\n9. remoteMiner: рюкзак полон — слив в контейнер");
{
  resetWorld();
  global.Game.time = 1000;
  const source = mkSource("src_3", 36, 32, ROOM_A, 3000);
  const container = mkContainer("cont_3", 37, 32, ROOM_A, 100);
  source.structures = [container];
  const creep = mkCreep({
    memory: { role: "remoteMiner", targetRoom: ROOM_A, sourceId: source.id },
    room: { name: ROOM_A },
    store: mkStore(100, 100), // полный рюкзак: свободного места 0 < пачки 20
  });
  creep.pos = RoomPos(37, 32, ROOM_A);

  roleRemoteMiner.run(creep);
  check("transfer в контейнер", count("transfer") === 1, JSON.stringify(calls.map(c => c.what)));
  check("цель — контейнер", last("transfer").target === container);
  check("ресурс — энергия", last("transfer").resource === global.RESOURCE_ENERGY);
  check("harvest не звался (рюкзак полон)", count("harvest") === 0);
}

console.log("\n10. remoteMiner: повреждённый контейнер — ремонт своей энергией");
{
  resetWorld();
  global.Game.time = 1000;
  const source = mkSource("src_4", 36, 32, ROOM_A, 3000);
  const container = mkContainer("cont_4", 37, 32, ROOM_A, 0, 100000, 250000); // 40 % хитов
  source.structures = [container];
  const creep = mkCreep({
    memory: { role: "remoteMiner", targetRoom: ROOM_A, sourceId: source.id },
    room: { name: ROOM_A },
    store: mkStore(50, 100),
  });
  creep.pos = RoomPos(37, 32, ROOM_A);

  roleRemoteMiner.run(creep);
  check("repair вызван", count("repair") === 1, JSON.stringify(calls.map(c => c.what)));
  check("цель — контейнер", last("repair").target === container);
  check("harvest в этом тике не звался", count("harvest") === 0);
}

console.log("\n11. remoteMiner: интервал пересчитывается при смене ёмкости источника");
{
  resetWorld();
  global.Game.time = 1000;
  // Нейтральная комната: 1500 до резервации.
  const source = mkSource("src_5", 36, 32, ROOM_A, 1500);
  const container = mkContainer("cont_5", 37, 32, ROOM_A, 0);
  source.structures = [container];
  const creep = mkCreep({
    memory: { role: "remoteMiner", targetRoom: ROOM_A, sourceId: source.id },
    room: { name: ROOM_A },
    store: mkStore(0, 100),
  });
  creep.pos = RoomPos(37, 32, ROOM_A);

  roleRemoteMiner.run(creep);
  check(
    "нейтральная комната: 20 / (1500/300) = 4",
    creep.memory.harvestInterval === 4,
    String(creep.memory.harvestInterval),
  );

  // Резервация подняла ёмкость до 3000 — интервал должен стать 2 САМ.
  source.energyCapacity = 3000;
  calls.length = 0;
  global.Game.time = 1002;
  roleRemoteMiner.run(creep);
  check(
    "после резервации интервал пересчитан на 2",
    creep.memory.harvestInterval === 2,
    String(creep.memory.harvestInterval),
  );
  check("и harvest снова зовётся", count("harvest") === 1, JSON.stringify(calls.map(c => c.what)));
}

/* ══════════════════ REMOTE HAULER ══════════════════ */

function mkLink(id, x, y, roomName, energy, capacity) {
  const link = {
    id,
    structureType: global.STRUCTURE_LINK,
    store: mkStore(energy, capacity === undefined ? 800 : capacity),
  };
  link.pos = RoomPos(x, y, roomName);
  return reg(link);
}

function mkStorage(id, roomName, energy) {
  const storage = { id, store: mkStore(energy, 1000000) };
  storage.pos = RoomPos(18, 7, roomName);
  return reg(storage);
}

console.log("\n12. remoteHauler: targetRoom = null — роль не действует");
{
  resetWorld();
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: null, working: false },
    room: { name: HOME },
  });
  roleRemoteHauler.run(creep);
  check("ни одного действия", calls.length === 0, JSON.stringify(calls.map(c => c.what)));
}

console.log("\n13. remoteHauler: вне нужной комнаты — сразу к настоящей цели");
{
  resetWorld();
  const container = mkContainer("h_cont_1", 37, 32, ROOM_A, 1500);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: false, containerId: container.id },
    room: { name: HOME },
    store: mkStore(0, 800),
  });
  roleRemoteHauler.run(creep);
  const move = last("travelTo");
  check("едет к контейнеру, а не в центр", move && move.dest === container, move && move.dest);
}

console.log("\n14. remoteHauler: сбор из контейнера в isNearTo");
{
  resetWorld();
  const container = mkContainer("h_cont_2", 37, 32, ROOM_A, 1500);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: false, containerId: container.id },
    room: { name: ROOM_A },
    store: mkStore(0, 800),
  });
  creep.pos = RoomPos(37, 33, ROOM_A);
  creep.pos.near = true;

  roleRemoteHauler.run(creep);
  check("withdraw из контейнера", count("withdraw") === 1, JSON.stringify(calls.map(c => c.what)));
  check("цель — контейнер", last("withdraw").target === container);
  check("ресурс — энергия", last("withdraw").resource === global.RESOURCE_ENERGY);
}

console.log("\n15. remoteHauler: доставка в линк-приёмник");
{
  resetWorld();
  const link = mkLink(REMOTE.ROOM_TO_LINK[ROOM_A], 24, 46, HOME, 0);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: true },
    room: { name: HOME },
    store: mkStore(800, 800),
  });
  creep.pos = RoomPos(24, 45, HOME);
  creep.pos.near = true;

  roleRemoteHauler.run(creep);
  check("transfer в линк", count("transfer") === 1, JSON.stringify(calls.map(c => c.what)));
  check("цель — настроенный линк", last("transfer").target === link);
}

console.log("\n16. remoteHauler: линк полон — fallback storage");
{
  resetWorld();
  const link = mkLink(REMOTE.ROOM_TO_LINK[ROOM_A], 24, 46, HOME, 800); // полный
  const storage = mkStorage("stor_1", HOME, 100000);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: true },
    room: { name: HOME, storage: storage },
    store: mkStore(800, 800),
  });
  creep.pos = RoomPos(18, 6, HOME);
  creep.pos.near = true;

  roleRemoteHauler.run(creep);
  check("transfer в storage", count("transfer") === 1, JSON.stringify(calls.map(c => c.what)));
  check("цель — storage", last("transfer").target === storage);
  check("линк не тронут", last("transfer").target !== link);
}

console.log("\n17. remoteHauler: добычи нет — ждёт у источника, поиск не каждый тик");
{
  resetWorld();
  global.Game.time = 1000;
  const source = mkSource("h_src_1", 36, 32, ROOM_A, 3000);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: false },
    room: { name: ROOM_A },
    store: mkStore(0, 800),
  });
  creep.pos = RoomPos(30, 30, ROOM_A);
  creep.pos.range = 9;
  creep.pos.closest[global.FIND_SOURCES] = source;

  roleRemoteHauler.run(creep);
  check("источник ожидания запомнен", creep.memory.waitSourceId === source.id, String(creep.memory.waitSourceId));
  check("TTL следующего поиска выставлен", creep.memory.nextHaulSearch === 1000 + REMOTE.HAULER_SEARCH_INTERVAL, String(creep.memory.nextHaulSearch));
  const move = last("travelTo");
  check("едет к источнику", move && move.dest === source);

  // Внутри интервала поиск не повторяется: findClosestByRange не зовётся.
  calls.length = 0;
  let searched = 0;
  creep.pos.closest = new Proxy(
    {},
    {
      get: () => {
        searched++;
        return null;
      },
    },
  );
  global.Game.time = 1001;
  roleRemoteHauler.run(creep);
  check("внутри интервала поиск не шёл", searched === 0, String(searched));
}

console.log("\n17b. remoteHauler: пусто и уже рядом — уходит на клетку ожидания");
{
  resetWorld();
  global.Game.time = 1000;
  const source = mkSource("h_src_2", 36, 32, ROOM_A, 3000);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: false },
    room: { name: ROOM_A },
    store: mkStore(0, 800),
  });
  // Стоит на клетке контейнера (37,32), в одном тайле от источника.
  creep.pos = RoomPos(37, 32, ROOM_A);
  creep.pos.range = 1;
  creep.pos.closest[global.FIND_SOURCES] = source;

  roleRemoteHauler.run(creep);

  const move = last("travelTo");
  const wait = REMOTE.ROOM_TO_WAIT_POS[ROOM_A];
  check(
    "уходит на настроенную клетку ожидания, а не остаётся на контейнере",
    move &&
      move.dest &&
      move.dest.x === wait.x &&
      move.dest.y === wait.y &&
      move.dest.roomName === ROOM_A,
    move && move.dest && `${move.dest.x},${move.dest.y}`,
  );
}

console.log("\n18. remoteHauler: полный режим включает доставку сам");
{
  resetWorld();
  const link = mkLink(REMOTE.ROOM_TO_LINK[ROOM_A], 24, 46, HOME, 0);
  const creep = mkCreep({
    memory: { role: "remoteHauler", targetRoom: ROOM_A, working: false },
    room: { name: ROOM_A },
    store: mkStore(800, 800), // уже полный
  });
  creep.pos = RoomPos(37, 32, ROOM_A);
  roleRemoteHauler.run(creep);
  check("working переключён на доставку", creep.memory.working === true, String(creep.memory.working));
  const move = last("travelTo");
  // Цель доставки — объект линка (у него комната в .pos), а не RoomPosition.
  check(
    "и поехал к линку в домашней комнате",
    move && move.dest === link && link.pos.roomName === HOME,
    move && move.dest && move.dest.pos && move.dest.pos.roomName,
  );
  check("линк-приёмник в мире", !!link);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
