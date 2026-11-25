"use strict";
/**
 * ===================================================
 * DEFENSE.ALERT.TEST.JS — офлайн-проверка defense.manager и observer.manager
 * ===================================================
 * Перенесено из origin/Новая-Империя:tests/defense.tower.test.js (части 1-3,
 * где проверялся именно defense.manager). Часть про башни там относилась к
 * другому room.manager и здесь не нужна: поведение башен уже покрыто
 * tests/tower.attack.test.js.
 *
 * Проверяем конкретные дефекты, исправленные в рабочей ветке:
 *   1) global._defenseCache наполняется СРАЗУ после Global Reset, а не только
 *      на тике, кратном 25 (иначе оборона «слепа» до 25 тиков);
 *   2) не-боевой враг (без ATTACK/RANGED_ATTACK/HEAL) тревогу не поднимает,
 *      хотя башни его всё равно видят;
 *   3) Memory.attackAlert НЕ снимается, когда комната тревоги пропала из
 *      видимости, и снимается, когда комната видна и врагов в ней нет;
 *   4) тревога истекает по DEFENSE.ALERT_TTL, если комнату так и не увидели;
 *   5) InvaderCore в дальней комнате поднимает тревогу;
 *   6) обсервер берёт observerId из кэша scanner и обходит комнаты по кругу.
 *
 * Запуск: node tests/defense.alert.test.js
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
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;
global.FIND_HOSTILE_CREEPS = 101;
global.FIND_HOSTILE_STRUCTURES = 102;
global.STRUCTURE_INVADER_CORE = "invaderCore";
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
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "wall";
global.STRUCTURE_RAMPART = "rampart";
global.ATTACK = "attack";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " :: " + extra}`);
  }
}

// ── Фейковые комнаты/крипы ───────────────────────────────────────────────
function makeCreep(id, bodyType) {
  return {
    id,
    body: [{ type: bodyType || ATTACK }],
  };
}

/**
 * @param {string} name
 * @param {Object[]} hostiles
 * @param {boolean} my
 * @param {Object|null} invaderCore
 */
function makeRoom(name, hostiles, my = true, invaderCore = null) {
  return {
    name,
    controller: { my },
    find: type => {
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      if (type === FIND_HOSTILE_STRUCTURES) {
        return invaderCore ? [invaderCore] : [];
      }
      return [];
    },
  };
}

function makeGame(rooms, time) {
  const byId = {};
  for (const key in rooms) {
    const room = rooms[key];
    for (const c of room.find(FIND_HOSTILE_CREEPS)) byId[c.id] = c;
    for (const s of room.find(FIND_HOSTILE_STRUCTURES)) byId[s.id] = s;
  }
  return {
    time,
    creeps: {},
    rooms,
    getObjectById: id => byId[id] || null,
    cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  };
}

const defenseManager = require("../defense.manager");
const observerManager = require("../observer.manager");
const scanner = require("../scanner");
const { DEFENSE } = require("../constants");

function resetDefense() {
  global._defenseCache = {};
  global._hostileScan = {};
}

// ── 1. Global Reset: кэш наполняется на первом же тике ───────────────────
{
  console.log("\n1. global._defenseCache после Global Reset (тик 7, не кратный 25)");

  const hostile = makeCreep("h1", ATTACK);
  global.Memory = {};
  global.Game = makeGame({ E35S37: makeRoom("E35S37", [hostile]) }, 7);
  resetDefense();

  defenseManager.run();

  const cache = global._defenseCache.E35S37;
  check(
    "кэш комнаты заполнен на тике 7",
    cache &&
      Array.isArray(cache.hostileCreepIds) &&
      cache.hostileCreepIds.length === 1,
    JSON.stringify(cache),
  );
  check(
    "updatedAt выставлен",
    cache && cache.updatedAt === 7,
    cache && String(cache.updatedAt),
  );
  check(
    "тревога поднята",
    Memory.attackAlert && Memory.attackAlert.room === "E35S37",
    JSON.stringify(Memory.attackAlert),
  );
}

// ── 2. Не-боевой враг тревогу не поднимает ───────────────────────────────
{
  console.log("\n2. Не-боевой враг не поднимает тревогу");

  const worker = makeCreep("w1", "work");
  global.Memory = {};
  global.Game = makeGame({ E35S37: makeRoom("E35S37", [worker]) }, 10);
  resetDefense();

  defenseManager.run();

  check(
    "тревоги нет",
    Memory.attackAlert === undefined,
    JSON.stringify(Memory.attackAlert),
  );
  check(
    "враг всё равно в кэше (башни его видят)",
    global._defenseCache.E35S37.hostileCreepIds[0] === "w1",
    JSON.stringify(global._defenseCache.E35S37),
  );
}

// ── 3. Потеря видимости комнаты НЕ снимает тревогу ───────────────────────
{
  console.log("\n3. Потеря видимости комнаты не снимает Memory.attackAlert");

  global.Memory = { attackAlert: { room: "E35S37", time: 8 } };
  global.Game = makeGame({}, 8); // своей комнаты не видно
  resetDefense();

  defenseManager.run();
  check(
    "через 1 тик без видимости тревога сохранена",
    Memory.attackAlert && Memory.attackAlert.room === "E35S37",
    JSON.stringify(Memory.attackAlert),
  );

  global.Game.time = 8 + DEFENSE.ALERT_TTL;
  defenseManager.run();
  check(
    "по истечении TTL тревога снята",
    Memory.attackAlert === undefined,
    JSON.stringify(Memory.attackAlert),
  );
}

// ── 4. Видимая чистая комната снимает тревогу сразу ─────────────────────
{
  console.log("\n4. Видимая комната без врагов снимает тревогу сразу");

  global.Memory = { attackAlert: { room: "E35S37", time: 29 } };
  global.Game = makeGame({ E35S37: makeRoom("E35S37", []) }, 30);
  resetDefense();

  defenseManager.run();
  check(
    "видимая чистая комната тревоги → alert снят",
    Memory.attackAlert === undefined,
    JSON.stringify(Memory.attackAlert),
  );
}

// ── 5. InvaderCore в дальней комнате поднимает тревогу ───────────────────
{
  console.log("\n5. InvaderCore в видимой дальней комнате");

  const core = {
    id: "core1",
    structureType: STRUCTURE_INVADER_CORE,
  };
  global.Memory = {};
  global.Game = makeGame(
    {
      E35S37: makeRoom("E35S37", []),
      E36S37: makeRoom("E36S37", [], false, core),
    },
    40,
  );
  resetDefense();

  defenseManager.run();
  check(
    "тревога по ядру в E36S37",
    Memory.attackAlert && Memory.attackAlert.room === "E36S37",
    JSON.stringify(Memory.attackAlert),
  );
}

// ── 6. Обсервер: кэш scanner + обход по кругу ────────────────────────────
{
  console.log("\n6. observer.manager: observerId из кэша и обход по кругу");

  const observed = [];
  const observer = {
    id: "obs1",
    observeRoom: name => {
      observed.push(name);
    },
  };

  global.Memory = {};
  global.Game = {
    time: 0,
    rooms: { E36S38: { name: "E36S38", controller: { my: true } } },
    creeps: {},
    getObjectById: id => (id === "obs1" ? observer : null),
    cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  };
  global._observerId = null;

  const origGetCache = scanner.getStructureCache;
  scanner.getStructureCache = () => ({ observerId: "obs1" });

  observerManager.run();

  global.Game.time = 1;
  global._observerId = null;
  observerManager.run();

  check(
    "тик 0 — E36S37, тик 1 — E35S38 (по кругу)",
    observed[0] === DEFENSE.OBSERVER_SCAN_ROOMS[0] &&
      observed[1] === DEFENSE.OBSERVER_SCAN_ROOMS[1 % DEFENSE.OBSERVER_SCAN_ROOMS.length],
    observed.join(","),
  );

  scanner.getStructureCache = origGetCache;
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
