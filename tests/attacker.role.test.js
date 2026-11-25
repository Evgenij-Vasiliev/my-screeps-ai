"use strict";
/**
 * ===================================================
 * ATTACKER.ROLE.TEST.JS — офлайн-проверка role.attacker
 * ===================================================
 * Роль перенесена из origin/Новая-Империя:defense.attacker.js. Тест
 * фиксирует поведение, которое нельзя проверить чтением кода:
 *   1) спавнящийся крип ничего не делает;
 *   2) без тревоги идёт на точку сбора DEFENSE.RALLY;
 *   3) тревога в другой комнате — travelTo в неё;
 *   4) в целевой комнате бьёт врага и кайтит (дистанция < 3);
 *   5) два врага в радиусе 3 — rangedMassAttack;
 *   6) врагов нет, но есть InvaderCore — бьёт ядро;
 *   7) heal не вызывается без HEAL-частей (тело атакующего их не имеет);
 *   8) Memory.rallyOverride важнее автотревоги;
 *   9) самозащита в пути срабатывает до выхода в целевую комнату;
 *  10) враг дальше 3 клеток — travelTo к цели, без выстрела.
 *
 * Запуск: node tests/attacker.role.test.js
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
global.FIND_HOSTILE_CREEPS = 101;
global.FIND_HOSTILE_STRUCTURES = 102;
global.STRUCTURE_INVADER_CORE = "invaderCore";
global.ATTACK = "attack";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";

global.RoomPosition = function RoomPosition(x, y, roomName) {
  this.x = x;
  this.y = y;
  this.roomName = roomName;
};

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

// ── Фейковые позиции/крипы ───────────────────────────────────────────────
function chebyshev(a, b) {
  if (a.roomName && b.roomName && a.roomName !== b.roomName) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function makePos(x, y, roomName, opts = {}) {
  return {
    x,
    y,
    roomName,
    getRangeTo(target) {
      return chebyshev(this, target.pos || target);
    },
    inRangeTo(tx, ty, range) {
      return Math.max(Math.abs(this.x - tx), Math.abs(this.y - ty)) <= range;
    },
    getDirectionTo() {
      return opts.dir === undefined ? 8 : opts.dir;
    },
    findClosestByRange(arg, findOpts) {
      if (arg === FIND_HOSTILE_CREEPS) return opts.nearest || null;
      if (arg === FIND_HOSTILE_STRUCTURES) return opts.core || null;
      if (Array.isArray(arg)) {
        let best = null;
        let bestRange = Infinity;
        for (const item of arg) {
          const r = this.getRangeTo(item);
          if (findOpts && findOpts.filter && !findOpts.filter(item)) continue;
          if (r < bestRange) {
            bestRange = r;
            best = item;
          }
        }
        return best;
      }
      return null;
    },
  };
}

/**
 * @param {Object} opts
 * @param {string} [opts.room]
 * @param {number} [opts.x]
 * @param {number} [opts.y]
 * @param {number} [opts.healParts]
 * @param {Object|null} [opts.nearest]
 * @param {Object|null} [opts.core]
 * @param {number} [opts.dir]
 */
function makeCreep(opts = {}) {
  const calls = { travel: [], move: [], rangedAttack: [], mass: 0, heal: 0 };
  const creep = {
    spawning: opts.spawning === true,
    hits: opts.hits === undefined ? 2000 : opts.hits,
    hitsMax: 2000,
    memory: {},
    room: { name: opts.room || "E35S37" },
    calls,
    getActiveBodyparts(type) {
      return type === HEAL ? opts.healParts || 0 : 0;
    },
    travelTo(destination) {
      calls.travel.push(destination);
    },
    move(direction) {
      calls.move.push(direction);
    },
    rangedAttack(target) {
      calls.rangedAttack.push(target);
    },
    rangedMassAttack() {
      calls.mass++;
    },
    heal() {
      calls.heal++;
    },
  };
  creep.pos = makePos(opts.x === undefined ? 25 : opts.x, opts.y === undefined ? 25 : opts.y, creep.room.name, {
    nearest: opts.nearest || null,
    core: opts.core || null,
    dir: opts.dir,
  });
  return creep;
}

const roleAttacker = require("../role.attacker");
const { DEFENSE } = require("../constants");

function resetMemory() {
  global.Memory = {};
  global._defenseCache = {};
  global._hostileScan = {};
}

// ── 1. Спавнящийся крип не действует ─────────────────────────────────────
{
  console.log("\n1. Спавнящийся крип не действует");
  resetMemory();
  const creep = makeCreep({ spawning: true });

  roleAttacker.run(creep);

  check(
    "нет интентов движения/атаки/лечения",
    creep.calls.travel.length === 0 &&
      creep.calls.move.length === 0 &&
      creep.calls.rangedAttack.length === 0 &&
      creep.calls.heal === 0,
    JSON.stringify(creep.calls),
  );
}

// ── 2. Без тревоги — на точку сбора ─────────────────────────────────────
{
  console.log("\n2. Без тревоги идёт на точку сбора");
  resetMemory();
  const creep = makeCreep({ room: DEFENSE.RALLY.room, x: 25, y: 25 });

  roleAttacker.run(creep);

  const dest = creep.calls.travel[0];
  check(
    "travelTo к DEFENSE.RALLY",
    dest &&
      dest.x === DEFENSE.RALLY.x &&
      dest.y === DEFENSE.RALLY.y &&
      dest.roomName === DEFENSE.RALLY.room,
    JSON.stringify(dest),
  );
}

// ── 3. Тревога в другой комнате — travelTo в неё ────────────────────────
{
  console.log("\n3. Тревога в другой комнате — travelTo в неё");
  resetMemory();
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const creep = makeCreep({ room: "E35S37", x: 25, y: 25 });

  roleAttacker.run(creep);

  const dest = creep.calls.travel[0];
  check(
    "travelTo в комнату тревоги",
    dest && dest.x === 25 && dest.y === 25 && dest.roomName === "E36S37",
    JSON.stringify(dest),
  );
}

// ── 4-5. В целевой комнате: стрельба, кайтинг, массовая атака ────────────
function makeHostile(id, x, y, room = "E36S37") {
  return {
    id,
    room: { name: room },
    pos: { x, y, roomName: room },
    getActiveBodyparts: () => 0,
  };
}

{
  console.log("\n4. В целевой комнате бьёт врага и кайтит");
  resetMemory();
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const h1 = makeHostile("h1", 27, 25); // range 2
  global._defenseCache.E36S37 = { hostileCreepIds: ["h1"], invaderCoreId: null };
  global.Game = {
    time: 100,
    getObjectById: id => (id === "h1" ? h1 : null),
  };
  const creep = makeCreep({ room: "E36S37", x: 25, y: 25, nearest: h1, dir: 8 });

  roleAttacker.run(creep);

  check(
    "rangedAttack по ближайшему",
    creep.calls.rangedAttack.length === 1 && creep.calls.rangedAttack[0] === h1,
    String(creep.calls.rangedAttack.length),
  );
  check(
    "кайтинг: шаг в противоположную сторону (dir 8 → 4)",
    creep.calls.move.length === 1 && creep.calls.move[0] === 4,
    JSON.stringify(creep.calls.move),
  );
  check("массовой атаки нет", creep.calls.mass === 0, String(creep.calls.mass));
}

{
  console.log("\n5. Два врага в радиусе 3 — rangedMassAttack");
  resetMemory();
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const h1 = makeHostile("h1", 27, 25);
  const h2 = makeHostile("h2", 25, 27);
  global._defenseCache.E36S37 = {
    hostileCreepIds: ["h1", "h2"],
    invaderCoreId: null,
  };
  global.Game = {
    time: 100,
    getObjectById: id => (id === "h1" ? h1 : id === "h2" ? h2 : null),
  };
  const creep = makeCreep({ room: "E36S37", x: 25, y: 25, nearest: h1, dir: 8 });

  roleAttacker.run(creep);

  check("rangedMassAttack вызван", creep.calls.mass === 1, String(creep.calls.mass));
  check(
    "одиночного rangedAttack нет",
    creep.calls.rangedAttack.length === 0,
    String(creep.calls.rangedAttack.length),
  );
}

// ── 6. Врагов нет, но есть InvaderCore ───────────────────────────────────
{
  console.log("\n6. Врагов нет, есть InvaderCore — бьёт ядро");
  resetMemory();
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const core = {
    id: "core1",
    structureType: STRUCTURE_INVADER_CORE,
    pos: { x: 25, y: 27, roomName: "E36S37" },
  };
  global._defenseCache.E36S37 = { hostileCreepIds: [], invaderCoreId: "core1" };
  global.Game = { time: 100, getObjectById: id => (id === "core1" ? core : null) };
  const creep = makeCreep({ room: "E36S37", x: 25, y: 25, dir: 8 });

  roleAttacker.run(creep);

  check(
    "rangedAttack по ядру",
    creep.calls.rangedAttack.length === 1 && creep.calls.rangedAttack[0] === core,
    String(creep.calls.rangedAttack.length),
  );
}

// ── 7. heal только при HEAL-частях ───────────────────────────────────────
{
  console.log("\n7. heal только при HEAL-частях");
  resetMemory();
  const noHeal = makeCreep({ hits: 100, healParts: 0 });
  roleAttacker.run(noHeal);
  check("без HEAL heal не вызывается", noHeal.calls.heal === 0, String(noHeal.calls.heal));

  resetMemory();
  const withHeal = makeCreep({ hits: 100, healParts: 1 });
  roleAttacker.run(withHeal);
  check("с HEAL heal вызван", withHeal.calls.heal === 1, String(withHeal.calls.heal));
}

// ── 8. rallyOverride важнее автотревоги ─────────────────────────────────
{
  console.log("\n8. Memory.rallyOverride важнее автотревоги");
  resetMemory();
  Memory.rallyOverride = "E37S37";
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const creep = makeCreep({ room: "E35S37", x: 25, y: 25 });

  roleAttacker.run(creep);

  const dest = creep.calls.travel[0];
  check(
    "travelTo в E37S37, не в комнату тревоги",
    dest && dest.roomName === "E37S37",
    JSON.stringify(dest),
  );
}

// ── 9. Самозащита в пути ────────────────────────────────────────────────
{
  console.log("\n9. Самозащита в пути");
  resetMemory();
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const enemy = makeHostile("enemy1", 27, 25, "E35S39");
  const creep = makeCreep({
    room: "E35S39",
    x: 25,
    y: 25,
    nearest: enemy,
    dir: 8,
  });

  roleAttacker.run(creep);

  check(
    "атакует врага в пути",
    creep.calls.rangedAttack.length === 1 && creep.calls.rangedAttack[0] === enemy,
    String(creep.calls.rangedAttack.length),
  );
  check(
    "не уходит в целевую комнату, пока враг рядом",
    creep.calls.travel.length === 0,
    JSON.stringify(creep.calls.travel),
  );
}

// ── 10. Враг дальше 3 клеток — сближение ─────────────────────────────────
{
  console.log("\n10. Враг дальше 3 клеток — travelTo к цели");
  resetMemory();
  Memory.attackAlert = { room: "E36S37", time: 100 };
  const h1 = makeHostile("h1", 30, 25); // range 5
  global._defenseCache.E36S37 = { hostileCreepIds: ["h1"], invaderCoreId: null };
  global.Game = { time: 100, getObjectById: id => (id === "h1" ? h1 : null) };
  const creep = makeCreep({ room: "E36S37", x: 25, y: 25, nearest: h1, dir: 8 });

  roleAttacker.run(creep);

  check(
    "travelTo к врагу",
    creep.calls.travel.length === 1 && creep.calls.travel[0] === h1,
    String(creep.calls.travel.length),
  );
  check(
    "без выстрела",
    creep.calls.rangedAttack.length === 0,
    String(creep.calls.rangedAttack.length),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
