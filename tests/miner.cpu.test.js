"use strict";
/**
 * ===================================================
 * MINER.CPU.TEST.JS — интенты роли miner: пачечный слив вместо потикового
 * ===================================================
 * Правка 01.10.2026 (снижение CPU роли miner). Постановка ОДНОГО интента стоит
 * 0.2 CPU (driver lib/runtime/runtime.js:60,69 — `intentCpu = 0.2`, начисление в
 * `intents.set`), поэтому роль платит за каждый вызов harvest/transfer/moveTo.
 *
 * Что проверяем:
 *   1) transfer идёт ПАЧКАМИ: за 20 тиков удар каждый тик даёт 2 слива вместо 20;
 *   2) harvest по-прежнему бьёт каждый тик, пока в источнике есть энергия
 *      (экономить тут нечего: число ударов задаёт объём добычи, 3000 / 46 = 65);
 *   3) удар не зовётся, когда он не влезает в рюкзак, — иначе движок сбрасывает
 *      излишек на пол (engine src/processor/intents/creeps/harvest.js, ветка
 *      `sum > object.storeCapacity` → `drop`), то есть энергия теряется;
 *   4) последние единицы источника по-прежнему снимаются (нет «замерзания»
 *      остатка, из-за которого роль отказывалась от неполного удара);
 *   5) переход на соседнее место работает: вычерпанный источник (`drained`) и
 *      энергия у соседа переводят Memory.rooms[room].minerWp;
 *   6) ГЛАВНОЕ — симуляция 900 тиков: добыча держит потолок комнаты
 *      (2 источника x 3000 за 300 тиков = 20 энергии/тик), потерь в drop нет,
 *      а интентов становится заметно меньше, чем при прежнем условии слива
 *      (`free + freeEnergy >= take` вызывал transfer каждый тик с грузом).
 *
 * Симуляция смоделирована по исходникам движка: harvest кладёт 46 в рюкзак
 * (с drop при переполнении), transfer отдаёт линку, источники наливаются по
 * таймеру ENERGY_REGEN_TIME (engine src/processor/intents/sources/tick.js),
 * майнер идёт к споту по клетке за тик.
 *
 * Запуск: node tests/miner.cpu.test.js
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
const SOURCE_CAPACITY = 3000;
const REGEN_TIME = 300;

/**
 * Мир одного сценария: два рабочих места, у каждого свой линк.
 * @param {{srcA?:number, srcB?:number, carried?:number, linkEnergy?:number,
 *          time?:number, wp?:number, distance?:number}} o
 */
function makeWorld(o) {
  o = o || {};
  const distance = o.distance === undefined ? 20 : o.distance;
  const spots = [{ x: 0, y: 0 }, { x: distance, y: 0 }];

  const mkSource = (id, energy) => ({
    id,
    energy,
    energyCapacity: SOURCE_CAPACITY,
    nextRegen: null,
    ticksToRegeneration: undefined,
  });
  const srcA = mkSource("sA", o.srcA === undefined ? SOURCE_CAPACITY : o.srcA);
  const srcB = mkSource("sB", o.srcB === undefined ? SOURCE_CAPACITY : o.srcB);

  const mkLink = id => ({
    id,
    store: {
      energy: 0,
      cap: 800,
      getFreeCapacity() {
        return this.cap - this.energy;
      },
    },
  });
  const linkA = mkLink("lA");
  const linkB = mkLink("lB");
  linkA.store.energy = o.linkEnergy || 0;

  const bySpot = {
    "0,0": { source: srcA, link: linkA },
    [distance + ",0"]: { source: srcB, link: linkB },
  };

  const store = {
    energy: o.carried || 0,
    cap: 500,
    getFreeCapacity() {
      return this.cap - this.energy;
    },
  };

  const world = {
    time: o.time || 0,
    spots,
    sources: [srcA, srcB],
    links: [linkA, linkB],
    store,
    harvested: 0,
    dropped: 0,
    // Сколько раз transfer поставила бы ПРЕЖНЯЯ логика слива
    // (`free + freeEnergy >= take`): каждый тик, когда есть груз и линк не полон.
    oldTransfers: 0,
    calls: { harvest: 0, transfer: 0, moveTo: 0 },
    target: null,
    linkAt(x, y) {
      const at = bySpot[x + "," + y];
      return at ? at.link : null;
    },
  };

  const pos = {
    x: spots[o.wp === 1 ? 1 : 0].x,
    y: 0,
    isEqualTo(x, y) {
      return this.x === x && this.y === y;
    },
  };

  const creep = {
    name: "miner_W1N1_1",
    memory: {},
    ticksToLive: 1000,
    store,
    pos,
    room: {
      name: ROOM,
      getPositionAt(x, y) {
        const at = bySpot[x + "," + y];
        return {
          findInRange(type) {
            if (!at) return [];
            if (type === FIND_SOURCES) return at.source ? [at.source] : [];
            if (type === FIND_MY_STRUCTURES) return at.link ? [at.link] : [];
            return [];
          },
        };
      },
    },
    getActiveBodyparts: () => 23,
    moveTo(x, y) {
      world.calls.moveTo++;
      world.target = { x, y };
    },
    harvest(src) {
      world.calls.harvest++;
      const amount = Math.min(src.energy, 46);
      src.energy -= amount;
      store.energy += amount;
      world.harvested += amount;
      if (store.energy > store.cap) {
        world.dropped += store.energy - store.cap;
        store.energy = store.cap;
      }
    },
    transfer(t) {
      world.calls.transfer++;
      const free = t.store.getFreeCapacity(RESOURCE_ENERGY);
      const amount = Math.min(store.energy, free);
      store.energy -= amount;
      t.store.energy += amount;
    },
  };

  world.creep = creep;
  Memory.rooms[ROOM] = { minerSpots: spots, minerWp: o.wp || 0 };
  global.__minerSpots = {}; // кэш id в heap: новый мир — новый кэш

  Game.time = world.time;
  Game.getObjectById = id =>
    id === "sA"
      ? srcA
      : id === "sB"
        ? srcB
        : id === "lA"
          ? linkA
          : id === "lB"
            ? linkB
            : null;

  /** Шаг майнера к цели за тик (модель движения). */
  world.step = function () {
    if (!world.target) return;
    if (pos.x !== world.target.x) pos.x += Math.sign(world.target.x - pos.x);
    else if (pos.y !== world.target.y) pos.y += Math.sign(world.target.y - pos.y);
  };

  /** Tick-обработчик источников: таймер наливки (engine sources/tick.js). */
  world.regen = function () {
    for (const s of world.sources) {
      if (s.energy < s.energyCapacity) {
        if (!s.nextRegen) s.nextRegen = Game.time + REGEN_TIME;
        if (Game.time >= s.nextRegen - 1) {
          s.nextRegen = null;
          s.energy = s.energyCapacity;
        }
      }
      s.ticksToRegeneration = s.nextRegen ? s.nextRegen - Game.time : undefined;
    }
  };

  return world;
}

/** Один тик боевого порядка: источники → роль → движение → linkManager. */
function tick(world, drainLinks) {
  Game.time = world.time++;

  // Прежняя логика слива: transfer на каждом тике, где есть груз и место в линке.
  const link = world.linkAt(world.creep.pos.x, world.creep.pos.y);
  if (link && world.store.energy > 0 && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    world.oldTransfers++;
  }

  world.regen();
  roleMiner.run(world.creep);
  world.step();
  if (drainLinks) for (const l of world.links) l.store.energy = 0;
}

// ── 1. Слив пачками, удар — каждый тик ─────────────────────────────────
// Точные числа — якорь поведения: `free` читается ДО удара, поэтому после
// наполнения рюкзака слив уходит на следующий тик: за 20 тиков 19 ударов
// (t0..t18), 1 слив (t10, когда свободного места осталось 40 < 46) и 874
// снятой энергии. Прежняя логика сливала бы 18 раз за те же 20 тиков.
console.log("1. 20 тиков на полном источнике: удары каждый тик, слив пачками");
const w1 = makeWorld({ time: 0 });
for (let i = 0; i < 20; i++) tick(w1, true);
check("harvest вызван 19 раз (удар каждый тик)", w1.calls.harvest === 19, String(w1.calls.harvest));
check("transfer вызван 1 раз, а не 18", w1.calls.transfer === 1, String(w1.calls.transfer));
check("прежняя логика дала бы 18 сливов", w1.oldTransfers === 18, String(w1.oldTransfers));
check("снято 874 энергии", w1.harvested === 874, String(w1.harvested));
check("движения не было (майнер на месте)", w1.calls.moveTo === 0, String(w1.calls.moveTo));
check("потерь в drop нет", w1.dropped === 0, String(w1.dropped));

// ── 2. Удар не влезает в рюкзак — harvest не зовётся ───────────────────
console.log("\n2. Свободного места меньше удара: harvest не зовётся (нет drop)");
const w2 = makeWorld({ time: 0, carried: 470 });
tick(w2, true);
check("harvest не вызван", w2.calls.harvest === 0, String(w2.calls.harvest));
check("transfer вызван (места под удар нет)", w2.calls.transfer === 1, String(w2.calls.transfer));
check("потерь в drop нет", w2.dropped === 0, String(w2.dropped));

// ── 3. Остаток источника снимается ─────────────────────────────────────
console.log("\n3. Остаток источника меньше удара: снимается целиком");
const w3 = makeWorld({ time: 1, srcA: 30 });
tick(w3, true);
check("harvest вызван", w3.calls.harvest === 1, String(w3.calls.harvest));
check("источник вычерпан до нуля", w3.sources[0].energy === 0, String(w3.sources[0].energy));

// ── 4. Переход между рабочими местами остался рабочим ──────────────────
console.log("\n4. Переход на соседнее место");
const w4 = makeWorld({ time: 0, srcA: 0, srcB: 1000, wp: 0 });
roleMiner.run(w4.creep);
check("minerWp переключён на 1", Memory.rooms[ROOM].minerWp === 1, String(Memory.rooms[ROOM].minerWp));

const w5 = makeWorld({ time: 0, srcA: 0, srcB: 0, wp: 0 });
roleMiner.run(w5.creep);
check("к пустому соседу не идём", Memory.rooms[ROOM].minerWp === 0, String(Memory.rooms[ROOM].minerWp));

// ── 5. Симуляция 900 тиков ─────────────────────────────────────────────
console.log("\n5. Симуляция 900 тиков: два источника, наливка 300, переход 20 клеток");
const sim = makeWorld({ time: 0, distance: 20 });
for (let i = 0; i < 900; i++) tick(sim, true);

const intentsNow = sim.calls.harvest + sim.calls.transfer + sim.calls.moveTo;
const intentsOld = sim.calls.harvest + sim.oldTransfers + sim.calls.moveTo;
console.log(
  `    добыто ${sim.harvested} (потолок 20/тик = 18000)` +
    ` | интентов сейчас ${intentsNow} (harvest ${sim.calls.harvest},` +
    ` transfer ${sim.calls.transfer}, moveTo ${sim.calls.moveTo})` +
    ` | было бы ${intentsOld} (сливов ${sim.oldTransfers})`,
);

check(
  "добыча держит потолок комнаты: не меньше 18/тик (90 %)",
  sim.harvested >= 900 * 20 * 0.9,
  String(sim.harvested),
);
check("потерь в drop нет", sim.dropped === 0, String(sim.dropped));
check(
  "сливов стало минимум в 5 раз меньше прежней логики",
  sim.oldTransfers >= sim.calls.transfer * 5,
  `${sim.calls.transfer} против ${sim.oldTransfers}`,
);
check(
  "интентов стало меньше минимум на 20 %",
  intentsNow <= intentsOld * 0.8,
  `${intentsNow} против ${intentsOld}`,
);
check(
  "майнер не простаивает: источник вычерпывается (переходы были)",
  sim.calls.moveTo > 0,
  String(sim.calls.moveTo),
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
