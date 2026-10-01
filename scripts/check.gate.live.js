"use strict";
/**
 * ===================================================
 * SCRIPTS/CHECK.GATE.LIVE.JS — проверка гейта профилирования на шарде
 * ===================================================
 * Read-only проверка ПОСЛЕ выгрузки Шага 7: действительно ли на шарде новый
 * код `cpuMonitor` и как ведёт себя гейт при текущей загрузке.
 *
 * Почему через Memory: POST-ответ консоли не отдаёт результат выражения
 * (проверено, docs/CPU-BASELINE.md:131-132) — «нет ответа» ≠ «нет кода».
 * Приём тот же, что в scripts/baseline.js: короткое выражение →
 * Memory.__bench_*, чтение через api.memory.get, удаление поля.
 *
 * Читается:
 *   1) Memory.cpuStats — count/average/bucket/creeps/subsystems (боевые поля);
 *   2) heap монитора `global.__cpuMonitor` — detail, profiledTicks, verboseIn,
 *      verboseNow и признак `"profiledTicks" in global.__cpuMonitor`
 *      (новое поле есть только в новом коде).
 *
 * Ничего не меняет, кроме временных Memory.keepTemp и Memory.__bench_gate.
 *
 * Запуск:
 *   node scripts/check.gate.live.js [shard3] [число проб] [пауза мс]
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SAMPLES = +(process.argv[3] || 8);
const PAUSE_MS = +(process.argv[4] || 5000);
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY = "__bench_gate";

/** Снимок боевых полей Memory.cpuStats и heap-полей монитора. */
const SNAPSHOT =
  `JSON.stringify({ t: Game.time, b: Game.cpu.bucket, lim: Game.cpu.limit,` +
  ` c: Memory.cpuStats && Memory.cpuStats.count,` +
  ` a: Memory.cpuStats && +Memory.cpuStats.average.toFixed(3),` +
  ` cr: Memory.cpuStats && Memory.cpuStats.creeps,` +
  ` sub: Memory.cpuStats && Memory.cpuStats.subsystems,` +
  ` h: global.__cpuMonitor ? { d: global.__cpuMonitor.detail,` +
  ` pt: global.__cpuMonitor.profiledTicks, vi: global.__cpuMonitor.verboseIn,` +
  ` vn: !!global.__cpuMonitor.verboseNow } : null,` +
  ` isNew: !!(global.__cpuMonitor && "profiledTicks" in global.__cpuMonitor) })`;

async function probe() {
  const command =
    `try { Memory.${KEY} = String(${SNAPSHOT}); } ` +
    `catch (e) { Memory.${KEY} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`команда ${command.length} > ${CONSOLE_LIMIT}`);
  }

  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(1500);
    const res = await api.memory.get(KEY, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(1500);
  }
  await api.console(`delete Memory.${KEY}`, SHARD);
  await sleep(400);

  if (value === undefined || value === null) {
    throw new Error("пустой ответ после 3 попыток");
  }
  return String(value);
}

(async () => {
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(`Шард ${SHARD}: ${SAMPLES} проб с паузой ${PAUSE_MS} мс\n`);
  console.log(
    "  тик         bucket  count  average  creeps  detail  profiled  verboseIn  новый код",
  );

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1200);

  const rows = [];
  try {
    for (let i = 0; i < SAMPLES; i++) {
      try {
        const d = JSON.parse(await probe());
        rows.push(d);
        console.log(
          `  ${String(d.t).padEnd(10)} ${String(d.b).padStart(6)}  ${String(d.c).padStart(5)}  ` +
            `${String(d.a).padStart(7)}  ${String(d.cr).padStart(6)}  ` +
            `${String(d.h && d.h.d).padStart(6)}  ${String(d.h && d.h.pt).padStart(8)}  ` +
            `${String(d.h && d.h.vi).padStart(9)}  ${d.isNew}`,
        );
      } catch (e) {
        console.log(`  проба ${i + 1}: ошибка — ${e && e.message ? e.message : e}`);
      }
      if (i < SAMPLES - 1) await sleep(PAUSE_MS);
    }
  } finally {
    await api.console(`delete Memory.${KEY}`, SHARD);
    await sleep(400);
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(400);
  }

  const fresh = rows.filter(r => r.isNew);
  console.log(
    `\nпроб: ${rows.length}; с новым полем profiledTicks (новый код): ${fresh.length}`,
  );
  if (!fresh.length) {
    console.log("ИТОГ: нового кода в heap нет — либо старая выгрузка, либо рестарт VM ещё не прошёл.");
    return;
  }

  const last = fresh[fresh.length - 1];
  console.log(
    `последняя проба: t=${last.t} bucket=${last.b} average=${last.a} ` +
      `detail=${last.h.d} profiledTicks=${last.h.pt} verboseIn=${last.h.vi} verboseNow=${last.h.vn}`,
  );
  console.log(
    `гейт ${last.h.d ? "ОТКРЫТ — подробный замер идёт" : "ЗАКРЫТ — работает грубый таймер"}` +
      ` (порог DETAIL_GATE_PCT × limit = ${last.lim * 0.8} CPU при лимите ${last.lim})`,
  );
  const pt = fresh.map(r => r.h.pt);
  console.log(
    `profiledTicks по пробам: min=${Math.min(...pt)} max=${Math.max(...pt)} (растёт до 10 внутри окна отчёта, потом сбрасывается)`,
  );
  if (last.sub && Object.keys(last.sub).length) {
    console.log("\nsubsystems последнего отчёта (CPU/тик на профилированный тик):");
    for (const [k, v] of Object.entries(last.sub).sort((x, y) => y[1] - x[1])) {
      console.log(`  ${k.padEnd(20)} ${v}`);
    }
  }
})();
