"use strict";
/**
 * ===================================================
 * MINER.BODY.TEST.JS — тело майнера считается по механикам движка
 * ===================================================
 * Правка 01.10.2026 (снижение CPU роли miner). Каждый интент стоит 0.2 CPU
 * (driver lib/runtime/runtime.js:60,69), а harvest бьёт по `2 x WORK` за вызов
 * (HARVEST_POWER, engine constants), поэтому ЧИСЛО harvest-интентов зависит
 * только от тела:
 *
 *     harvest-интентов на источник = 3000 / (2 x WORK)
 *     при 23 WORK — 66 ударов, при 35 WORK — 43.
 *
 * Проверяем то, что нельзя увидеть чтением константы: выбранное тело должно
 * давать меньше интентов, чем прежнее, И при этом держать потолок добычи
 * комнаты (2 источника x 3000 за ENERGY_REGEN_TIME 300 = 20 энергии/тик) на всех
 * реальных расстояниях между спотами (12-23 клетки) и при любом покрытии —
 * по дороге (rate 1) и без дороги (rate 2).
 *
 * Механики в симуляции — из движка:
 *   - усталость за шаг = (части кроме MOVE/CARRY + вес груза в частях CARRY) x rate
 *     (engine src/processor/intents/movement.js), восстановление 2 x MOVE за тик
 *     (engine src/processor/intents/creeps/tick.js);
 *   - `moveTo`/`move` при fatigue > 0 возвращают ERR_TIRED ДО интента, то есть
 *     тик ожидания бесплатен (docs/CPU-LOAD-ASSESSMENT.md);
 *   - harvest снимает min(source.energy, 2 x WORK), излишек сверх store движок
 *     сбрасывает на пол (`drop`, engine src/processor/intents/creeps/harvest.js);
 *   - источник наливается ЦЕЛИКОМ по таймеру через 300 тиков после первого
 *     снятия (engine src/processor/intents/sources/tick.js:9-12,22-27);
 *   - размер тела ограничен MAX_CREEP_SIZE = 50 частей.
 *
 * Запуск: node tests/miner.body.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

global.HARVEST_POWER = 2;
const { CREEP_BODIES } = require("../constants");

const SOURCE_CAP = 3000;
const REGEN = 300;
const INTENT = 0.2;
const MAX_PARTS = 50;
const ROOM_CAP = (2 * SOURCE_CAP) / REGEN; // 20 энергии/тик — потолок комнаты

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

/**
 * Прогон одного тела: майнер обслуживает два источника, переходит между
 * спотами, бьёт по 2 x WORK, сливает пачками, уходит порожняком.
 *
 * @param {{work:number,carry:number,move:number}} body
 * @param {{distance:number, ticks:number, rate:number}} o
 */
function simulate(body, o) {
  const take = body.work * HARVEST_POWER;
  const cap = body.carry * 50;
  const src = [
    { energy: SOURCE_CAP, nextRegen: null },
    { energy: SOURCE_CAP, nextRegen: null },
  ];
  const spots = [0, o.distance];

  let wp = 0;
  let pos = 0;
  let fatigue = 0;
  let store = 0;
  let harvested = 0;
  let dropped = 0;
  const calls = { harvest: 0, transfer: 0, moveTo: 0 };

  for (let t = 0; t < o.ticks; t++) {
    for (const s of src) {
      if (s.energy < SOURCE_CAP) {
        if (!s.nextRegen) s.nextRegen = t + REGEN;
        if (t >= s.nextRegen - 1) {
          s.nextRegen = null;
          s.energy = SOURCE_CAP;
        }
      }
    }

    if (pos !== spots[wp]) {
      if (fatigue === 0) {
        calls.moveTo++;
        fatigue += (body.work + Math.ceil(store / 50)) * o.rate;
        pos += Math.sign(spots[wp] - pos);
      }
    } else {
      const s = src[wp];
      const drained = s.energy <= 0;
      const amount = s.energy < take ? s.energy : take;
      const free = cap - store;

      if (!drained && free >= amount) {
        calls.harvest++;
        s.energy -= amount;
        store += amount;
        harvested += amount;
        if (store > cap) {
          dropped += store - cap;
          store = cap;
        }
      }
      if (store > 0 && (drained || cap - store < take)) {
        calls.transfer++;
        store = 0; // линк уносит энергию дальше (linkManager)
      }

      const other = 1 - wp;
      const otherRegenFirst =
        src[other].nextRegen !== null &&
        (src[wp].nextRegen === null || src[other].nextRegen < src[wp].nextRegen);
      if (drained && (src[other].energy > 0 || otherRegenFirst)) wp = other;
    }

    fatigue = Math.max(0, fatigue - 2 * body.move);
  }

  const intents = calls.harvest + calls.transfer + calls.moveTo;
  return {
    intents,
    harvested,
    perTick: +(harvested / o.ticks).toFixed(2),
    dropped,
    harvest: calls.harvest,
    transfer: calls.transfer,
    moveTo: calls.moveTo,
    cpuPerTick: +((intents * INTENT) / o.ticks).toFixed(4),
  };
}

const CURRENT = CREEP_BODIES.miner;
const OLD = { work: 23, carry: 10, move: 17 };
const DISTANCES = [12, 20, 23];
const TICKS = 1500;

// ── 1. Само тело ───────────────────────────────────────────────────────
console.log("1. Тело майнера из constants.js");
check(
  "тело ровно 50 частей (MAX_CREEP_SIZE)",
  CURRENT.work + CURRENT.carry + CURRENT.move === MAX_PARTS,
  String(CURRENT.work + CURRENT.carry + CURRENT.move),
);
check("WORK вырос против прежних 23", CURRENT.work > OLD.work, String(CURRENT.work));
check("MOVE не ноль (майнер обязан ходить между спотами)", CURRENT.move > 0, String(CURRENT.move));
check("CARRY не ноль (иначе harvest теряет энергию в drop)", CURRENT.carry > 0, String(CURRENT.carry));
check(
  "сравнение идёт с прежним телом {23,10,17}",
  OLD.work + OLD.carry + OLD.move === MAX_PARTS,
  String(OLD.work + OLD.carry + OLD.move),
);

// ── 2. Добыча держится на всех расстояниях и покрытиях ────────────────
console.log("\n2. Добыча: потолок комнаты 20/тик на 12/20/23 клетках, дорога и без дороги");
let worstPerTick = Infinity;
let worstDrop = 0;
for (const rate of [1, 2]) {
  for (const distance of DISTANCES) {
    const r = simulate(CURRENT, { distance, ticks: TICKS, rate });
    if (r.perTick < worstPerTick) worstPerTick = r.perTick;
    if (r.dropped > worstDrop) worstDrop = r.dropped;
    check(
      `rate ${rate}, ${distance} клеток: добыча ${r.perTick}/тик (потолок ${ROOM_CAP})`,
      r.perTick >= ROOM_CAP * 0.99,
      `${r.perTick}`,
    );
  }
}
check("минимальная добыча не ниже потолка", worstPerTick >= ROOM_CAP * 0.99, String(worstPerTick));
check("потерь в drop нет", worstDrop === 0, String(worstDrop));

// ── 3. Главное: интентов меньше, чем у прежнего тела ──────────────────
console.log("\n3. Число интентов: новое тело против прежнего {23,10,17}");
const rows = [];
for (const rate of [1, 2]) {
  for (const distance of DISTANCES) {
    const now = simulate(CURRENT, { distance, ticks: TICKS, rate });
    const before = simulate(OLD, { distance, ticks: TICKS, rate });
    rows.push({ rate, distance, now, before });
    console.log(
      `    rate ${rate}, ${String(distance).padStart(2)} кл: было ${before.intents} интентов` +
        ` (${before.cpuPerTick} CPU/тик), стало ${now.intents} (${now.cpuPerTick} CPU/тик)` +
        ` — ${(100 - (now.intents / before.intents) * 100).toFixed(0)} % меньше`,
    );
    check(
      `rate ${rate}, ${distance} кл: интентов меньше минимум на 20 %`,
      now.intents <= before.intents * 0.8,
      `${now.intents} против ${before.intents}`,
    );
    check(
      `rate ${rate}, ${distance} кл: добыча нового тела не ниже прежней`,
      now.harvested >= before.harvested,
      `${now.harvested} против ${before.harvested}`,
    );
  }
}

// ── 4. Механика: ударов ровно столько, сколько требует добыча ─────────
console.log("\n4. Механика удара: harvest-интентов = добыча / (2 x WORK)");
const take = CURRENT.work * HARVEST_POWER;
const r20 = simulate(CURRENT, { distance: 20, ticks: TICKS, rate: 1 });
check(
  `удары совпадают с добыча/(2 x WORK): ${r20.harvest} ≈ ${Math.round(r20.harvested / take)}`,
  Math.abs(r20.harvest - r20.harvested / take) <= 2,
  `${r20.harvest} против ${(r20.harvested / take).toFixed(1)}`,
);
check(
  "удар нового тела больше прежнего (меньше интентов на ту же энергию)",
  take > OLD.work * HARVEST_POWER,
  `${take} против ${OLD.work * HARVEST_POWER}`,
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
