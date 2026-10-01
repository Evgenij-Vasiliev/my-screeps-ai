"use strict";
/**
 * ===================================================
 * SCRIPTS/TASK.SYSTEM.OBSERVE.JS — наблюдение за task-системой по API
 * ===================================================
 * Отвечает на вопросы после выгрузки, НЕ трогая консоль шарда (только
 * `api.memory.get`):
 *   - сколько задач в очереди и сколько из них свободно (Memory.rooms[*].tasks);
 *   - сколько всего задач поставлено (`Memory._taskIdSeq`) — по разнице видно
 *     частоту addTask в тиках;
 *   - что показывает монитор: `Memory.cpuStats.average` и `subsystems`
 *     (в том числе `gen.*`, если включён `Memory.cpuGenProfile`).
 *
 * Зачем отдельный скрипт: консольные команды на shard3 упираются в rate limit
 * API (проверено 30.09.2026: «Rate limit exceeded, retry after …»), а
 * `api.memory.get` продолжает работать. Наблюдение идёт минутами, поэтому
 * консоль тратится только на включение/снятие флагов замера.
 *
 * Запуск:
 *   node scripts/task.system.observe.js [shard3] [минут] [пауза с] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const MINUTES = +(process.argv[3] || 20);
const PAUSE_S = +(process.argv[4] || 60);
const OUT = process.argv[5] || "/tmp/task-system-observe.json";

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Одна проба: cpuStats + счётчик поставленных задач + очереди. */
async function sample() {
  const stats = (await api.memory.get("cpuStats", SHARD)).data || {};
  const seq = (await api.memory.get("_taskIdSeq", SHARD)).data;
  const rooms = (await api.memory.get("rooms", SHARD)).data || {};

  const queues = [];
  let totalTasks = 0;
  let totalFree = 0;
  for (const r in rooms) {
    const tasks = rooms[r].tasks || {};
    for (const type in tasks) {
      const q = tasks[type];
      if (!q || !q.length) continue;
      const free = q.filter(t => t && !t.reservedBy).length;
      totalTasks += q.length;
      totalFree += free;
      queues.push({ room: r, type, len: q.length, free });
    }
  }

  return {
    wall: Date.now(),
    cpuAverage: stats.average,
    cpuCount: stats.count,
    bucket: stats.bucket,
    creeps: stats.creeps,
    subsystems: stats.subsystems || {},
    taskIdSeq: seq,
    totalTasks,
    totalFree,
    queues,
  };
}

(async () => {
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(
    `Шард ${SHARD}: наблюдение ${MINUTES} мин, проба раз в ${PAUSE_S} с → ${OUT}\n`,
  );

  const rows = [];
  const deadline = Date.now() + MINUTES * 60000;

  while (true) {
    try {
      const s = await sample();
      rows.push(s);
      const sub = s.subsystems || {};
      const gen = Object.keys(sub)
        .filter(k => k.indexOf("gen.") === 0)
        .map(k => `${k.slice(4)}=${sub[k]}`)
        .join(" ");
      console.log(
        `  ${new Date(s.wall).toISOString().slice(11, 19)}  ` +
          `avg=${s.cpuAverage === undefined ? "n/a" : s.cpuAverage.toFixed(2)} ` +
          `(count ${s.cpuCount}) bkt=${s.bucket} | ` +
          `taskManager=${sub.taskManager} taskCompact=${sub.taskCompact} | ` +
          `задач ${s.totalTasks} (свободных ${s.totalFree}) seq=${s.taskIdSeq}`,
      );
      if (gen) console.log(`      gen: ${gen}`);
    } catch (e) {
      console.log(`  проба: ошибка — ${e && e.message ? e.message.slice(0, 120) : e}`);
    }

    if (Date.now() >= deadline) break;
    await sleep(PAUSE_S * 1000);
  }

  // ── Итог: частота addTask по счётчику _taskIdSeq и средний CPU окна ──
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first && last && last.taskIdSeq !== undefined) {
    const dSeq = last.taskIdSeq - first.taskIdSeq;
    const dTicks = (last.cpuCount || 0) - (first.cpuCount || 0);
    console.log(
      `\nза наблюдение: поставлено задач ${dSeq}; ` +
        `тиков по счётчику окна ${dTicks > 0 ? dTicks : "n/a (окно перезапускалось)"}; ` +
        `в очереди ${first.totalTasks} → ${last.totalTasks} задач, ` +
        `свободных ${first.totalFree} → ${last.totalFree}`,
    );
  }

  fs.writeFileSync(OUT, JSON.stringify({ shard: SHARD, rows }, null, 1));
  console.log(`\nсырые данные: ${OUT} (${rows.length} проб)`);
})().catch(e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});
