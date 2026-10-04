"use strict";
/**
 * ===================================================
 * SCRIPTS/CPU.PEAKS.MEASURE.JS — пики CPU по подсистемам за тик
 * ===================================================
 * Отвечает на вопрос «насколько высок скачок»: `Memory.cpuStats.subsystems`
 * хранит СРЕДНЕЕ по окну, а heap монитора хранит ещё и МАКСИМУМ за тик —
 * `g.roleStats[role].max` (cpuMonitor.js:212-216: `if (used > s.max) s.max = used`).
 * Это единственная доступная снаружи величина, которая показывает стоимость
 * ОДНОГО тика, а не среднее по десяти.
 *
 * Значения сбрасываются на каждом отчёте (Game.time % 10 === 0,
 * cpuMonitor.js:210 и :249), поэтому проба идёт чаще отчёта и копит набор
 * окон; для каждого окна печатаются максимумы по подсистемам.
 *
 * Read-only: пишет только `Memory.keepTemp` и `Memory.__bench_pk`, оба
 * снимаются в finally. Игровых интентов нет.
 *
 * Запуск:
 *   node scripts/cpu.peaks.measure.js [shard3] [число проб] [пауза мс] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SAMPLES = +(process.argv[3] || 90);
const PAUSE_MS = +(process.argv[4] || 1500);
const OUT = process.argv[5] || "/tmp/cpu-peaks.json";
// Режимы (третий аргумент, можно комбинировать: "v", "g", "s"):
//   v — поролевой замер крипов (Memory.cpuMonitorVerbose);
//   g — замер КАЖДОГО генератора задач (Memory.cpuGenProfile, см.
//       room.manager.js — цена одного генератора из 30 вызовов за тик);
//   s — замер ЧАСТЕЙ spawnManager (Memory.cpuSpawnProfile, см.
//       spawn.manager.js — ключи spawn.find / spawn.countRoles /
//       spawn.quotaLoop в Memory.cpuStats.subsystems).
// Имена ролей этого бота (worker, miner, linkWorker), имена генераторов
// (gen.*) и части spawnManager (spawn.*) не совпадают с именами подсистем,
// поэтому смешения пространств имён, о котором предупреждает cpuMonitor.js,
// здесь нет.
// Все флаги снимаются в finally.
const MODE = String(process.argv[6] || "").toLowerCase();
const VERBOSE = MODE.includes("v");
const GENPROF = MODE.includes("g");
const SPROF = MODE.includes("s");
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = "__bench_pk";

/**
 * Снимок: тик, окно отчёта, сумма окна, максимумы по подсистемам за тик и
 * средние по окну (для сверки) + profiledTicks.
 */
const SNAPSHOT =
  `(()=>{const g=global.__cpuMonitor||{},rs=g.roleStats||{},mx={},sm={};` +
  `for(const k in rs){mx[k]=+rs[k].max.toFixed(4);sm[k]=+rs[k].sum.toFixed(4);}` +
  `return JSON.stringify({t:Game.time,c:(Memory.cpuStats||{}).count,` +
  `s:(Memory.cpuStats||{}).total,a:(Memory.cpuStats||{}).average,` +
  `pt:g.profiledTicks,st:g.stats?+g.stats.total.toFixed(4):null,` +
  `sc:g.stats?g.stats.count:null,mx,sm})})()`;

async function probe() {
  const command =
    `try { Memory.${KEY} = String(${SNAPSHOT}); } ` +
    `catch (e) { Memory.${KEY} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`команда ${command.length} > ${CONSOLE_LIMIT}`);
  }
  await api.console(command, SHARD);
  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(PAUSE_MS);
    const res = await api.memory.get(KEY, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
  }
  if (value === undefined || value === null) throw new Error("пустой ответ пробы");
  return JSON.parse(String(value));
}

(async () => {
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(`Шард ${SHARD}: ${SAMPLES} проб, пауза ${PAUSE_MS} мс → ${OUT}\n`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);
  if (VERBOSE) {
    await api.console("Memory.cpuMonitorVerbose = true", SHARD);
    await sleep(1500);
    console.log("поролевой замер включён (Memory.cpuMonitorVerbose = true)");
  }
  if (GENPROF) {
    await api.console("Memory.cpuGenProfile = true", SHARD);
    await sleep(1500);
    console.log("замер генераторов включён (Memory.cpuGenProfile = true)");
  }
  if (SPROF) {
    await api.console("Memory.cpuSpawnProfile = true", SHARD);
    await sleep(1500);
    console.log("замер частей spawnManager включён (Memory.cpuSpawnProfile = true)");
  }

  const rows = [];
  try {
    for (let i = 0; i < SAMPLES; i++) {
      try {
        const d = await probe();
        rows.push(d);
        const top = Object.entries(d.mx || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        console.log(
          `  ${String(i + 1).padStart(3)}  t=${String(d.t).padEnd(11)} c=${String(d.c).padStart(3)} ` +
            `sum=${String(d.s).padStart(8)} pt=${String(d.pt).padStart(2)} | max/тик: ${top}`,
        );
      } catch (e) {
        console.log(`  проба ${i + 1}: ошибка — ${e && e.message ? e.message : e}`);
      }
    }
  } finally {
    await api.console(`delete Memory.${KEY}`, SHARD);
    await sleep(400);
    if (VERBOSE) {
      await api.console("delete Memory.cpuMonitorVerbose", SHARD);
      await sleep(600);
    }
    if (GENPROF) {
      await api.console("delete Memory.cpuGenProfile", SHARD);
      await sleep(600);
    }
    if (SPROF) {
      await api.console("delete Memory.cpuSpawnProfile", SHARD);
      await sleep(600);
    }
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(400);
    fs.writeFileSync(
      OUT,
      JSON.stringify({ shard: SHARD, samples: rows.length, rows }, null, 1),
    );
  }

  // ── Итог: максимум за тик, среднее по окну и фаза максимума (t % 30) ──
  // Фаза важна: ремонт башен идёт на тиках t % 15 === 0 (role.tower.js:29),
  // рынок — на t % 10 === 0 (market.manager.js:268), отчёт монитора — тоже
  // на t % 10 === 0 (cpuMonitor.js:210). Если максимум подсистемы попадает
  // только в t % 30 == 0 или 20, это тик ремонта башен.
  const best = {};
  const acc = {};
  for (const r of rows) {
    const pt = r.pt || 0;
    for (const k in r.mx || {}) {
      if (!best[k] || r.mx[k] > best[k].v) {
        best[k] = { v: r.mx[k], t: r.t, phase: r.t % 30 };
      }
      if (pt > 0) {
        acc[k] = acc[k] || { sum: 0, pt: 0, wins: 0 };
        acc[k].sum += r.sm[k] || 0;
        acc[k].pt += pt;
        acc[k].wins++;
      }
    }
  }
  console.log(
    "\nподсистема/роль        max за тик   средн.за окно   окон   фаза max(t%30)",
  );
  for (const k of Object.keys(best).sort((a, b) => best[b].v - best[a].v)) {
    const b = best[k];
    const a = acc[k];
    const mean = a && a.pt ? (a.sum / a.pt).toFixed(4) : "n/a";
    console.log(
      `  ${k.padEnd(20)} ${String(b.v).padStart(8)}  ${String(mean).padStart(12)}  ` +
        `${String(a ? a.wins : 0).padStart(5)}   ${b.phase} (t=${b.t})\n`,
    );
  }
  // Фазовое распределение максимумов towers: где именно случается пик.
  const tw = rows.filter(r => r.mx && r.mx.towers !== undefined && r.mx.towers > 0.5);
  const byPhase = {};
  for (const r of tw) byPhase[r.t % 30] = (byPhase[r.t % 30] || 0) + 1;
  if (tw.length) {
    console.log(
      `пиков towers (>0.5 CPU за тик): ${tw.length}; по фазе t%30: ` +
        JSON.stringify(byPhase) +
        "  (ремонт башен — t%15==0, то есть фазы 0 и 20)",
    );
  }
  console.log(`\nсырые данные: ${OUT} (${rows.length} проб)`);
})().catch(e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});
