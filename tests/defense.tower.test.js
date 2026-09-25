"use strict";
/**
 * ===================================================
 * DEFENSE.TOWER.TEST.JS — оффлайн-проверка правок обороны и башен
 * ===================================================
 * Проверяем конкретные дефекты аудита:
 *   1. global._defenseCache наполняется СРАЗУ после Global Reset, а не только
 *      на тике, кратном 25 (иначе оборона «слепа» до 25 тиков);
 *   2. Memory.attackAlert НЕ снимается, когда комната тревоги пропала из
 *      видимости, и снимается, когда комната видна и врагов в ней нет;
 *   3. тревога истекает по ATTACK_ALERT_TTL, если комнату так и не увидели;
 *   4. башня бьёт доступного врага, даже если лекарь есть, но вне
 *      TOWER_FALLOFF_RANGE (раньше цель выбиралась только из лекарей);
 *   5. приоритет лекаря сохраняется, когда он в зоне поражения башни.
 *
 * Запуск: node tests/defense.tower.test.js
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
global.ERR_NO_PATH = -2;
global.FIND_HOSTILE_CREEPS = 100;
global.FIND_HOSTILE_STRUCTURES = 101;
global.STRUCTURE_INVADER_CORE = "invaderCore";
global.ATTACK = "attack";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";
global.TOWER_FALLOFF_RANGE = 10;
global.RESOURCE_ENERGY = "energy";

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

// ── Фейковые комнаты/крипы ───────────────────────────────────────────────
function makeCombatCreep(id) {
  return { id, body: [{ type: ATTACK }] };
}

/**
 * @param {string} name
 * @param {Object[]} hostiles
 * @param {boolean} my
 */
function makeRoom(name, hostiles, my = true, invaderCore = null) {
  return {
    name,
    controller: { my },
    find: type => {
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      if (type === FIND_HOSTILE_STRUCTURES) return invaderCore ? [invaderCore] : [];
      return [];
    },
  };
}

function makeGame(rooms, time) {
  const byId = {};
  for (const key in rooms) {
    for (const c of rooms[key].find(FIND_HOSTILE_CREEPS)) byId[c.id] = c;
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
const roleTower = require("../role.tower");

// ── 1. Global Reset: кэш обороны наполняется на первом же тике ────────────
{
  console.log("\n1. global._defenseCache после Global Reset (тик не кратен 25)");

  const hostile = makeCombatCreep("h1");
  global.Memory = {};
  global.Game = makeGame({ E35S37: makeRoom("E35S37", [hostile]) }, 7);
  global._defenseCache = {}; // как после Global Reset
  global._hostileScan = {};

  defenseManager.run();

  const cache = global._defenseCache.E35S37;
  check(
    "кэш комнаты заполнен на тике 7 (не кратном 25)",
    cache && Array.isArray(cache.hostileCreepIds) && cache.hostileCreepIds.length === 1,
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

// ── 2. Потеря видимости комнаты НЕ снимает тревогу ───────────────────────
{
  console.log("\n2. Потеря видимости комнаты не снимает Memory.attackAlert");

  // Комната тревоги исчезла из Game.rooms (крип ушёл/погиб).
  global.Game = makeGame({ E35S37: makeRoom("E35S37", [makeCombatCreep("h1")]) }, 8);
  global.Game.rooms = {}; // видимости нет
  global._hostileScan = {};

  defenseManager.run();
  check(
    "тревога сохранена через 1 тик без видимости",
    Memory.attackAlert && Memory.attackAlert.room === "E35S37",
    JSON.stringify(Memory.attackAlert),
  );

  // Прошло больше ATTACK_ALERT_TTL — тревога больше не нужна.
  global.Game.time = 8 + 60;
  defenseManager.run();
  check(
    "по истечении TTL тревога снята",
    Memory.attackAlert === undefined,
    JSON.stringify(Memory.attackAlert),
  );
}

// ── 3. Видимая и чистая комната снимает тревогу сразу ─────────────────────
{
  console.log("\n3. Видимая комната без врагов снимает тревогу сразу");

  global.Game = makeGame({ E35S37: makeRoom("E35S37", []) }, 30);
  global._defenseCache = {};
  global._hostileScan = {};
  Memory.attackAlert = { room: "E35S37", time: 29 };

  defenseManager.run();
  check(
    "видимая чистая комната тревоги → alert снят",
    Memory.attackAlert === undefined,
    JSON.stringify(Memory.attackAlert),
  );
}

// ── 4. Башня: лекарь вне дальности не блокирует другого врага ─────────────
function makeTower(x, y, attacked) {
  return {
    pos: {
      x,
      y,
      getRangeTo(target) {
        return Math.max(Math.abs(target.pos.x - x), Math.abs(target.pos.y - y));
      },
      inRangeTo(target, range) {
        return (
          Math.max(Math.abs(target.pos.x - x), Math.abs(target.pos.y - y)) <=
          range
        );
      },
      findInRange(list, range) {
        return list.filter(
          item =>
            Math.max(
              Math.abs(item.pos.x - x),
              Math.abs(item.pos.y - y),
            ) <= range,
        );
      },
      findClosestByRange(list) {
        let best = null;
        let bestRange = Infinity;
        for (const item of list) {
          const r = Math.max(
            Math.abs(item.pos.x - x),
            Math.abs(item.pos.y - y),
          );
          if (r < bestRange) {
            bestRange = r;
            best = item;
          }
        }
        return best;
      },
    },
    store: { energy: 1000 },
    attack: target => {
      attacked.push(target);
      return OK;
    },
    heal: () => OK,
    repair: () => OK,
  };
}

{
  console.log(
    "\n4. Лекарь вне TOWER_FALLOFF_RANGE не блокирует атаку по другому врагу",
  );

  const healer = { id: "healer", pos: { x: 40, y: 25 } }; // range 15 (вне 10)
  const fighter = { id: "fighter", pos: { x: 28, y: 25 } }; // range 3
  const attacked = [];
  const tower = makeTower(25, 25, attacked);

  roleTower.run(tower, {
    hostiles: [healer, fighter],
    healers: [healer],
    woundedCreep: null,
  });

  check(
    "башня атакует доступного врага",
    attacked.length === 1 && attacked[0].id === "fighter",
    attacked.map(t => t.id).join(","),
  );
}

// ── 4b. Вне зоны и лекарь, и более близкий враг — берём того, кто в зоне ──
{
  console.log(
    "\n4b. Из врагов вне зоны башня выбирает того, кто реально в TOWER_FALLOFF_RANGE",
  );

  const healer = { id: "healer", pos: { x: 37, y: 25 } }; // range 12 (вне 10)
  const farFighter = { id: "far", pos: { x: 36, y: 25 } }; // range 11 (вне 10)
  const nearFighter = { id: "near", pos: { x: 33, y: 25 } }; // range 8 (в зоне)
  const attacked = [];
  const tower = makeTower(25, 25, attacked);

  roleTower.run(tower, {
    hostiles: [healer, farFighter, nearFighter],
    healers: [healer],
    woundedCreep: null,
  });

  check(
    "ближайший вне зоны не перекрывает доступного врага",
    attacked.length === 1 && attacked[0].id === "near",
    attacked.map(t => t.id).join(","),
  );
}

// ── 5. Приоритет лекаря в зоне поражения сохранён ────────────────────────
{
  console.log("\n5. Лекарь в зоне поражения по-прежнему приоритетен");

  const healer = { id: "healer", pos: { x: 30, y: 25 } }; // range 5
  const fighter = { id: "fighter", pos: { x: 28, y: 25 } }; // range 3
  const attacked = [];
  const tower = makeTower(25, 25, attacked);

  roleTower.run(tower, {
    hostiles: [healer, fighter],
    healers: [healer],
    woundedCreep: null,
  });

  check(
    "башня бьёт лекаря, а не ближайшего врага",
    attacked.length === 1 && attacked[0].id === "healer",
    attacked.map(t => t.id).join(","),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
