"use strict";
/**
 * ===================================================
 * REMOTE.STALE-TARGETS.TEST.JS — устаревшие room-цели дальних ролей
 * ===================================================
 * Живой инцидент (shard3, 19.09.2026): remote.manager переназначил
 * remoteHauler_E35S37_83084919 комнату с E36S37 на E35S38 (так лечится дубль,
 * который оставляет pre-spawn). Хайлер при этом держал в памяти
 * waitSourceId = источник E36S37 и containerId = контейнер E36S37, поэтому
 * ушёл к источнику E36S37, встал рядом с ним и в E35S38 не пошёл вовсе:
 *   t=83086047..83086123  room=E36S37 pos=21,12 target=E35S38
 *   travelDest=22,10E36S37 (источник покинутой комнаты)
 * Контейнер E35S38 остался полон (2000/2000), майнер простаивал.
 *
 * Правило: room-зависимую цель (источник, контейнер, площадка, выпавший
 * ресурс) можно использовать, только если объект существует И находится в
 * текущем targetRoom. Иначе запись удаляется и цель ищется заново.
 *
 * Проверяем для remoteHauler и remoteMiner:
 *   1) общий помощник roomScopedTarget;
 *   2) крип работает в E36S37, затем targetRoom меняется на E35S38;
 *   3) старые ID принадлежат E36S37 → не используются и удаляются;
 *   4) крип идёт в E35S38, а не в покинутую комнату;
 *   5) войдя в E35S38, выбирает объекты именно E35S38;
 *   6) у майнера вместе с чужим источником сбрасывается план пачечной добычи;
 *   7) регресс: цели своей комнаты по-прежнему используются;
 *   8) точное воспроизведение живого случая.
 *
 * Запуск: node tests/remote.stale-targets.test.js
 */

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

// ── Глобалы Screeps ──────────────────────────────────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.TOUGH = "tough";
global.CLAIM = "claim";
global.HEAL = "heal";
global.RANGED_ATTACK = "ranged_attack";
global.STRUCTURE_CONTAINER = "container";
global.FIND_STRUCTURES = 1;
global.FIND_DROPPED_RESOURCES = 2;
global.FIND_SOURCES = 3;
global.FIND_CONSTRUCTION_SITES = 4;

const WORLD = { objects: {} };

function posInRange(a, b) {
  if (a.roomName !== b.roomName) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  getRangeTo(t) {
    const p = t && t.pos ? t.pos : t;
    if (!p) return Infinity;
    return posInRange(this, p);
  }
  isNearTo(t) {
    return this.getRangeTo(t) <= 1;
  }
  isEqualTo(t) {
    return !!t && this.x === t.x && this.y === t.y && this.roomName === t.roomName;
  }
  findInRange(type, range, opts) {
    return pick(this, type, opts).filter(o => this.getRangeTo(o) <= range);
  }
  findClosestByRange(type, opts) {
    const list = Array.isArray(type) ? type.slice() : pick(this, type, opts);
    let best = null;
    let bestRange = Infinity;
    for (const o of list) {
      const r = this.getRangeTo(o);
      if (r < bestRange) {
        bestRange = r;
        best = o;
      }
    }
    return best;
  }
}
global.RoomPosition = RoomPosition;

function pick(pos, type, opts) {
  const out = [];
  for (const id of Object.keys(WORLD.objects)) {
    const o = WORLD.objects[id];
    if (!o.pos || o.pos.roomName !== pos.roomName) continue;
    if (type === FIND_STRUCTURES && o.structureType === undefined) continue;
    if (type === FIND_DROPPED_RESOURCES && o.amount === undefined) continue;
    if (type === FIND_SOURCES && o.energy === undefined) continue;
    if (type === FIND_CONSTRUCTION_SITES && o.progress === undefined) continue;
    if (opts && opts.filter && !opts.filter(o)) continue;
    out.push(o);
  }
  return out;
}

function addObject(o) {
  WORLD.objects[o.id] = o;
  return o;
}

function makeContainer(id, roomName, x, y, energy) {
  return addObject({
    id,
    pos: new RoomPosition(x, y, roomName),
    room: { name: roomName },
    structureType: STRUCTURE_CONTAINER,
    store: { energy },
  });
}

function makeSource(id, roomName, x, y) {
  return addObject({
    id,
    pos: new RoomPosition(x, y, roomName),
    room: { name: roomName },
    energy: 3000,
    energyCapacity: 3000,
  });
}

function makeDropped(id, roomName, x, y, amount) {
  return addObject({
    id,
    pos: new RoomPosition(x, y, roomName),
    room: { name: roomName },
    resourceType: RESOURCE_ENERGY,
    amount,
  });
}

function makeSite(id, roomName, x, y) {
  return addObject({
    id,
    pos: new RoomPosition(x, y, roomName),
    room: { name: roomName },
    structureType: STRUCTURE_CONTAINER,
    progress: 10,
  });
}

global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  getObjectById: id => WORLD.objects[id] || null,
};
global.Memory = { creeps: {}, rooms: {} };

/** Комната для role.miner (creep.room.find(FIND_SOURCES)). */
function makeRoom(name) {
  const room = {
    name,
    find(type) {
      return pick(new RoomPosition(0, 0, name), type, null);
    },
  };
  Game.rooms[name] = room;
  return room;
}

/**
 * @param {Object} spec
 */
function makeCreep(spec) {
  const roomName = spec.room;
  const creep = {
    name: spec.name || `${spec.role}_E35S37_100`,
    room: makeRoom(roomName),
    pos: new RoomPosition(spec.x, spec.y, roomName),
    body: spec.body || [],
    store: {
      energy: spec.energy || 0,
      getFreeCapacity: () => 1000 - (spec.energy || 0),
      getUsedCapacity: () => spec.energy || 0,
      getCapacity: () => 1000,
    },
    memory: Object.assign(
      { role: spec.role, homeRoom: "E35S37", targetRoom: spec.targetRoom },
      spec.memory || {},
    ),
    travelToCalls: [],
    withdrawCalls: [],
    pickupCalls: [],
    harvestCalls: [],
    travelTo(target) {
      this.travelToCalls.push(target);
      return OK;
    },
    withdraw(target, resource) {
      this.withdrawCalls.push({ id: target.id, resource });
      return OK;
    },
    pickup(target) {
      this.pickupCalls.push(target.id);
      return OK;
    },
    harvest(target) {
      this.harvestCalls.push(target.id);
      return OK;
    },
    getActiveBodyparts: () => 0,
    say: () => OK,
  };
  return creep;
}

// ── Загрузка проверяемых модулей ─────────────────────────────────────────
const { roomScopedTarget } = require("../remote.targets");
const roleRemoteHauler = require("../remote.hauler");
const roleRemoteMiner = require("../remote.miner");

const R38 = "E35S38"; // новая комната
const R37 = "E36S37"; // прежняя комната

// Объекты прежней комнаты E36S37 (регистрируются в мире; нужны по id из памяти)
const C37 = makeContainer("cont_r37", R37, 21, 11, 500);
makeSource("src_r37", R37, 22, 10);
makeDropped("drop_r37", R37, 20, 12, 300);
makeSite("site_r37", R37, 21, 12);

// Объекты новой комнаты E35S38 (контейнер — на настроенной рабочей клетке)
const C38 = makeContainer("cont_r38", R38, 37, 32, 800);
makeSource("src_r38", R38, 36, 32);
const D38 = makeDropped("drop_r38", R38, 35, 32, 300);

// ── Отчётность ───────────────────────────────────────────────────────────
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

function destRoom(target) {
  if (!target) return "нет";
  return target.pos ? target.pos.roomName : target.roomName;
}

// ── 1. Общий помощник ────────────────────────────────────────────────────
{
  console.log("\n1. roomScopedTarget: цель годится только в своей комнате");

  const creep = makeCreep({ role: "remoteHauler", room: R37, x: 10, y: 10, targetRoom: R37 });

  creep.memory.containerId = "cont_r37";
  check(
    "объект своей комнаты возвращается",
    roomScopedTarget(creep, "containerId", R37) === C37,
  );
  check("ключ не удалён", creep.memory.containerId === "cont_r37");

  check(
    "объект чужой комнаты не возвращается",
    roomScopedTarget(creep, "containerId", R38) === null,
  );
  check(
    "ключ чужой комнаты удалён",
    creep.memory.containerId === undefined,
    String(creep.memory.containerId),
  );

  creep.memory.containerId = "нет_такого_id";
  check(
    "исчезнувший объект не возвращается",
    roomScopedTarget(creep, "containerId", R37) === null,
  );
  check("ключ исчезнувшего объекта удалён", creep.memory.containerId === undefined);

  check("пустой ключ → null", roomScopedTarget(creep, "droppedId", R37) === null);
  check("пустой ключ не создаётся", !("droppedId" in creep.memory));
}

// ── 2. remoteHauler: переназначение комнаты ──────────────────────────────
{
  console.log("\n2. remoteHauler: работал в E36S37, targetRoom → E35S38");

  const creep = makeCreep({
    role: "remoteHauler",
    name: "remoteHauler_E35S37_83084919",
    room: R37,
    x: 21,
    y: 12,
    targetRoom: R38, // remote.manager уже переназначил комнату
    memory: {
      working: false,
      containerId: "cont_r37",
      droppedId: "drop_r37",
      waitSourceId: "src_r37",
    },
  });

  roleRemoteHauler.run(creep);

  check(
    "старый containerId (E36S37) удалён",
    creep.memory.containerId === undefined,
    String(creep.memory.containerId),
  );
  check(
    "старый droppedId (E36S37) удалён",
    creep.memory.droppedId === undefined,
    String(creep.memory.droppedId),
  );
  check(
    "старый waitSourceId (E36S37) удалён",
    creep.memory.waitSourceId === undefined,
    String(creep.memory.waitSourceId),
  );
  check(
    "цель движения не в покинутой комнате",
    creep.travelToCalls.every(t => destRoom(t) !== R37),
    creep.travelToCalls.map(destRoom).join(","),
  );
  check(
    "крип идёт в новую комнату E35S38",
    creep.travelToCalls.length === 1 && destRoom(creep.travelToCalls[0]) === R38,
    creep.travelToCalls.map(destRoom).join(","),
  );

  // Крип вошёл в новую комнату — цели должны выбираться из неё
  creep.room = makeRoom(R38);
  creep.pos = new RoomPosition(10, 10, R38);
  roleRemoteHauler.run(creep);

  check(
    "в E35S38 выбран контейнер именно E35S38",
    creep.memory.containerId === "cont_r38",
    String(creep.memory.containerId),
  );
  check(
    "движение к цели уже в E35S38",
    creep.travelToCalls[creep.travelToCalls.length - 1].pos.roomName === R38 ||
      creep.withdrawCalls.length > 0,
    creep.withdrawCalls.map(c => c.id).join(","),
  );
}

// ── 3. remoteHauler: пошаговый выбор целей в новой комнате ───────────────
{
  console.log("\n3. remoteHauler: цели новой комнаты по приоритету");

  const creep = makeCreep({
    role: "remoteHauler",
    name: "remoteHauler_E35S37_900",
    room: R38,
    x: 10,
    y: 10,
    targetRoom: R38,
    memory: { working: false, containerId: "cont_r37", droppedId: "drop_r37", waitSourceId: "src_r37" },
  });

  roleRemoteHauler.run(creep);
  check("контейнер E35S38 перебил старый E36S37", creep.memory.containerId === "cont_r38");
  check("старые ключи не восстановились", !creep.memory.droppedId && !creep.memory.waitSourceId);

  // Контейнер опустел → подбираем выпавшую энергию E35S38
  C38.store.energy = 0;
  delete creep.memory.containerId;
  creep.memory.nextHaulSearch = 0;
  roleRemoteHauler.run(creep);
  check("при пустом контейнере выбран дроп E35S38", creep.memory.droppedId === "drop_r38");

  // Дропа нет → ждём у источника E35S38
  D38.amount = 0;
  delete creep.memory.droppedId;
  creep.memory.nextHaulSearch = 0;
  roleRemoteHauler.run(creep);
  check("при отсутствии добычи выбран источник E35S38", creep.memory.waitSourceId === "src_r38");
  check(
    "источник ожидания действительно в E35S38",
    Game.getObjectById(creep.memory.waitSourceId).pos.roomName === R38,
  );

  C38.store.energy = 800;
  D38.amount = 300;
}

// ── 4. remoteMiner: переназначение комнаты ───────────────────────────────
{
  console.log("\n4. remoteMiner: работал в E36S37, targetRoom → E35S38");

  const creep = makeCreep({
    role: "remoteMiner",
    name: "remoteMiner_E35S37_500",
    room: R37,
    x: 20,
    y: 20,
    targetRoom: R38,
    body: ["work", "carry", "move"],
    memory: {
      sourceId: "src_r37",
      containerId: "cont_r37",
      containerSiteId: "site_r37",
      harvestInterval: 2,
      harvestPerCall: 20,
    },
  });

  roleRemoteMiner.run(creep);

  check("старый sourceId (E36S37) удалён", creep.memory.sourceId === undefined);
  check("старый containerId (E36S37) удалён", creep.memory.containerId === undefined);
  check(
    "старый containerSiteId (E36S37) удалён",
    creep.memory.containerSiteId === undefined,
  );
  check(
    "план пачечной добычи сброшен вместе с чужим источником",
    creep.memory.harvestInterval === undefined && creep.memory.harvestPerCall === undefined,
    `${creep.memory.harvestInterval}/${creep.memory.harvestPerCall}`,
  );
  check(
    "майнер не идёт к объектам E36S37",
    creep.travelToCalls.every(t => destRoom(t) !== R37),
    creep.travelToCalls.map(destRoom).join(","),
  );
  check(
    "майнер идёт в новую комнату E35S38",
    creep.travelToCalls.length === 1 && destRoom(creep.travelToCalls[0]) === R38,
    creep.travelToCalls.map(destRoom).join(","),
  );

  // Майнер вошёл в E35S38 (не на рабочей клетке) — цели из новой комнаты
  creep.room = makeRoom(R38);
  creep.pos = new RoomPosition(10, 10, R38);
  roleRemoteMiner.run(creep);

  check(
    "в E35S38 выбран источник E35S38",
    creep.memory.sourceId === "src_r38",
    String(creep.memory.sourceId),
  );
  check(
    "в E35S38 выбран контейнер E35S38",
    creep.memory.containerId === "cont_r38",
    String(creep.memory.containerId),
  );
  check(
    "майнер идёт к рабочей цели в E35S38",
    creep.travelToCalls.length > 0 &&
      destRoom(creep.travelToCalls[creep.travelToCalls.length - 1]) === R38,
    creep.travelToCalls.map(destRoom).join(","),
  );
}

// ── 5. Регресс: свои цели не выбрасываются ───────────────────────────────
{
  console.log("\n5. Регресс: цели текущей комнаты по-прежнему используются");

  const hauler = makeCreep({
    role: "remoteHauler",
    name: "remoteHauler_E35S37_700",
    room: R37,
    x: 10,
    y: 10,
    targetRoom: R37,
    memory: { working: false, containerId: "cont_r37" },
  });
  roleRemoteHauler.run(hauler);
  check("свой containerId сохранён", hauler.memory.containerId === "cont_r37");
  check(
    "хайлер идёт к своему контейнеру",
    hauler.travelToCalls.length === 1 && hauler.travelToCalls[0].id === "cont_r37",
  );

  const miner = makeCreep({
    role: "remoteMiner",
    name: "remoteMiner_E35S37_701",
    room: R37,
    x: 10,
    y: 10,
    targetRoom: R37,
    body: ["work", "carry", "move"],
    memory: { sourceId: "src_r37", containerId: "cont_r37", harvestInterval: 2, harvestPerCall: 20 },
  });
  roleRemoteMiner.run(miner);
  check("свой sourceId сохранён", miner.memory.sourceId === "src_r37");
  check("свой containerId сохранён", miner.memory.containerId === "cont_r37");
  check(
    "план добычи не сброшен",
    miner.memory.harvestInterval === 2 && miner.memory.harvestPerCall === 20,
    `${miner.memory.harvestInterval}/${miner.memory.harvestPerCall}`,
  );
  check(
    "майнер идёт к цели в своей комнате",
    miner.travelToCalls.length === 1 && destRoom(miner.travelToCalls[0]) === R37,
    miner.travelToCalls.map(destRoom).join(","),
  );
}

// ── 6. Точное воспроизведение живого случая ──────────────────────────────
{
  console.log("\n6. Живой случай: remoteHauler_E35S37_83084919");

  const creep = makeCreep({
    role: "remoteHauler",
    name: "remoteHauler_E35S37_83084919",
    room: R37,
    x: 21,
    y: 12,
    targetRoom: R38,
    energy: 0,
    memory: {
      working: false,
      containerId: "cont_r37",
      waitSourceId: "src_r37", // источник E36S37 (22,10) — так было в игре
    },
  });

  roleRemoteHauler.run(creep);

  const first = creep.travelToCalls[0];
  check(
    "раньше уходил к источнику E36S37 (22,10) — теперь нет",
    !first || first.id !== "src_r37",
    first ? String(first.id) : "нет вызова",
  );
  check(
    "теперь идёт в E35S38",
    creep.travelToCalls.length === 1 && destRoom(first) === R38,
    creep.travelToCalls.map(destRoom).join(","),
  );
  check(
    "waitSourceId покинутой комнаты удалён",
    creep.memory.waitSourceId === undefined,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
