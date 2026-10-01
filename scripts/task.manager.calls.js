"use strict";
/**
 * ===================================================
 * SCRIPTS/TASK.MANAGER.CALLS.JS — сколько вызовов task.manager за тик
 * ===================================================
 * Цена задачи = «стоимость одного вызова» × «число вызовов за тик». Первое
 * мерит `scripts/task.manager.bench.js`; этот скрипт даёт второе — точные
 * счётчики вызовов на живом шарде.
 *
 * КАК. Экспорт модуля `task.manager` оборачивается счётчиками ПРЯМО В КОНСОЛИ
 * шарда: бот вызывает `taskManager.getNextTask(...)`, то есть берёт функцию из
 * объекта модуля в момент вызова, — обёртка видна боту. Обёртка только считает
 * и делегирует оригиналу, поведение не меняется; оригиналы лежат в
 * `global.__tmOrig` и возвращаются на место в finally (проверяется отдельно).
 *
 * ПОЧЕМУ READ-ONLY. Ни одна обёртка не пишет в `Memory` и не даёт интентов:
 * она вызывает ровно ту же функцию с теми же аргументами. В `Memory` за время
 * замера живут только временные поля `__bench_*` и флаг `Memory.keepTemp`,
 * оба снимаются в finally.
 *
 * Запуск:
 *   node scripts/task.manager.calls.js [shard3] [тиков наблюдения] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const TICKS = +(process.argv[3] || 30);
const OUT = process.argv[4] || "/tmp/task-manager-calls.json";
const PAUSE_MS = 3000;
const CONSOLE_LIMIT = 1000;
const TIMEOUT_MS = 600000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Имена функций менеджера, которые оборачиваются счётчиком. */
const NAMES = [
  "getNextTask",
  "getTaskById",
  "reserveTask",
  "releaseTask",
  "completeTask",
  "removeTask",
  "hasDuplicate",
  "addTask",
  "compactAll",
];

const INSTALL =
  `(()=>{const tm=require("task.manager");if(global.__tmOrig)return "already";` +
  `const o={},n={},K=${JSON.stringify(NAMES)};global.__tmOrig=o;` +
  `global.__tmc={t0:Game.time,n:n};` +
  `for(const k of K){o[k]=tm[k];tm[k]=function(a,b,c,d){n[k]=(n[k]||0)+1;` +
  `return o[k](a,b,c,d);};}return "on";})()`;

const UNINSTALL =
  `(()=>{const tm=require("task.manager");if(!global.__tmOrig)return "off";` +
  `for(const k in global.__tmOrig)tm[k]=global.__tmOrig[k];` +
  `delete global.__tmOrig;const c=global.__tmc;delete global.__tmc;` +
  `return JSON.stringify({off:1,wrapped:String(tm.getNextTask).indexOf("__tmc")>=0,` +
  `t0c:c?{t0:c.t0,n:c.n}:null})})()`;

const PROBE =
  `(()=>{const g=global.__taskHeap||{},c=global.__tmc||{n:{}};` +
  `return JSON.stringify({t:Game.time,n:c.n,q:Object.keys(g.queues||{}).length,` +
  `k:Object.keys(g.keys||{}).length,i:Object.keys(g.inited||{}).length,` +
  `a:(Memory.cpuStats||{}).average,` +
  `tm:((Memory.cpuStats||{}).subsystems||{}).taskManager,` +
  `cr:(Memory.cpuStats||{}).creeps})})()`;

/** Отправляет команду и, при необходимости, читает результат из Memory. */
async function exec(command, { key = null, tries = 3 } = {}) {
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`команда ${command.length} > ${CONSOLE_LIMIT} символов`);
  }
  if (!key) {
    await api.console(command, SHARD);
    await sleep(1200);
    return null;
  }
  const field = `__bench_${key}`;
  const wrapped =
    `try { Memory.${field} = String(${command}); } ` +
    `catch (e) { Memory.${field} = "ERR: " + e.message; }`;
  if (wrapped.length > CONSOLE_LIMIT) {
    throw new Error(`обёрнутая команда ${wrapped.length} > ${CONSOLE_LIMIT}`);
  }
  let value;
  for (let attempt = 1; attempt <= tries; attempt++) {
    await api.console(wrapped, SHARD);
    await sleep(PAUSE_MS);
    const res = await api.memory.get(field, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
  }
  await api.console(`delete Memory.${field}`, SHARD);
  await sleep(500);
  if (value === undefined || value === null) throw new Error(`пустой ответ ${field}`);
  return String(value);
}

(async () => {
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(
    `Шард ${SHARD}: счётчики на ${TICKS} тиков (пауза ${PAUSE_MS} мс) → ${OUT}\n`,
  );

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1200);

  const rows = [];
  let installed = false;

  try {
    const on = await exec(INSTALL, { key: "tmon" });
    if (on !== "on") throw new Error(`обёртка не встала: ${on}`);
    installed = true;
    console.log("счётчики поставлены (обёртки на экспорт task.manager)\n");

    const first = JSON.parse(await exec(PROBE, { key: "tmp" }));
    rows.push(first);
    console.log(
      `старт: t=${first.t}, очередей ${first.q}, кэшей ключей ${first.k}, ` +
        `inited ${first.i}, крипов ${first.cr}\n`,
    );

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(PAUSE_MS);
      const p = JSON.parse(await exec(PROBE, { key: "tmp" }));
      rows.push(p);
      console.log(
        `  t=${String(p.t).padEnd(11)} шагов ${String(p.t - first.t).padStart(3)} ` +
          `hd=${String(p.n.hasDuplicate || 0).padStart(4)} ` +
          `gn=${String(p.n.getNextTask || 0).padStart(4)} ` +
          `gi=${String(p.n.getTaskById || 0).padStart(4)} ` +
          `at=${String(p.n.addTask || 0).padStart(3)} cr=${String(p.n.completeTask || 0).padStart(3)}`,
      );
      if (p.t - first.t >= TICKS) break;
    }

    const last = rows[rows.length - 1];
    const ticks = Math.max(1, last.t - first.t);
    console.log(`\nокно: ${ticks} тиков (t=${first.t} → ${last.t})`);
    console.log("вызовов за тик (среднее по окну):");
    const perTick = {};
    for (const k of NAMES) {
      const d = (last.n[k] || 0) - (first.n[k] || 0);
      perTick[k] = +(d / ticks).toFixed(3);
      if (d) console.log(`  ${k.padEnd(14)} ${perTick[k].toString().padStart(8)}  (всего ${d})`);
    }
    console.log(
      `\nпоследняя проба: очередей в heap ${last.q}, кэшей ключей ${last.k}, ` +
        `inited ${last.i}`,
    );
    console.log(
      `cpuStats: average ${last.a}, taskManager ${last.tm}, крипов ${last.cr}`,
    );
    fs.writeFileSync(
      OUT,
      JSON.stringify({ shard: SHARD, ticks, first, last, perTick, rows }, null, 1),
    );
  } finally {
    if (installed) {
      const off = await exec(UNINSTALL, { key: "tmoff" });
      console.log(`\nобёртки сняты: ${off}`);
    }
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(500);
    const left = await exec(
      `Object.keys(Memory).filter(k=>k.charCodeAt(0)===95).join(",")`,
      { key: "tmleft" },
    );
    console.log(`временные поля Memory с "_": ${left || "(нет)"}`);
  }

  console.log(`\nсырые данные: ${OUT}`);
})().catch(async e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  try {
    await api.console(UNINSTALL, SHARD);
    await api.console("delete Memory.keepTemp", SHARD);
  } catch (e2) {
    console.error("уборка не удалась:", e2 && e2.message);
  }
  process.exit(1);
});
