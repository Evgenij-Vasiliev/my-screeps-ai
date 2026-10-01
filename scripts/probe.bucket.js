"use strict";
/**
 * ===================================================
 * SCRIPTS/PROBE.BUCKET.JS — держится ли Game.cpu.bucket полным
 * ===================================================
 * Read-only замер к Шагу 7 («профилирование по требованию»). Отвечает на
 * вопрос, от которого зависит смысл гейта: если bucket на shard3 постоянно
 * равен 10000, то «подробный профиль только при полном bucket» не экономит
 * ничего — он включён всё время. Если bucket гуляет вниз, гейт что-то значит.
 *
 * Почему не ответом консоли: POST-ответ console не отдаёт результат
 * выражения (проверено, docs/CPU-BASELINE.md:131-132). Замер идёт тем же
 * приёмом, что scripts/baseline.js: короткое выражение → Memory.__bench_* →
 * пауза → чтение через api.memory.get → удаление поля.
 *
 * Ничего боевого не меняет: единственные записи — временные поля
 * Memory.keepTemp и Memory.__bench_bkt, оба снимаются в finally.
 *
 * Запуск:
 *   node scripts/probe.bucket.js [shard3] [число проб] [пауза мс]
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SAMPLES = +(process.argv[3] || 12);
const PAUSE_MS = +(process.argv[4] || 5000);
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY = "__bench_bkt";

/** Короткое выражение: снимок тика, bucket, среднего CPU и числа крипов. */
const SNAPSHOT =
  `JSON.stringify({ t: Game.time, b: Game.cpu.bucket,` +
  ` a: Memory.cpuStats && +Memory.cpuStats.average.toFixed(3),` +
  ` c: Memory.cpuStats && Memory.cpuStats.count,` +
  ` m: Memory.cpuStats && +((RawMemory.get()||"").length/1024).toFixed(1) })`;

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
  console.log("  тик          bucket   avg(CPU/тик)  count   Memory,КБ");

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1200);

  const buckets = [];
  try {
    for (let i = 0; i < SAMPLES; i++) {
      try {
        const d = JSON.parse(await probe());
        buckets.push(d.b);
        console.log(
          `  ${String(d.t).padEnd(11)} ${String(d.b).padStart(6)}   ` +
            `${String(d.a).padStart(12)}   ${String(d.c).padStart(5)}   ${String(d.m).padStart(9)}`,
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

  if (buckets.length) {
    const min = Math.min(...buckets);
    const max = Math.max(...buckets);
    const full = buckets.filter(b => b >= 10000).length;
    console.log(
      `\nИтог: bucket min=${min} max=${max}; полных (10000) проб ${full} из ${buckets.length}`,
    );
  } else {
    console.log("\nИтог: ни одной пробы — данных нет.");
  }
})();
