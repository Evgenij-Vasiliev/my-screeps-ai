"use strict";
/**
 * ===================================================
 * TASK.LAZY.QUEUES.TEST.JS — ленивое создание очередей задач
 * ===================================================
 * Правка 30.09.2026: initRoomTasks больше НЕ создаёт все 11 массивов
 * TASK_CHAIN на комнату сразу — массив типа появляется в Memory только тогда,
 * когда в нём есть хотя бы одна задача (addTask).
 *
 * Зачем: замер shard3 30.09.2026 (t=83334141) — 55 ключей очередей на 5 комнат,
 * 54 из них пустые, 1 220 Б в Memory, которая сериализуется целиком каждый тик.
 *
 * Проверяем:
 *   1) initRoomTasks создаёт контейнер, но НИ ОДНОГО массива типа;
 *   2) addTask создаёт ровно тот тип, в который кладут задачу;
 *   3) отсутствие очереди не ломает чтение: freeTasks = 0, getNextTask = null,
 *      и Memory при этом не засоряется;
 *   4) порядок «сначала спросили freeTasks, потом addTask» (entry.queue === null)
 *      не теряет задачу: она видна в том же тике (reindex считает её свободной);
 *   5) compactAll с отсутствующими очередями не падает;
 *   6) повторная initRoomTasks в том же тике не подменяет существующую очередь;
 *   7) после внешней чистки Memory очереди создаются заново.
 *
 * Запуск: node tests/task.lazy.queues.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

global.Memory = {};
global.Game = { time: 1000, creeps: {}, cpu: { getUsed: () => 0 } };

const taskManager = require("../task.manager");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

function queues(room) {
  return (Memory.rooms[room] || {}).tasks;
}

// ── 1. initRoomTasks: контейнер без массивов ─────────────────────────────
console.log("\n1. initRoomTasks создаёт только контейнер");
const ROOM = "W1N1";
taskManager.initRoomTasks(ROOM);
check("контейнер tasks создан", typeof queues(ROOM) === "object" && queues(ROOM) !== null);
check("массивов типов нет", Object.keys(queues(ROOM)).length === 0, JSON.stringify(queues(ROOM)));
check(
  "ни один тип TASK_CHAIN не создан",
  taskManager.TASK_CHAIN.every(t => queues(ROOM)[t] === undefined),
);

// ── 2. addTask создаёт ровно свой тип ────────────────────────────────────
console.log("\n2. addTask создаёт очередь по требованию");
const added = taskManager.addTask(ROOM, "fillTowers", { type: "transfer", targetId: "t1" });
check("addTask вернул true", added === true);
check("очередь fillTowers создана", Array.isArray(queues(ROOM).fillTowers));
check("в ней ровно одна задача", queues(ROOM).fillTowers.length === 1, String(queues(ROOM).fillTowers.length));
check("другие типы не созданы", Object.keys(queues(ROOM)).length === 1, Object.keys(queues(ROOM)).join(","));
check("taskId присвоен", typeof queues(ROOM).fillTowers[0].taskId === "string");

// ── 3. Отсутствие очереди не ломает чтение ───────────────────────────────
console.log("\n3. Чтение при отсутствующей очереди");
const EMPTY = "W2N2";
check("freeTasks по несуществующей очереди = 0", taskManager.freeTasks(EMPTY, "repairStructures") === 0);
check("getNextTask по несуществующей очереди = null", taskManager.getNextTask(EMPTY, "repairStructures") === null);
check("Memory под пустую комнату не создана", Memory.rooms[EMPTY] === undefined, JSON.stringify(Memory.rooms[EMPTY]));

// ── 4. freeTasks -> addTask в одном тике не теряет задачу ────────────────
console.log("\n4. entry.queue === null, затем addTask в том же тике");
check("сначала спросили freeTasks", taskManager.freeTasks(EMPTY, "fillTowers") === 0);
taskManager.addTask(EMPTY, "fillTowers", { type: "transfer", targetId: "t2" });
check("свободных стало 1", taskManager.freeTasks(EMPTY, "fillTowers") === 1, String(taskManager.freeTasks(EMPTY, "fillTowers")));
const next = taskManager.getNextTask(EMPTY, "fillTowers");
check("getNextTask отдаёт задачу в том же тике", next !== null && next.targetId === "t2", JSON.stringify(next));

// ── 5. compactAll при отсутствующих очередях ─────────────────────────────
console.log("\n5. compactAll не падает");
let compactError = null;
try {
  taskManager.compactAll();
} catch (e) {
  compactError = e;
}
check("compactAll без ошибок", compactError === null, compactError && compactError.message);

// ── 6. Повторная initRoomTasks не подменяет очередь ──────────────────────
console.log("\n6. Повторная инициализация");
const sameQueue = queues(ROOM).fillTowers;
taskManager.initRoomTasks(ROOM);
check("очередь та же", queues(ROOM).fillTowers === sameQueue);
check("чужих типов не добавилось", Object.keys(queues(ROOM)).length === 1, Object.keys(queues(ROOM)).join(","));

// ── 7. После внешней чистки Memory очередь создаётся заново ──────────────
console.log("\n7. Восстановление после чистки Memory");
global.Game.time += 1; // новый тик: heap-индексы сброшены
Memory.rooms[ROOM].tasks = {};
check("очередей нет", Object.keys(queues(ROOM)).length === 0);
check("addTask снова работает", taskManager.addTask(ROOM, "fillTowers", { type: "transfer", targetId: "t3" }) === true);
check("очередь создана заново", queues(ROOM).fillTowers.length === 1);
check("задача доступна", taskManager.getNextTask(ROOM, "fillTowers") !== null);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
