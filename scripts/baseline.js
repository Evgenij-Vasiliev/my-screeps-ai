"use strict";
/**
 * ===================================================
 * SCRIPTS/BASELINE.JS — снятие baseline-метрик с живого шарда
 * ===================================================
 * Шаг 0 плана docs/CPU-OPTIMIZATION-PLAN.md.
 *
 * Работает БЕЗ выгрузки кода: выполняет замерные выражения в консоли
 * шарда, складывает результат во временное поле Memory.__bench_* и читает
 * его обратно через API. По завершении временные поля удаляются, поэтому
 * боевая Memory не засоряется.
 *
 * ВАЖНО (проверено на живом шарде): консольная команда длиннее ~1024
 * символов МОЛЧА отбрасывается — ответ ok, но выражение не выполняется.
 * Поэтому каждое выражение ниже держится заметно короче лимита, а
 * результат пишется через try/catch: ошибка не теряется, а попадает в
 * тот же ответ строкой "ERR: ...".
 *
 * Безопасность: боевой код не меняется, каждое выражение — отдельная
 * консольная команда со своим бюджетом CPU.
 *
 * Запуск:
 *   node scripts/baseline.js            # shard3 по умолчанию
 *   node scripts/baseline.js shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;

/** Предел длины консольной команды, проверенный на живом шарде. */
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Выполняет выражение в консоли шарда и возвращает строку с результатом.
 * Ошибка выражения не теряется: она возвращается строкой "ERR: <текст>".
 *
 * @param {string} field имя временного поля в Memory (без префикса)
 * @param {string} expression выражение, возвращающее строку
 */
async function evalInGame(field, expression) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;

  if (command.length > CONSOLE_LIMIT) {
    // Лучше явная ошибка здесь, чем молча пустой ответ с шарда.
    throw new Error(
      `выражение ${field} длиной ${command.length} > ${CONSOLE_LIMIT} символов`,
    );
  }

  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(PAUSE_MS);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    // Консоль изредка молча теряет команду — повторяем, а не падаем.
    await sleep(PAUSE_MS);
  }

  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);

  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

/** Печатает результат шага; ошибка шага не прерывает остальные шаги. */
async function section(title, fn) {
  console.log(`\n=== ${title}`);
  try {
    const out = await fn();
    if (out !== undefined) console.log(out);
    return out;
  } catch (e) {
    console.log(`  ОШИБКА: ${e.message}`);
    return undefined;
  }
}

function fail(msg) {
  throw new Error(msg);
}

/* ── 1. Общее состояние шарда ─────────────────────────────────────────── */
async function probeGeneral() {
  const raw = await evalInGame(
    "general",
    `JSON.stringify({ t: Game.time, lim: Game.cpu.limit, bkt: Game.cpu.bucket,
      creeps: Object.keys(Game.creeps).length,
      rooms: Object.keys(Game.rooms).filter(n => Game.rooms[n].controller && Game.rooms[n].controller.my).length,
      spawns: Object.keys(Game.spawns).length,
      memBytes: (RawMemory.get() || "").length,
      avg: Memory.cpuStats && Memory.cpuStats.average,
      cnt: Memory.cpuStats && Memory.cpuStats.count })`,
  );
  if (raw.startsWith("ERR:")) fail(raw);
  const d = JSON.parse(raw);
  d.memKb = +(d.memBytes / 1024).toFixed(1);
  d.cpuPerTick = +(d.avg || 0).toFixed(3);
  d.cpuPerCreep = d.creeps > 0 ? +((d.avg || 0) / d.creeps).toFixed(3) : null;
  d.overLimit = +((d.avg || 0) - d.lim).toFixed(3);
  console.log(JSON.stringify(d, null, 2));
  return d;
}

/* ── 2. Стоимость игровых API по отдельности ──────────────────────────── */
async function probeApiCosts() {
  const out = {};

  const a = await evalInGame(
    "api1",
    `(() => { const u = () => Game.cpu.getUsed(), t0 = u();
      for (let i = 0; i < 500; i++) u();
      return (u() - t0).toFixed(4); })()`,
  );
  if (a.startsWith("ERR:")) fail(a);
  out.getUsed_x500 = +a;
  out.getUsed_each = +(a / 500).toFixed(6);

  const b = await evalInGame(
    "api2",
    `(() => { const u = () => Game.cpu.getUsed(), c = Object.values(Game.rooms).find(r => r.controller && r.controller.my);
      const id = c.controller.id; let t0 = u();
      for (let i = 0; i < 200; i++) Game.getObjectById(id);
      const t1 = u(); for (let i = 0; i < 200; i++) Object.values(Game.creeps).length;
      return JSON.stringify({ getObjectById: +(t1 - t0).toFixed(4), valuesCreeps: +(u() - t1).toFixed(4) }); })()`,
  );
  if (b.startsWith("ERR:")) fail(b);
  Object.assign(out, JSON.parse(b));
  out.getObjectById_each = +(out.getObjectById / 200).toFixed(6);
  out.valuesCreeps_each = +(out.valuesCreeps / 200).toFixed(6);

  const c = await evalInGame(
    "api3",
    `(() => { const u = () => Game.cpu.getUsed(), r = Object.values(Game.rooms).find(x => x.controller && x.controller.my);
      let t0 = u(); const all = r.find(FIND_STRUCTURES); const cold = u() - t0;
      t0 = u(); for (let i = 0; i < 20; i++) r.find(FIND_STRUCTURES); const cached = u() - t0;
      t0 = u(); for (let i = 0; i < 20; i++) Object.values(Game.rooms); const rooms = u() - t0;
      return JSON.stringify({ n: all.length, cold: +cold.toFixed(4), cached: +cached.toFixed(4), rooms: +rooms.toFixed(4) }); })()`,
  );
  if (c.startsWith("ERR:")) fail(c);
  Object.assign(out, JSON.parse(c));
  out.findStructures_cached_each = +(out.cached / 20).toFixed(6);
  out.valuesRooms_each = +(out.rooms / 20).toFixed(6);

  const e = await evalInGame(
    "api4",
    `(() => { const u = () => Game.cpu.getUsed(), t0 = u(); const s = RawMemory.get();
      const g = u() - t0; return JSON.stringify({ bytes: (s || "").length, cost: +g.toFixed(4) }); })()`,
  );
  if (e.startsWith("ERR:")) fail(e);
  Object.assign(out, JSON.parse(e));

  console.log(JSON.stringify(out, null, 2));
  console.log(
    `  → getUsed() ${out.getUsed_each} CPU; getObjectById ${out.getObjectById_each}; ` +
      `Object.values(Game.creeps) ${out.valuesCreeps_each}; room.find(cached) ${out.findStructures_cached_each}; ` +
      `Object.values(Game.rooms) ${out.valuesRooms_each}`,
  );
  return out;
}

/* ── 3. Стоимость рынка — главная гипотеза плана ──────────────────────── */
async function probeMarket() {
  const out = {};

  const a = await evalInGame(
    "mkt1",
    `(() => { const u = () => Game.cpu.getUsed(), t0 = u();
      const o = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_ENERGY });
      const first = u() - t0; t0 = u();
      Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_ENERGY });
      return JSON.stringify({ n: o.length, first: +first.toFixed(4), cached: +(u() - t0).toFixed(4) }); })()`,
  );
  if (a.startsWith("ERR:")) fail(a);
  Object.assign(out, JSON.parse(a));

  const b = await evalInGame(
    "mkt2",
    `(() => { const u = () => Game.cpu.getUsed(), t0 = u();
      const o = Game.market.getAllOrders({ type: ORDER_BUY, resourceType: RESOURCE_UTRIUM });
      const first = u() - t0; t0 = u();
      Game.market.getAllOrders({ type: ORDER_SELL, resourceType: RESOURCE_ENERGY });
      return JSON.stringify({ utriumOrders: o.length, utrium: +first.toFixed(4), sellEnergy: +(u() - t0).toFixed(4) }); })()`,
  );
  if (b.startsWith("ERR:")) fail(b);
  Object.assign(out, JSON.parse(b));

  const c = await evalInGame(
    "mkt3",
    `JSON.stringify({ myOrders: Object.keys(Game.market.orders || {}).length,
      terminals: Object.values(Game.rooms).filter(r => r.terminal && r.terminal.my).length,
      credits: Game.market.credits })`,
  );
  if (c.startsWith("ERR:")) fail(c);
  Object.assign(out, JSON.parse(c));

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ── 4. Размер Memory по секциям ──────────────────────────────────────── */
async function probeMemorySplit() {
  const out = {};

  const a = await evalInGame(
    "mem1",
    `(() => { const o = {}; for (const k of Object.keys(Memory)) { let s = -1;
      try { const j = JSON.stringify(Memory[k]); s = j === undefined ? -2 : j.length; } catch (e) {}
      o[k] = s; } return JSON.stringify(o); })()`,
  );
  if (a.startsWith("ERR:")) fail(a);
  out.top = JSON.parse(a);

  const b = await evalInGame(
    "mem2",
    `(() => { const o = {}; const R = Memory.rooms || {};
      for (const k of Object.keys(R)) o[k] = JSON.stringify(R[k]).length;
      return JSON.stringify(o); })()`,
  );
  if (b.startsWith("ERR:")) fail(b);
  out.rooms = JSON.parse(b);

  const c = await evalInGame(
    "mem3",
    `(() => { const o = {}; const R = Memory.rooms || {};
      for (const k of Object.keys(R)) { const t = R[k].tasks || {}; let n = 0, s = 0;
        for (const q of Object.keys(t)) { n += t[q].length; s += JSON.stringify(t[q]).length; }
        o[k] = { tasks: n, bytes: s, cache: R[k].structureCache ? Object.keys(R[k].structureCache).length : 0 }; }
      return JSON.stringify(o); })()`,
  );
  if (c.startsWith("ERR:")) fail(c);
  out.taskQueues = JSON.parse(c);

  const d = await evalInGame(
    "mem4",
    `(() => { const k = Object.keys(Memory.creeps || {}), o = { n: k.length, bytes: 0, withTask: 0 };
      for (const c of k) { o.bytes += JSON.stringify(Memory.creeps[c]).length; if (Memory.creeps[c].task) o.withTask++; }
      return JSON.stringify(o); })()`,
  );
  if (d.startsWith("ERR:")) fail(d);
  out.creepMemory = JSON.parse(d);

  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ── 5. Повторная выборка CPU/тик для устойчивости оценки ─────────────── */
async function probeAgain(seconds) {
  await sleep(seconds * 1000);
  const raw = await evalInGame(
    "again",
    `JSON.stringify({ t: Game.time, avg: Memory.cpuStats && Memory.cpuStats.average, cnt: Memory.cpuStats && Memory.cpuStats.count, bkt: Game.cpu.bucket })`,
  );
  if (raw.startsWith("ERR:")) fail(raw);
  const d = JSON.parse(raw);
  console.log(JSON.stringify(d, null, 2));
  return d;
}

/* ── main ─────────────────────────────────────────────────────────────── */
(async () => {
  const { source } = resolveTokenSource();
  console.log(`Baseline-замеры, шард ${SHARD} (токен из: ${source})`);

  // Замеры кладут результат в Memory.__bench_*, а боевой empire.js вычищает
  // временные поля каждый тик. На время замеров уборку выключаем.
  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  const general = await section("1. Общее состояние", probeGeneral);
  const apiCosts = await section("2. Стоимость игровых API", probeApiCosts);
  const market = await section("3. Стоимость рынка", probeMarket);
  const memory = await section("4. Размер Memory по секциям", probeMemorySplit);
  const again = await section("5. Контрольная выборка CPU/тик (через 15 c)", () =>
    probeAgain(15),
  );

  await section("Очистка временных полей", async () => {
    await api.console("delete Memory.keepTemp", SHARD);
    await api.console(
      "delete Memory.__probe; delete Memory.__probe2; delete Memory.__bench; delete Memory.__bench_general;",
      SHARD,
    );
    return "временные поля удалены";
  });

  const report = {
    capturedAt: new Date().toISOString(),
    shard: SHARD,
    general,
    apiCosts,
    market,
    memory,
    again,
  };
  const fs = require("fs");
  const path = require("path");
  const outFile = path.join(__dirname, "..", "docs", "cpu-baseline.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nОтчёт сохранён: ${outFile}`);
  console.log("Готово.");
  process.exit(0);
})().catch(e => {
  console.log("КРИТИЧЕСКАЯ ОШИБКА:", e.message);
  process.exit(1);
});
