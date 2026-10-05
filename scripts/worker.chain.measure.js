"use strict";
/**
 * ===================================================
 * SCRIPTS/WORKER.CHAIN.MEASURE.JS — замер перебора цепочки задач (worker.runner)
 * ===================================================
 * Read-only замер перед возможным шагом «ленивый резолв / кэш id в worker.runner.js».
 *
 * Что делает: читает через API Memory крипов и Memory.rooms[*].tasks, находит
 * воркеров БЕЗ зарезервированной задачи (именно они уходят в bestQueue,
 * task/runner.pick.js:204-234) и считает, сколько задач-кандидатов они могут
 * просмотреть за тик, а значит — сколько раз вызовут Game.getObjectById
 * (routePointId, task/runner.pick.js:85-103 резолвит id точки маршрута каждой
 * задачи).
 *
 * Почему это считается по Memory, а не меряется обёрткой: обернуть
 * Game.getObjectById счётчиком из консоли нельзя — консоль и код бота
 * исполняются в разных JS-контекстах (проверено: обёртка видна в консоли, но
 * ни одного вызова из кода бота не получает). Замеренные цены вызова лежат в
 * docs/resolve-measure.json (0.000047–0.000141 CPU).
 *
 * Границы честно названы границами: точное число просмотренных кандидатов
 * зависит от heap-состояния task.manager (hint/free), которое живёт один тик и
 * из Memory не читается. Нижняя граница: 1 кандидат на непустую очередь
 * (очередь непуста — getNextTask почти всегда возвращает задачу), верхняя:
 * TASK_CONFIG.NEAREST_SCAN_LIMIT (8) кандидатов, каждый — один-два резолва.
 *
 * Код бота не меняется, игровых интентов нет.
 *
 * Запуск:
 *   node scripts/worker.chain.measure.js           # shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SCAN_LIMIT = 8; // TASK_CONFIG.NEAREST_SCAN_LIMIT, constants/tasks.js:52
const COST_MIN = 0.000047; // повторный резолв в том же тике
const COST_MAX = 0.000141; // резолв по несуществующему id (сверху)

const api = new ScreepsAPI({ token: resolveTokenSource().token });

(async () => {
  const { source } = resolveTokenSource();
  console.log(`Замер перебора цепочки worker.runner, шард ${SHARD} (токен из: ${source})`);

  const creepsRes = await api.memory.get("creeps", SHARD);
  const roomsRes = await api.memory.get("rooms", SHARD);
  const creeps = (creepsRes && creepsRes.data) || {};
  const rooms = (roomsRes && roomsRes.data) || {};

  // Очереди: сколько задач и сколько из них свободно.
  const queues = {};
  for (const roomName of Object.keys(rooms)) {
    const tasks = rooms[roomName].tasks || {};
    const perType = {};
    for (const type of Object.keys(tasks)) {
      const arr = tasks[type] || [];
      let reserved = 0;
      for (const t of arr) if (t && t.reservedBy) reserved++;
      if (arr.length > 0) perType[type] = { total: arr.length, reserved, free: arr.length - reserved };
    }
    queues[roomName] = perType;
  }

  const workers = [];
  for (const name of Object.keys(creeps)) {
    const m = creeps[name];
    if (m.role !== "worker") continue;
    workers.push({
      name,
      homeRoom: m.homeRoom || null,
      taskIndex: typeof m.taskIndex === "number" ? m.taskIndex : null,
      taskId: m.taskId || null,
      working: m.working === true,
    });
  }

  const noTask = workers.filter(w => !w.taskId);
  const withTask = workers.filter(w => w.taskId);

  console.log(`\nворкеров всего: ${workers.length} (с задачей ${withTask.length}, без задачи ${noTask.length})`);

  let lowerTotal = 0;
  let upperTotal = 0;
  console.log("\nперебор цепочки (только воркеры без задачи):");
  for (const w of noTask) {
    const roomQueues = queues[w.homeRoom] || {};
    const nonEmpty = Object.keys(roomQueues);
    // Нижняя граница: по одному кандидату на непустую очередь (один резолв).
    // Верхняя: до 8 кандидатов на очередь, каждый кандидат резолвится и в
    // getNextTask (rangeFn), и при пересчёте дистанции — то есть до 2 вызовов.
    const lower = nonEmpty.length;
    const upper = nonEmpty.length * SCAN_LIMIT * 2;
    lowerTotal += lower;
    upperTotal += upper;
    console.log(
      `  ${w.name} (${w.homeRoom}, taskIndex=${w.taskIndex}): непустых очередей ${nonEmpty.length}` +
        `${nonEmpty.length ? " [" + nonEmpty.join(",") + "]" : ""} → резолвов ${lower}..${upper}`,
    );
  }
  if (noTask.length === 0) console.log("  (нет — все воркеры с задачей)");

  console.log(`\nнепустые очереди по комнатам:`);
  for (const roomName of Object.keys(queues)) {
    const q = queues[roomName];
    const parts = Object.keys(q).map(t => `${t}: ${q[t].free}/${q[t].total} свободно`);
    console.log(`  ${roomName}: ${parts.length ? parts.join("; ") : "(пусто)"}`);
  }

  console.log(`\nрезолвов в переборе цепочки за тик: ${lowerTotal}..${upperTotal} (нижняя..верхняя граница)`);
  console.log(
    `  → цена по замеру docs/resolve-measure.json: ` +
      `${(lowerTotal * COST_MIN).toFixed(4)}..${(upperTotal * COST_MAX).toFixed(4)} CPU/тик`,
  );
  console.log(
    `  → воркеров с задачей (там путь короче): ${withTask.length}, ` +
      `каждый резолвит 1-2 цели в исполнителе`,
  );

  const out = {
    measuredAt: new Date().toISOString(),
    shard: SHARD,
    workers: workers.length,
    workersWithTask: withTask.length,
    workersWithoutTask: noTask.length,
    scanLimit: SCAN_LIMIT,
    resolvesLower: lowerTotal,
    resolvesUpper: upperTotal,
    queues,
    workerList: workers,
  };
  const fs = require("fs");
  const path = require("path");
  const outFile = path.join(__dirname, "..", "docs", "chain-measure.json");
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nОтчёт сохранён: ${outFile}`);
  process.exit(0);
})().catch(e => {
  console.log("КРИТИЧЕСКАЯ ОШИБКА:", e.message);
  process.exit(1);
});
