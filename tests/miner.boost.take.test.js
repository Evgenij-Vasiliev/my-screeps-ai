"use strict";
/**
 * ===================================================
 * MINER.BOOST.TAKE.TEST.JS — удар harvest с бустом (T1-контур, UO)
 * ===================================================
 * ЧТО БЫЛО. role.miner.js считал удар как `getActiveBodyparts(WORK) × 2`, то есть
 * БЕЗ множителя буста, и кэшировал результат на всю жизнь крипа. С 02.10.2026
 * политика выдаёт майнеру UO (BOOSTS.work.UO.harvest = 3), и движок отдаёт за
 * удар больше, чем роль планировала: рюкзак (7 CARRY = 350) переполняется, а
 * излишек движок СБРАСЫВАЕТ НА ПОЛ (engine src/processor/intents/creeps/
 * harvest.js, ветка `sum > storeCapacity` → `drop`). Слить его некому: майнер
 * стоит на клетке источника, рюкзак полон.
 *
 * ЧТО ПРОВЕРЯЕТСЯ:
 *   1) тело без бустов: удар = живые WORK × HARVEST_POWER (прежнее поведение);
 *   2) тело с бустом: удар считается по формуле движка calcBodyEffectiveness
 *      (engine src/utils.js:623-636) — часть с UO даёт ×3;
 *   3) кэш удара сбрасывается, когда буст появился В ЖИЗНИ крипа (подпись тела);
 *   4) в установившемся состоянии Memory крипа не переписывается;
 *   5) симуляция 40 тиков с бустом: потерь в drop НЕТ, энергия сходится;
 *   6) РЕГРЕСС: с устаревшим кэшем (70 при фактических 90) симуляция теряет
 *      энергию — это и есть дефект, который закрывает правка.
 *
 * Запуск: node tests/miner.boost.take.test.js
 * ===================================================
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// На шарде require("role.miner") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Глобалы движка, которые нужны роли ────────────────────────────────
global.FIND_SOURCES = 5;
global.FIND_MY_STRUCTURES = 6;
global.STRUCTURE_LINK = "link";
global.RESOURCE_ENERGY = "energy";
global.WORK = "work";
global.HARVEST_POWER = 2;
global.OK = 0;
global.Memory = { rooms: {} };
global.Game = { time: 0, getObjectById: () => null };
// Движковая таблица бустов — только нужная ветка (WORK → UO → harvest ×3).
global.BOOSTS = { work: { UO: { harvest: 3 }, XUHO2: { harvest: 7 } } };

const roleMiner = require("../role.miner");

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
const REGEN_TIME = 300;
const STORE_CAP = 350; // 7 CARRY

/**
 * Тело крипа: сначала WORK (первые — без буста, последние `boosted` — с бустом),
 * затем CARRY и MOVE. Порядок как у настоящего тела (boost ложится на последние
 * части), но для роли важно только содержимое.
 */
function makeBody(plainWork, boostedWork, boost) {
  const body = [];
  for (let i = 0; i < plainWork; i++) body.push({ type: WORK, hits: 100 });
  for (let i = 0; i < boostedWork; i++) {
    body.push({ type: WORK, hits: 100, boost: boost || "UO" });
  }
  const carry = Math.floor(STORE_CAP / 50);
  for (let i = 0; i < carry; i++) body.push({ type: "carry", hits: 100 });
  for (let i = 0; i < 8; i++) body.push({ type: "move", hits: 100 });
  return body;
}

/**
 * Истинная сила удара — НЕЗАВИСИМАЯ реализация формулы движка
 * (calcBodyEffectiveness: живая часть × BOOSTS[WORK][boost].harvest).
 * Именно столько вернёт движок за одно creep.harvest().
 */
function truePower(body) {
  let power = 0;
  for (const part of body) {
    if (part.type !== global.WORK || !part.hits) continue;
    let p = global.HARVEST_POWER;
    const entry = part.boost && global.BOOSTS.work[part.boost];
    if (entry && entry.harvest) p *= entry.harvest;
    power += p;
  }
  return power;
}

/** Мир одного сценария: одно рабочее место, источник 3000, линк и рюкзак. */
function makeWorld(body, opts) {
  opts = opts || {};

  const source = {
    id: "sA",
    energy: opts.energy === undefined ? 3000 : opts.energy,
    energyCapacity: 3000,
    nextRegen: null,
    ticksToRegeneration: undefined,
  };
  const link = {
    id: "lA",
    store: {
      energy: 0,
      cap: 800,
      getFreeCapacity() {
        return this.cap - this.energy;
      },
    },
  };
  const store = {
    energy: 0,
    cap: STORE_CAP,
    getFreeCapacity() {
      return this.cap - this.energy;
    },
  };

  const world = {
    time: 0,
    source,
    link,
    store,
    body,
    harvested: 0,
    dropped: 0,
    calls: { harvest: 0, transfer: 0 },
  };

  const creep = {
    name: "miner_W1N1_test",
    memory: {},
    ticksToLive: 1000,
    body,
    store,
    pos: { x: 0, y: 0, isEqualTo: (x, y) => x === 0 && y === 0 },
    room: {
      name: ROOM,
      getPositionAt() {
        return {
          findInRange(type) {
            if (type === global.FIND_SOURCES) return [source];
            if (type === global.FIND_MY_STRUCTURES) return [link];
            return [];
          },
        };
      },
    },
    // Мок движка: за один harvest снимается ровно истинная сила удара, а излишек
    // сверх рюкзака уходит в drop — как в engine harvest.js.
    harvest(src) {
      world.calls.harvest++;
      const amount = Math.min(src.energy, truePower(body));
      src.energy -= amount;
      store.energy += amount;
      world.harvested += amount;
      if (store.energy > store.cap) {
        world.dropped += store.energy - store.cap;
        store.energy = store.cap;
      }
    },
    transfer(target) {
      world.calls.transfer++;
      const free = target.store.getFreeCapacity(global.RESOURCE_ENERGY);
      const amount = Math.min(store.energy, free);
      store.energy -= amount;
      target.store.energy += amount;
    },
    moveTo() {
      world.calls.moveTo = (world.calls.moveTo || 0) + 1;
    },
  };

  world.creep = creep;
  Memory.rooms[ROOM] = { minerSpots: [{ x: 0, y: 0 }], minerWp: 0 };
  global.__minerSpots = {}; // heap-кэш id: новый мир — новый кэш
  global.Game.time = 0;
  global.Game.getObjectById = id => (id === "sA" ? source : id === "lA" ? link : null);

  return world;
}

/** Один тик: наливка источника по таймеру, затем роль, затем опустошение линка. */
function tick(world) {
  global.Game.time = world.time++;
  const s = world.source;
  if (s.energy < s.energyCapacity) {
    if (!s.nextRegen) s.nextRegen = global.Game.time + REGEN_TIME;
    if (global.Game.time >= s.nextRegen - 1) {
      s.nextRegen = null;
      s.energy = s.energyCapacity;
    }
  }
  s.ticksToRegeneration = s.nextRegen ? s.nextRegen - global.Game.time : undefined;

  roleMiner.run(world.creep);
  world.delivered = (world.delivered || 0) + world.link.store.energy;
  world.link.store.energy = 0; // линк разгружает linkManager каждый тик
}

/* ── 1. Тело без бустов ───────────────────────────────────────────────── */
console.log("1. Тело без бустов: удар = живые WORK × 2");
const w1 = makeWorld(makeBody(35, 0));
tick(w1);
check("удар 70 при 35 WORK", w1.creep.memory.harvestTake === 70,
  String(w1.creep.memory.harvestTake));
check("подпись тела записана (35 живых, 0 с бустом)",
  w1.creep.memory.harvestSignature === 3500,
  String(w1.creep.memory.harvestSignature));

/* ── 2. Тело с бустом ─────────────────────────────────────────────────── */
console.log("\n2. Тело с UO: 30 обычных + 5 бустнутых частей");
const w2 = makeWorld(makeBody(30, 5));
tick(w2);
check("удар 90 (30×2 + 5×2×3), а не 70", w2.creep.memory.harvestTake === 90,
  String(w2.creep.memory.harvestTake));
check("подпись: 35 живых, 5 с бустом", w2.creep.memory.harvestSignature === 3505,
  String(w2.creep.memory.harvestSignature));

/* ── 3. Буст появился в жизни крипа ───────────────────────────────────── */
console.log("\n3. Буст выдан в жизни крипа: кэш удара сбрасывается");
const w3 = makeWorld(makeBody(35, 0));
tick(w3);
check("до буста удар 70", w3.creep.memory.harvestTake === 70,
  String(w3.creep.memory.harvestTake));
// Лаборатория бустит последние WORK-части — здесь просто помечаем их бустом.
for (let i = 0; i < w3.body.length; i++) {
  if (w3.body[i].type === global.WORK && i >= 25) w3.body[i].boost = "UO";
}
tick(w3);
check("после буста удар 110 (25×2 + 10×6)", w3.creep.memory.harvestTake === 110,
  String(w3.creep.memory.harvestTake));

/* ── 4. Memory не переписывается в установившемся режиме ──────────────── */
console.log("\n4. Установившийся режим: Memory крипа не меняется");
const w4 = makeWorld(makeBody(30, 5));
tick(w4);
const snapshot = JSON.stringify(w4.creep.memory);
for (let i = 0; i < 5; i++) tick(w4);
check("память крипа та же после 5 тиков",
  JSON.stringify(w4.creep.memory) === snapshot,
  JSON.stringify(w4.creep.memory));
check("ключей ровно два (harvestTake, harvestSignature)",
  Object.keys(w4.creep.memory).length === 2,
  Object.keys(w4.creep.memory).join(","));

/* ── 5. Симуляция: потерь энергии нет ─────────────────────────────────── */
console.log("\n5. 40 тиков с бустом: drop нет, энергия сходится");
const w5 = makeWorld(makeBody(30, 5));
for (let i = 0; i < 40; i++) tick(w5);
// Пачка = 3 удара по 90 (270 из 350), затем тик слива: 40 тиков = 10 пачек,
// то есть 30 ударов и 2700 снятой энергии. Четвёртый удар в пачке роль НЕ зовёт
// намеренно — он не влезает в рюкзак и был бы сброшен на пол.
check("потерь в drop нет", w5.dropped === 0, String(w5.dropped));
check("снято 2700 за 30 ударов (10 пачек по 3 удара)",
  w5.harvested === 2700, String(w5.harvested));
check("вся снятая энергия доехала до линка и рюкзака",
  w5.delivered + w5.store.energy === w5.harvested,
  `${w5.delivered} + ${w5.store.energy} против ${w5.harvested}`);
check("сливов меньше, чем ударов (пачки)",
  w5.calls.transfer < w5.calls.harvest,
  `${w5.calls.transfer} < ${w5.calls.harvest}`);

/* ── 6. Регресс: устаревший кэш теряет энергию ────────────────────────── */
console.log("\n6. РЕГРЕСС: кэш 70 при фактических 90 → энергия уходит в drop");
const w6 = makeWorld(makeBody(30, 5));
// Ровно то состояние, в котором роль жила до правки: удар посчитан без буста.
w6.creep.memory.harvestTake = 70;
w6.creep.memory.harvestSignature = 3505;
for (let i = 0; i < 40; i++) tick(w6);
check("с прежней формулой энергия теряется (drop > 0)", w6.dropped > 0,
  String(w6.dropped));
check("потеряно ровно 10 единиц за пачку (350 при ударе 90)",
  w6.dropped % 10 === 0, String(w6.dropped));

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
