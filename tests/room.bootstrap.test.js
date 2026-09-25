"use strict";
/**
 * ===================================================
 * ROOM.BOOTSTRAP.TEST.JS — офлайн-проверка аварийного подъёма комнаты
 * ===================================================
 * Инцидент 18.09.2026 (живой шард, E35S37): комната «погасла» — воркеров и
 * майнеров не осталось, в спавнах/расширениях было ~210 энергии, при этом в
 * storage лежало ~199k. Штатный воркер стоит 2500, поднять его на 210 энергии
 * нельзя, а дешёвого рабочего тела у роли не было. Комнату пришлось поднимать
 * харвестерами (резервной ролью) через ручной оверрайд harvester: 2.
 *
 * Здесь проверяется правка, после которой харвестеры для этого не нужны:
 *   1) конфиг: harvester 0, у воркера есть аварийное тело на 200;
 *   2) «погасшая» комната: spawnManager спавнит WORKER (а не харвестера) с
 *      аварийным телом, даже когда энергии меньше стоимости штатного тела;
 *   3) штатная комната: тот же путь отдаёт полное тело воркера;
 *   4) пре-спавн: без воркеров (оба на грани смерти) замена ставится заранее;
 *   5) энергии меньше 200 — не спавнится ничего (физически мёртвая комната);
 *   6) резерв storage не мешает аварийному воркеру взять энергию из storage;
 *   7) в обычной комнате резерв storage продолжает защищать энергию.
 *
 * Запуск: node tests/room.bootstrap.test.js
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
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_INVALID_ARGS = -10;
global.ERR_NO_BODYPART = -12;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_H = "H";
global.RESOURCE_O = "O";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.TOUGH = "tough";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";
global.CLAIM = "claim";

// ── Стоимость тела (как в движке) ────────────────────────────────────────
const BODY_COST = {
  tough: 10,
  work: 100,
  carry: 50,
  move: 50,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
};
function bodyCost(body) {
  let cost = 0;
  for (const part of body) cost += BODY_COST[part] || 0;
  return cost;
}

/**
 * Части тела роли из CREEP_BODIES — ожидания проверок выводятся из конфига,
 * а не из литералов: тела пересматриваются под бусты (worker 26 частей/1800
 * вместо 40/2500), и тест не должен ломаться от каждой такой правки.
 * @param {string} role
 * @returns {string[]}
 */
function bodyPartsOf(role) {
  const parts = [];
  const blueprint = CREEP_BODIES[role] || {};
  for (const part in blueprint) {
    for (let i = 0; i < blueprint[part]; i++) parts.push(part);
  }
  return parts;
}

// ── Store как в игре (отсутствующий ресурс = 0) ──────────────────────────
function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

function Store(capacity, contents) {
  const target = {};
  for (const k of Object.keys(contents || {})) target[k] = contents[k];
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "getFreeCapacity") return () => capacity - storeUsed(t);
      if (prop === "getUsedCapacity") return () => storeUsed(t);
      if (prop === "getCapacity") return () => capacity;
      if (typeof prop === "symbol") return t[prop];
      if (prop in t) return t[prop];
      return 0;
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
  });
}

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  getRangeTo(t) {
    const p = t && t.pos ? t.pos : t;
    if (p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  isNearTo(t) {
    return this.getRangeTo(t) <= 1;
  }
}
global.RoomPosition = RoomPosition;

// ── Мир ───────────────────────────────────────────────────────────────────
const WORLD = { objects: {} };
const ROOMS = {};

global.Game = {
  time: 1000,
  creeps: {},
  getObjectById: id => WORLD.objects[id] || null,
};
global._ = { some: () => false };

function makeStruct(id, x, y, roomName, capacity, contents) {
  const s = {
    id,
    pos: new RoomPosition(x, y, roomName),
    store: new Store(capacity, contents),
  };
  WORLD.objects[id] = s;
  return s;
}

function makeRoom(name, energyAvailable) {
  const room = {
    name,
    memory: {},
    energyAvailable,
    energyCapacityAvailable: 12600,
    storage: null,
    terminal: null,
    controller: null,
  };
  ROOMS[name] = room;
  room.storage = makeStruct("ST_" + name, 25, 25, name, 1000000, {});
  return room;
}

function makeSpawn(room, name, energy) {
  const spawn = {
    id: "SP_" + name,
    name,
    room,
    spawning: null,
    store: new Store(300, { energy }),
    spawned: [],
  };
  spawn.spawnCreep = function (body, creepName, opts) {
    const cost = bodyCost(body);
    if (cost > this.room.energyAvailable) return ERR_NOT_ENOUGH_ENERGY;
    this.spawned.push({ name: creepName, body, memory: opts.memory, cost });
    return OK;
  };
  return spawn;
}

function makeCreep(name, x, y, roomName, capacity, contents, role, ttl) {
  const creep = {
    name,
    pos: new RoomPosition(x, y, roomName),
    store: new Store(capacity, contents || {}),
    room: ROOMS[roomName],
    memory: { role, homeRoom: roomName },
    ticksToLive: ttl,
    spawning: false,
    travelToCalls: [],
    withdrawCalls: [],
    transferCalls: [],
    travelTo(target) {
      this.travelToCalls.push(target.id);
      return OK;
    },
    withdraw(target, resource) {
      this.withdrawCalls.push({ id: target.id, resource });
      return this.pos.isNearTo(target) ? OK : ERR_NOT_IN_RANGE;
    },
    transfer(target, resource) {
      this.transferCalls.push({ id: target.id, resource });
      return this.pos.isNearTo(target) ? OK : ERR_NOT_IN_RANGE;
    },
  };
  return creep;
}

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

// ── Загрузка проверяемых модулей ─────────────────────────────────────────
global.Memory = { rooms: { R: { tasks: {} } }, creeps: {} };
const spawnManager = require("../spawn.manager");
const taskExecutors = require("../task.executors");
const constants = require("../constants");
const {
  SPAWN_QUOTA,
  ROOM_SPAWN_QUOTA_OVERRIDES,
  CREEP_BODIES,
  WORKER,
  BOOTSTRAP,
  STORAGE,
} = constants;

// ── 1. Конфиг ────────────────────────────────────────────────────────────
{
  console.log("\n1. Конфиг аварийного подъёма");

  check(
    "harvester — нулевая квота по умолчанию",
    SPAWN_QUOTA.harvester === 0,
    String(SPAWN_QUOTA.harvester),
  );
  check(
    "E35S37: harvester 0 (резерв не используется)",
    ROOM_SPAWN_QUOTA_OVERRIDES.E35S37 &&
      ROOM_SPAWN_QUOTA_OVERRIDES.E35S37.harvester === 0,
    JSON.stringify(ROOM_SPAWN_QUOTA_OVERRIDES.E35S37),
  );

  const emergencyParts = [];
  for (const part in CREEP_BODIES.workerEmergency) {
    for (let i = 0; i < CREEP_BODIES.workerEmergency[part]; i++) {
      emergencyParts.push(part);
    }
  }
  check(
    "аварийное тело воркера укладывается в цену спавна",
    bodyCost(emergencyParts) === WORKER.BOOTSTRAP_BODY_ENERGY,
    String(bodyCost(emergencyParts)),
  );
  check(
    "аварийное тело дешевле критического порога (заспавнится)",
    WORKER.BOOTSTRAP_BODY_ENERGY <= BOOTSTRAP.CRITICAL_ROOM_ENERGY,
    `${WORKER.BOOTSTRAP_BODY_ENERGY} vs ${BOOTSTRAP.CRITICAL_ROOM_ENERGY}`,
  );
  check(
    "штатное тело воркера совпадает с порогом WORKER.NORMAL_BODY_ENERGY",
    WORKER.NORMAL_BODY_ENERGY === bodyCost(bodyPartsOf("worker")),
    `${WORKER.NORMAL_BODY_ENERGY} vs ${bodyCost(bodyPartsOf("worker"))}`,
  );
}

// ── 2. «Погасшая» комната: спавним аварийного воркера ───────────────────
{
  console.log("\n2. Погасшая комната (210 энергии, воркеров нет)");

  const room = makeRoom("R", 210);
  const spawn = makeSpawn(room, "Spawn1", 210);
  const roomState = {
    roomName: "R",
    room,
    spawns: [spawn],
    creeps: [],
    sources: [],
    extensions: [],
  };

  spawnManager.run(roomState);

  check(
    "стартовал ровно один спавн",
    spawn.spawned.length === 1,
    JSON.stringify(spawn.spawned.map(s => s.name)),
  );
  const spawned = spawn.spawned[0];
  check(
    "спавнится роль worker (не harvester)",
    spawned && spawned.memory.role === "worker",
    spawned ? spawned.memory.role : "none",
  );
  check(
    "тело — аварийное (4 части, 200)",
    spawned && spawned.body.length === 4 && spawned.cost === 200,
    spawned ? `${spawned.body.length}/${spawned.cost}` : "none",
  );
}

// ── 3. Штатная комната: полное тело воркера ─────────────────────────────
{
  console.log("\n3. Штатная комната (12600 энергии, есть воркер)");

  const room = makeRoom("R", 12600);
  const spawn = makeSpawn(room, "Spawn1", 300);
  const worker = makeCreep(
    "worker_R_1",
    10,
    10,
    "R",
    500,
    {},
    "worker",
    1000,
  );
  const linkWorker = makeCreep(
    "linkWorker_R_1",
    11,
    10,
    "R",
    200,
    {},
    "linkWorker",
    1000,
  );
  const roomState = {
    roomName: "R",
    room,
    spawns: [spawn],
    creeps: [worker, linkWorker],
    sources: [],
    extensions: [],
  };

  spawnManager.run(roomState);

  const spawned = spawn.spawned[0];
  // Ожидания выводим из CREEP_BODIES (тело воркера пересмотрено под бусты).
  const standardWorkerParts = bodyPartsOf("worker");
  check(
    `второй воркер ставится в штатное тело (${standardWorkerParts.length} частей)`,
    spawned &&
      spawned.memory.role === "worker" &&
      spawned.body.length === standardWorkerParts.length,
    spawned ? `${spawned.memory.role}/${spawned.body.length}` : "none",
  );
  check(
    `стоимость штатного тела ${bodyCost(standardWorkerParts)}`,
    spawned && spawned.cost === bodyCost(standardWorkerParts),
    spawned ? String(spawned.cost) : "none",
  );
}

// ── 4. Пре-спавн воркера без живых воркеров ─────────────────────────────
{
  console.log("\n4. Пре-спавн: воркер на грани смерти заменяется заранее");

  const room = makeRoom("R", 4000);
  const spawn = makeSpawn(room, "Spawn1", 300);
  const dying = makeCreep("worker_R_1", 10, 10, "R", 500, {}, "worker", 100);
  const linkWorker = makeCreep(
    "linkWorker_R_1",
    11,
    10,
    "R",
    200,
    {},
    "linkWorker",
    1000,
  );
  const roomState = {
    roomName: "R",
    room,
    spawns: [spawn],
    creeps: [dying, linkWorker],
    sources: [],
    extensions: [],
  };

  spawnManager.run(roomState);

  const spawned = spawn.spawned[0];
  check(
    "замена воркера стартовала (пре-спавн 150)",
    spawned && spawned.memory.role === "worker",
    spawned ? spawned.memory.role : "none",
  );
  check(
    "штатное тело, энергии хватает",
    spawned && spawned.body.length === bodyPartsOf("worker").length,
    spawned ? String(spawned.body.length) : "none",
  );
}

// ── 5. Энергии меньше 200 — не спавнится ничего ─────────────────────────
{
  console.log("\n5. Комната мертва физически (< 200 энергии)");

  const room = makeRoom("R", 150);
  const spawn = makeSpawn(room, "Spawn1", 150);
  const roomState = {
    roomName: "R",
    room,
    spawns: [spawn],
    creeps: [],
    sources: [],
    extensions: [],
  };

  spawnManager.run(roomState);

  check(
    "ничего не заспавнено",
    spawn.spawned.length === 0,
    JSON.stringify(spawn.spawned.map(s => s.name)),
  );
}

// ── 6/7. Резерв storage в аварийном режиме ──────────────────────────────
function runFillExecutor(roomEnergyAvailable, storageEnergy) {
  const room = makeRoom("R", roomEnergyAvailable);
  room.storage.store.energy = storageEnergy;
  const target = makeStruct("EXT1", 10, 11, "R", 50, {});
  const creep = makeCreep("worker_R_x", 25, 25, "R", 100, {}, "worker", 1000);
  creep.room = room;
  const task = {
    type: "transfer",
    sourceId: room.storage.id,
    targetId: target.id,
    resourceType: "energy",
  };
  const result = taskExecutors.executeFillSpawnsExtensions(creep, task);
  return { result, creep, room };
}

{
  console.log("\n6. Авария: резерв storage не блокирует подвоз");

  const { result, creep } = runFillExecutor(
    210,
    STORAGE.ENERGY_MIN - 1, // запас ниже резерва
  );

  check(
    "executor вернул CONTINUE (энергия берётся)",
    result === "CONTINUE",
    result,
  );
  check(
    "withdraw нацелен на storage",
    creep.withdrawCalls.length === 1 &&
      creep.withdrawCalls[0].id === creep.room.storage.id,
    JSON.stringify(creep.withdrawCalls),
  );
}

{
  console.log("\n7. Обычная комната: резерв storage защищает энергию");

  const { result, creep } = runFillExecutor(
    12600,
    STORAGE.ENERGY_MIN - 1, // запас ниже резерва
  );

  check("executor вернул SKIP (резерв ниже порога)", result === "SKIP", result);
  check(
    "storage не тронут",
    creep.withdrawCalls.length === 0,
    JSON.stringify(creep.withdrawCalls),
  );
}

// ── 8. Живой воркер + пул не дорос: спасателя НЕ ставим ─────────────────
{
  console.log(
    "\n8. Есть живой воркер, энергии мало: ждём, а не плодим слабого",
  );

  const room = makeRoom("R", 2000);
  const spawn = makeSpawn(room, "Spawn1", 300);
  const worker = makeCreep("worker_R_1", 10, 10, "R", 500, {}, "worker", 1000);
  const roomState = {
    roomName: "R",
    room,
    spawns: [spawn],
    creeps: [worker],
    sources: [],
    extensions: [],
  };

  spawnManager.run(roomState);

  const spawnedRoles = spawn.spawned.map(s => s.memory.role);
  check(
    "слабый воркер не заспавнен (живого воркера достаточно)",
    spawnedRoles.indexOf("worker") === -1,
    JSON.stringify(spawnedRoles),
  );
  check(
    "аварийное тело нигде не использовано",
    spawn.spawned.every(s => s.cost !== WORKER.BOOTSTRAP_BODY_ENERGY),
    JSON.stringify(spawn.spawned.map(s => s.cost)),
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
