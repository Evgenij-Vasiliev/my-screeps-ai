"use strict";
/**
 * ===================================================
 * SCRIPTS/CPU.STREAM.MEASURE.JS — CPU по КАЖДОМУ тику через websocket
 * ===================================================
 * Зачем: HTTP-поллинг `api.memory.get` упирается в rate limit шарда (проверено
 * 01.10.2026: `node scripts/cpu.timeline.measure.js shard3 150 1200 ... quiet`
 * получил 43 из 150 проб, дальше «Rate limit exceeded»). WebSocket-подписка
 * `cpu` отдаёт событие на КАЖДЫЙ тик и лимиту не подчиняется, поэтому даёт
 * ровно то, чего не хватало: по-тиковый ряд CPU, а не среднее по окну.
 *
 * Read-only: подписка ничего не пишет ни в код, ни в Memory, ни в игровые
 * объекты. Единственные записи — локальный файл отчёта.
 *
 * Что в событии (проверяется прогоном, `--probe`): точный набор полей события
 * `cpu` зависит от шарда, поэтому скрипт печатает первое событие целиком.
 *
 * Запуск:
 *   node scripts/cpu.stream.measure.js [shard3] [секунды] [файл]
 *   node scripts/cpu.stream.measure.js --probe        # показать 5 событий
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const args = process.argv.slice(2);
const PROBE = args.includes("--probe");
const positional = args.filter(a => !a.startsWith("--"));
const SHARD = positional[0] || "shard3";
const SECONDS = +(positional[1] || 120);
const OUT = positional[2] || "/tmp/cpu-stream.json";

const api = new ScreepsAPI({ token: resolveTokenSource().token });

/** Печатает текстовую «кардиограмму» по собранному ряду и пишет JSON-отчёт. */
function report(rows) {
  const nums = rows.map(r => r.cpu).filter(v => typeof v === "number");
  if (!nums.length) {
    console.log("событий с числом CPU не пришло — формат события см. выше");
    return;
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const sorted = [...nums].sort((a, b) => a - b);
  const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mean = sum / nums.length;
  const max = sorted[sorted.length - 1];
  const outliers = nums.filter(v => v > mean * 1.5).length;

  console.log(`\nтиков собрано: ${nums.length}`);
  console.log(
    `CPU/тик: mean=${mean.toFixed(3)} min=${sorted[0].toFixed(3)} ` +
      `p50=${pct(0.5).toFixed(3)} p90=${pct(0.9).toFixed(3)} max=${max.toFixed(3)}`,
  );
  console.log(`сумма за прогон: ${sum.toFixed(2)} CPU`);
  console.log(
    `пиков >1.5x среднего: ${outliers} из ${nums.length} ` +
      `(${((outliers / nums.length) * 100).toFixed(1)} %)`,
  );

  // Гистограмма по 1 CPU
  const hist = {};
  for (const v of nums) {
    const b = Math.floor(v);
    hist[b] = (hist[b] || 0) + 1;
  }
  const lines = Object.keys(hist)
    .map(Number)
    .sort((a, b) => a - b)
    .map(b => {
      const n = hist[b];
      return `  ${String(b).padStart(3)}-${String(b + 1).padStart(3)} CPU  ` +
        `${"#".repeat(Math.max(1, Math.round((n / nums.length) * 60)))} ${n}`;
    });
  console.log("распределение:");
  console.log(lines.join("\n"));
}

(async () => {
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(`Шард ${SHARD}, окно ${PROBE ? "проба" : SECONDS + " c"}, файл ${OUT}`);

  await api.socket.connect();
  const rows = [];
  let seen = 0;

  api.socket.subscribe("cpu");
  api.socket.on("cpu", event => {
    const d = event && event.data ? event.data : {};
    seen++;
    if (PROBE && seen <= 5) {
      console.log(`событие #${seen}:`, JSON.stringify(d).slice(0, 500));
    }
    if (PROBE) return;
    // Имена полей у события могут отличаться от ожидаемых — складываем всё,
    // что похоже на расход тика, и печатаем формат по завершении.
    rows.push({
      cpu: typeof d.cpu === "number" ? d.cpu : undefined,
      memory: d.memory,
      bucket: d.bucket,
      time: d.time,
ready: d.ready,
    });
  });

  const seconds = PROBE ? 15 : SECONDS;
  const t0 = Date.now();
  const timer = setInterval(() => {
    const left = seconds - (Date.now() - t0) / 1000;
    if (left > 0) {
      process.stdout.write(`\r  событий: ${seen}, осталось ${left.toFixed(0)} c   `);
    }
  }, 1000);

  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  clearInterval(timer);

  if (PROBE) {
    console.log(`\nсобытий за ${seconds} c: ${seen}`);
  } else {
    report(rows);
    fs.writeFileSync(
      OUT,
      JSON.stringify({ shard: SHARD, seconds, samples: rows.length, rows }, null, 1),
    );
    console.log(`\nсырые данные: ${OUT} (${rows.length} событий)`);
  }
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});
