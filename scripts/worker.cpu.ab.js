"use strict";
/**
 * ===================================================
 * SCRIPTS/WORKER.CPU.AB.JS — A/B: цена профиля против цены ролей
 * ===================================================
 * Вопрос: цифра `Memory.cpuStats.subsystems.worker` (0.93 CPU/тик) — это
 * стоимость воркеров или стоимость ВКЛЮЧЁННОГО поролевого профиля?
 *
 * Флаг `Memory.cpuMonitorVerbose = true` заставляет cpuMonitor мерить КАЖДОГО
 * крипа каждый тик (room/creeps.js:65-82), хотя штатное расписание —
 * 1 тик из CPU.VERBOSE_INTERVAL = 97 (constants/system.js:108).
 *
 * Схема: окно A с флагом как есть → окно B с verbose снятым → вернуть флаг
 * в исходное состояние. Единственные изменения на шарде — флаг профиля и
 * временное поле Memory.__bench_*, всё снимается в finally.
 *
 * Запуск: node scripts/worker.cpu.ab.js [shard3] [секунд на окно]
 * Пишет: /tmp/worker-cpu-ab.json
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const WINDOW_S = +(process.argv[3] || 240);
const OUT = process.argv[4] || "/tmp/worker-cpu-ab.json";
const CONSOLE_LIMIT = 1000;
const POLL_MS = 10000;
const PAUSE_MS = 2000;

const src = resolveTokenSource();
const api = new ScreepsAPI({ token: src.token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evalInGame(field, expression) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`выражение ${field}: ${command.length} > ${CONSOLE_LIMIT} символов`);
  }
  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(PAUSE_MS);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(PAUSE_MS);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(500);
  if (value === undefined || value === null) throw new Error(`пустой ответ для ${key}`);
  return String(value);
}

const SAMPLE_EXPR =
  `(()=>{const s=Memory.cpuStats||{},d=global.__workerDiag||{};` +
  `return [Game.time,s.average===undefined?"":s.average.toFixed(4),s.count,s.bucket,` +
  `s.creeps,JSON.stringify(s.subsystems||{}).replace(/"/g,""),` +
  `d.ticks||0,d.calls||0,d.noTask||0,d.scans||0,d.cpuTask||0,d.cpuExec||0,` +
  `d.cpuSample||0,Game.cpu.getUsed().toFixed(2)].join("|");})()`;

let savedVerbose = null;
let cleaned = false;

async function restore() {
  if (cleaned) return;
  cleaned = true;
  const cmd =
    savedVerbose === undefined
      ? "delete Memory.cpuMonitorVerbose"
      : `Memory.cpuMonitorVerbose = ${JSON.stringify(savedVerbose)}`;
  try {
    await api.console(cmd, SHARD);
    await api.console("delete Memory.__bench_ab", SHARD);
    await sleep(800);
    console.log(`\nФлаг cpuMonitorVerbose возвращён: ${cmd}`);
  } catch (e) {
    console.log(`  вернуть флаг не удалось: ${e.message}`);
  }
}

function parse(line) {
  const p = line.split("|");
  const sub = {};
  if (p[5]) {
    for (const kv of p[5].split(",")) {
      const [k, v] = kv.split(":");
      if (k) sub[k] = +v;
    }
  }
  return {
    time: +p[0],
    avg: p[1] ? +p[1] : null,
    count: +p[2],
    bucket: +p[3],
    creeps: +p[4],
    subsystems: sub,
    dTicks: +p[6],
    dCalls: +p[7],
    dNoTask: +p[8],
    dScans: +p[9],
    dCpuTask: +p[10],
    dCpuExec: +p[11],
    dCpuSample: +p[12],
    used: +p[13],
  };
}

/** Проба одного окна: точки раз в POLL_MS, уникальные по (total,count). */
async function window(label, seconds) {
  console.log(`\n=== Окно ${label}, ${seconds} с`);
  const points = [];
  const seen = new Set();
  const started = Date.now();

  while ((Date.now() - started) / 1000 < seconds) {
    try {
      const s = parse(await evalInGame("ab", SAMPLE_EXPR));
      const key = `${s.count}|${s.avg}|${s.dTicks}`;
      if (!seen.has(key) && s.avg !== null) {
        seen.add(key);
        points.push(s);
        const top = Object.entries(s.subsystems)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        console.log(`  t=${s.time} avg=${s.avg.toFixed(3)} cnt=${s.count} ${top}`);
      }
    } catch (e) {
      console.log(`  проба не удалась: ${e.message}`);
    }
    await sleep(POLL_MS);
  }

  const avg = points.length
    ? points.reduce((a, x) => a + x.avg, 0) / points.length
    : null;
  console.log(`  → среднее по окну: ${avg === null ? "нет проб" : avg.toFixed(3)} CPU/тик`);
  return { label, points, avg };
}

(async () => {
  console.log(`Шард ${SHARD}, окно ${WINDOW_S} с, токен: ${src.source} → ${OUT}`);

  const raw = await api.memory.get("cpuMonitorVerbose", SHARD);
  savedVerbose = raw && raw.data;
  console.log(`cpuMonitorVerbose до замера: ${savedVerbose === undefined ? "не задан" : savedVerbose}`);

  process.on("SIGINT", async () => {
    console.log("\nПрерывание — возвращаю флаг...");
    await restore();
    process.exit(130);
  });

  const ctx = await evalInGame(
    "ctx",
    `Game.shard.name+"|"+Game.time+"|"+Game.cpu.limit+"|"+Game.cpu.bucket+"|"+` +
      `Object.keys(Game.creeps).length+"|"+Object.keys(Game.rooms).length`,
  );
  console.log(`Контекст (шард|тик|лимит|bucket|крипов|комнат): ${ctx}`);

  // Окно A: как есть (с флагом, если он стоял).
  const a = await window(`A (cpuMonitorVerbose=${savedVerbose === true})`, WINDOW_S);

  // Окно B: флаг снят — профиль идёт по штатному расписанию (1 тик из 97).
  await api.console("Memory.cpuMonitorVerbose = false", SHARD);
  await sleep(1500);
  const b = await window("B (cpuMonitorVerbose=false)", WINDOW_S);

  await restore();

  const report = {
    shard: SHARD,
    capturedAt: new Date().toISOString(),
    context: ctx,
    savedVerbose: savedVerbose === undefined ? null : savedVerbose,
    windowSeconds: WINDOW_S,
    A: { avg: a.avg, points: a.points },
    B: { avg: b.avg, points: b.points },
    delta: a.avg !== null && b.avg !== null ? +(a.avg - b.avg).toFixed(4) : null,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

  console.log(`\n=== ИТОГ`);
  console.log(`A (профиль включён): ${a.avg === null ? "?" : a.avg.toFixed(3)} CPU/тик`);
  console.log(`B (профиль выключен): ${b.avg === null ? "?" : b.avg.toFixed(3)} CPU/тик`);
  if (report.delta !== null) {
    console.log(`Разница: ${report.delta.toFixed(3)} CPU/тик — столько стоит включённый профиль`);
  }
  console.log(`Сырые точки: ${OUT}`);
})().catch(async e => {
  console.error("ОШИБКА:", e.message);
  await restore();
  process.exit(1);
});
