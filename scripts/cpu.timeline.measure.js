"use strict";
/**
 * ===================================================
 * SCRIPTS/CPU.TIMELINE.MEASURE.JS — «кардиограмма» CPU по тикам
 * ===================================================
 * Отвечает на вопрос «почему CPU скачет»: снимает с шарда ВРЕМЕННОЙ РЯД
 * боевых полей `Memory.cpuStats` (их пишет cpuMonitor.js:241 раз в
 * CPU.REPORT_INTERVAL = 10 тиков) вместе с `Game.time` и bucket.
 *
 * Почему это работает как по-тиковый замер:
 *   - `Memory.cpuStats.total` — сумма CPU по тикам ТЕКУЩЕГО окна
 *     (cpuMonitor.js:189, сброс на CPU.AVERAGE_WINDOW = 100, cpuMonitor.js:205);
 *   - `Memory.cpuStats.count` — сколько тиков в этом окне;
 *   - значит, между двумя соседними отчётами разность
 *     (total2 - total1) / (count2 - count1) — это средний CPU ЗА ТЕ 10 ТИКОВ,
 *     а не сглаженное среднее по 100 тикам из `average`.
 *   - отчёты приходятся ровно на тики `Game.time % 10 === 0`
 *     (cpuMonitor.js:210), поэтому серию можно разложить по фазе
 *     `t % 30`, `t % 20` и увидеть вклад периодических работ
 *     (ремонт башен — `TOWER.REPAIR_INTERVAL` = 15, constants.js:30;
 *      рынок — `MARKET.INTERVAL` = 10, constants.js:177).
 *
 * Read-only: единственные записи — временные `Memory.keepTemp` и
 * `Memory.__bench_tl`, оба снимаются в finally. Игровых интентов нет:
 * замер не двигает крипов, не спавнит и не торгует.
 *
 * Запуск:
 *   node scripts/cpu.timeline.measure.js [shard3] [число проб] [пауза мс]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SAMPLES = +(process.argv[3] || 200);
const PAUSE_MS = +(process.argv[4] || 1200);
const CONSOLE_LIMIT = 1000;
const OUT = process.argv[5] || "/tmp/cpu-timeline.json";
// "quiet" — замер БЕЗ консольных команд: только чтение Memory через API.
// Зачем: консольная команда исполняется в том же изоляте, что и тик бота,
// и её CPU попадает в Game.cpu.getUsed() (драйвер: usedTime = wall + intents,
// https://github.com/screeps/driver/blob/master/lib/runtime/runtime.js
// функция global._start, usedTime). Частые пробы завышают измеряемый CPU.
// В тихом режиме одна команда в начале даёт опорный Game.time, дальше тик
// восстанавливается по счётчику Memory.cpuStats.count (он растёт на 1 за тик).
const QUIET = process.argv[6] === "quiet";

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY = "__bench_tl";

/**
 * Снимок: тик, bucket, окно отчёта, число крипов, подсистемы и heap-поля
 * монитора. Выражение держится коротким: консоль молча отбрасывает
 * команды длиннее ~1000 символов (docs/CPU-BASELINE.md:128-130).
 */
const SNAPSHOT =
  `JSON.stringify({t:Game.time,b:Game.cpu.bucket,` +
  `c:Memory.cpuStats&&Memory.cpuStats.count,` +
  `s:Memory.cpuStats&&+Memory.cpuStats.total.toFixed(4),` +
  `a:Memory.cpuStats&&+Memory.cpuStats.average.toFixed(4),` +
  `cr:Memory.cpuStats&&Memory.cpuStats.creeps,` +
  `sub:Memory.cpuStats&&Memory.cpuStats.subsystems,` +
  `pt:global.__cpuMonitor&&global.__cpuMonitor.profiledTicks,` +
  `rc:global.__cpuMonitor?Object.keys(global.__cpuMonitor.roleStats).length:null})`;

/** Тихая проба: только чтение Memory через API, без консольных команд. */
async function pollQuiet() {
  const res = await api.memory.get("cpuStats", SHARD);
  const d = res && res.data;
  if (!d) throw new Error("пустой Memory.cpuStats");
  return {
    c: d.count,
    s: +d.total.toFixed(4),
    a: +d.average.toFixed(4),
    cr: d.creeps,
    sub: d.subsystems,
    b: d.bucket,
  };
}

/** Сколько тиков прошло между двумя пробами (count растёт на 1 за тик,
 *  сбрасывается на CPU.AVERAGE_WINDOW = 100, cpuMonitor.js:205-208). */
function deltaTicks(prev, cur) {
  if (prev.c === undefined || cur.c === undefined) return null;
  const dc = cur.c - prev.c;
  return dc >= 0 ? dc : dc + 100;
}

/** Восстанавливает Game.time пробы по предыдущей: Δt = Δcount. */
function reconstructT(cur, prev) {
  const d = deltaTicks(prev, cur);
  return d === null ? cur.t : prev.t + d;
}

async function probe() {
  const command =
    `try { Memory.${KEY} = String(${SNAPSHOT}); } ` +
    `catch (e) { Memory.${KEY} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`команда ${command.length} > ${CONSOLE_LIMIT}`);
  }
  await api.console(command, SHARD);

  // Поле живёт до следующей записи (keepTemp подавляет уборку __*), поэтому
  // удалять его на каждой пробе не нужно — это вдвое меньше консольных команд.
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
  console.log(
    `Шард ${SHARD}: ${SAMPLES} проб, пауза ${PAUSE_MS} мс, файл ${OUT}\n`,
  );
  console.log("  #     тик          bkt   cnt   total    avg    крипы  pt");

  const rows = [];
  let anchor = null;
  try {
    if (QUIET) {
      // Опорный тик: три консольные команды на весь прогон (keepTemp, проба,
      // снятие keepTemp). Дальше — только чтение Memory через API.
      // keepTemp нужен потому, что иначе уборка empire.js:30-37 удалит поле
      // пробы раньше, чем скрипт успеет его прочитать.
      await api.console("Memory.keepTemp = true", SHARD);
      await sleep(1200);
      anchor = await probe();
      anchor.wall = Date.now();
      await api.console("delete Memory.keepTemp", SHARD);
      await sleep(400);
      await api.console(`delete Memory.${KEY}`, SHARD);
      await sleep(400);
      console.log(`опорный тик (quiet): t=${anchor.t} count=${anchor.c}\n`);
    } else {
      await api.console("Memory.keepTemp = true", SHARD);
      await sleep(1500);
    }

    for (let i = 0; i < SAMPLES; i++) {
      try {
        const d = QUIET ? await pollQuiet() : await probe();
        d.wall = Date.now();
        if (QUIET && anchor) d.t = reconstructT(d, rows.length ? rows[rows.length - 1] : anchor);
        if (QUIET && !rows.length) d.t = anchor.t + (deltaTicks(anchor, d) || 0);
        rows.push(d);
        console.log(
          `  ${String(i + 1).padStart(3)}  ${String(d.t).padEnd(11)} ${String(d.b).padStart(5)}  ` +
            `${String(d.c).padStart(4)}  ${String(d.s).padStart(8)}  ${String(d.a).padStart(7)}  ` +
            `${String(d.cr).padStart(5)}  ${String(d.pt === undefined ? "-" : d.pt).padStart(3)}`,
        );
      } catch (e) {
        console.log(`  проба ${i + 1}: ошибка — ${e && e.message ? e.message : e}`);
      }
    }
  } finally {
    if (!QUIET) {
      await api.console(`delete Memory.${KEY}`, SHARD);
      await sleep(400);
      await api.console("delete Memory.keepTemp", SHARD);
      await sleep(400);
    }
    fs.writeFileSync(
      OUT,
      JSON.stringify({ shard: SHARD, samples: rows.length, rows }, null, 1),
    );
    console.log(`\nсырые данные: ${OUT} (${rows.length} проб)`);
  }

  // ── Разбор: разности между отчётами ─────────────────────────────────
  // Отчёт — запись Memory.cpuStats на тике, кратном 10. Держим только
  // первое появление каждого нового значения count.
  const reports = [];
  for (const r of rows) {
    if (r.c === undefined || r.s === undefined) continue;
    if (!reports.length || reports[reports.length - 1].c !== r.c) {
      reports.push(r);
    }
  }

  const deltas = [];
  for (let i = 1; i < reports.length; i++) {
    const prev = reports[i - 1];
    const cur = reports[i];
    const dc = cur.c - prev.c;
    const ds = cur.s - prev.s;
    // dc <= 0 — окно сбросилось (AVERAGE_WINDOW) или отчёт потерян: не годится.
    if (dc <= 0) continue;
    deltas.push({ t: cur.t, dc, cpu: ds, perTick: ds / dc, sub: cur.sub });
  }

  if (!deltas.length) {
    console.log("разностей между отчётами нет — данных для разбора мало");
    return;
  }

  const perTick = deltas.map(d => d.perTick);
  const min = Math.min(...perTick);
  const max = Math.max(...perTick);
  const mean = perTick.reduce((a, b) => a + b, 0) / perTick.length;
  console.log(`\nокон разобрано: ${deltas.length} (dc: ${[...new Set(deltas.map(d => d.dc))].join(",")})`);
  console.log(
    `CPU/тик по окнам: min=${min.toFixed(3)} max=${max.toFixed(3)} mean=${mean.toFixed(3)} ` +
      `разброс max/min=${(max / min).toFixed(2)}x`,
  );

  // ── Фазовый разбор: попадает ли в окно тик ремонта башен (t % 15) ───
  // Окно отчёта покрывает тики [t-9 .. t]. Тик ремонта — кратный 15.
  const phase = {};
  for (const d of deltas) {
    const ph = d.t % 30;
    (phase[ph] = phase[ph] || []).push(d.perTick);
  }
  console.log("\nфаза отчёта (t % 30) против «есть ли в окне тик t % 15»:");
  for (const ph of Object.keys(phase).map(Number).sort((a, b) => a - b)) {
    const arr = phase[ph];
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const repair = (ph === 0 || ph === 20) ? "да" : "нет";
    console.log(
      `  t%30=${String(ph).padStart(2)}  окон ${String(arr.length).padStart(3)}  ` +
        `CPU/тик ${m.toFixed(3)}  (тик ремонта башен в окне: ${repair})`,
    );
  }

  // ── Вклад подсистем по фазам (подсистемы есть только у профилированных) ─
  const names = new Set();
  for (const d of deltas) if (d.sub) for (const k in d.sub) names.add(k);
  if (names.size) {
    console.log("\nсредний CPU/тик подсистемы по всем разобранным окнам:");
    const acc = {};
    for (const d of deltas) {
      if (!d.sub) continue;
      for (const k in d.sub) {
        acc[k] = acc[k] || { sum: 0, n: 0 };
        acc[k].sum += d.sub[k];
        acc[k].n++;
      }
    }
    for (const k of Object.keys(acc).sort((a, b) => acc[b].sum / acc[b].n - acc[a].sum / acc[a].n)) {
      console.log(`  ${k.padEnd(20)} ${(acc[k].sum / acc[k].n).toFixed(4)}  (окон ${acc[k].n})`);
    }
  }
})().catch(e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});
