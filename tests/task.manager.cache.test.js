"use strict";
/**
 * ===================================================
 * TASK.MANAGER.CACHE.TEST.JS — офлайн-проверка пер-тикового кеша очередей
 * ===================================================
 * Симптом: холостой Worker каждый тик заново обходил все категории TASK_CHAIN
 * и повторно просматривал очереди — даже когда доступных Task нет вовсе или все
 * они уже зарезервированы живыми крипами. Правка: task.manager кеширует на тик
 * «первую доступную Task категории» и «есть ли в комнате доступные Task», а
 * worker.runner одним вызовом hasAvailableTask отсекает холостой обход.
 *
 * Проверяем, что кеш не меняет семантику FIFO:
 *   1) пустые очереди: hasAvailableTask=false, getNextTask=null;
 *   2) addTask в том же тике сбрасывает кеш (воркер сразу видит Task);
 *   3) зарезервированная ЖИВЫМ крипом Task не выдаётся второму воркеру,
 *      а зарезервированная МЁРТВЫМ — снова доступна;
 *   4) порядок FIFO сохраняется;
 *   5) completeTask удаляет запись и сбрасывает кеш;
 *   6) кеш сбрасывается при смене тика;
 *   7) кеш сбрасывается при смене объекта Memory (global reset, офлайн-тесты).
 *
 * Запуск: node tests/task.manager.cache.test.js
 */

function resetHeap() {
  global._taskScan = undefined;
  global._taskIdSeq = undefined;
}

function newMemory() {
  global.Memory = { rooms: { R: { tasks: {} } } };
  return Memory;
}

global.Game = { time: 1000, creeps: {} };

const taskManager = require("../task.manager");
const TASK_CHAIN = taskManager.TASK_CHAIN;
const TYPE = "fillSpawnsExtensions";
if (TASK_CHAIN.indexOf(TYPE) === -1) {
  throw new Error("Тест опирается на категорию " + TYPE + " в TASK_CHAIN");
}

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

function makeTask(id) {
  return {
    taskId: id,
    type: "transfer",
    targetId: "T_" + id,
    resourceType: "energy",
  };
}

// ── 1. Пустые очереди ────────────────────────────────────────────────────
{
  console.log("\n1. Пустые очереди: доступных Task нет");
  resetHeap();
  newMemory();
  Game.creeps = {};
  check("hasAvailableTask=false", taskManager.hasAvailableTask("R") === false);
  check(
    "getNextTask=null",
    taskManager.getNextTask("R", TYPE) === null,
    String(taskManager.getNextTask("R", TYPE)),
  );
}

// ── 2. addTask в том же тике сбрасывает кеш ──────────────────────────────
{
  console.log("\n2. addTask в том же тике: кеш не «залипает»");
  resetHeap();
  newMemory();
  Game.creeps = {};
  check("до addTask пусто", taskManager.hasAvailableTask("R") === false);
  taskManager.addTask("R", TYPE, makeTask("t1"));
  check("после addTask есть доступная", taskManager.hasAvailableTask("R") === true);
  const got = taskManager.getNextTask("R", TYPE);
  check("getNextTask вернул добавленную", !!got && got.taskId === "t1", JSON.stringify(got));
}

// ── 3. Резервация живым крипом ───────────────────────────────────────────
{
  console.log("\n3. Живой крип зарезервировал: второму та же Task не выдаётся");
  resetHeap();
  newMemory();
  Game.creeps = { A: {} };
  taskManager.addTask("R", TYPE, makeTask("t1"));
  const first = taskManager.getNextTask("R", TYPE);
  check("первый получил t1", !!first && first.taskId === "t1");
  check(
    "резервация успешна",
    taskManager.reserveTask("R", TYPE, first, "A") === true,
  );
  check("доступных больше нет", taskManager.hasAvailableTask("R") === false);
  check("второй получил null", taskManager.getNextTask("R", TYPE) === null);
}

// ── 4. Резервация мёртвым крипом: запись снова доступна ──────────────────
{
  console.log("\n4. Мёртвый крип зарезервировал: Task снова доступна");
  resetHeap();
  newMemory();
  Game.creeps = {};
  taskManager.addTask("R", TYPE, makeTask("t1"));
  Memory.rooms.R.tasks[TYPE][0].reservedBy = "ghost";
  check("мёртвая резервация не блокирует", taskManager.hasAvailableTask("R") === true);
  const got = taskManager.getNextTask("R", TYPE);
  check("getNextTask вернул запись ghost", !!got && got.taskId === "t1", JSON.stringify(got));
}
// ── 5. Порядок FIFO ──────────────────────────────────────────────────────
{
  console.log("\n5. FIFO: выдаётся самая ранняя доступная");
  resetHeap();
  newMemory();
  Game.creeps = { A: {} };
  taskManager.addTask("R", TYPE, makeTask("t1"));
  taskManager.addTask("R", TYPE, makeTask("t2"));
  const first = taskManager.getNextTask("R", TYPE);
  check("первая — t1", !!first && first.taskId === "t1", JSON.stringify(first));
  taskManager.reserveTask("R", TYPE, first, "A");
  const second = taskManager.getNextTask("R", TYPE);
  check("после резервации — t2", !!second && second.taskId === "t2", JSON.stringify(second));
}

// ── 6. completeTask удаляет запись и сбрасывает кеш ──────────────────────
{
  console.log("\n6. completeTask: запись удалена, кеш сброшен");
  resetHeap();
  newMemory();
  Game.creeps = {};
  taskManager.addTask("R", TYPE, makeTask("t1"));
  const got = taskManager.getNextTask("R", TYPE);
  check("complete успешен", taskManager.completeTask("R", TYPE, got) === true);
  check("очередь пуста", Memory.rooms.R.tasks[TYPE].length === 0);
  check("доступных нет", taskManager.hasAvailableTask("R") === false);
}

// ── 7. Смена тика сбрасывает кеш ─────────────────────────────────────────
{
  console.log("\n7. Смена тика: кеш пересчитывается");
  resetHeap();
  newMemory();
  Game.creeps = {};
  check("в тике T пусто", taskManager.hasAvailableTask("R") === false);
  // Задача появляется «в обход» addTask (как пишет генератор) — кеш прошлого
  // тика не должен её скрывать.
  Game.time++;
  Memory.rooms.R.tasks[TYPE] = [makeTask("t9")];
  check("в тике T+1 задача видна", taskManager.hasAvailableTask("R") === true);
  Game.time++;
}

// ── 8. Смена объекта Memory сбрасывает кеш ───────────────────────────────
{
  console.log("\n8. Смена объекта Memory: кеш пересчитывается");
  resetHeap();
  Game.time = 5000;
  newMemory();
  Game.creeps = {};
  check("в Memory #1 пусто", taskManager.hasAvailableTask("R") === false);
  newMemory(); // global reset / офлайн-тест: новый объект Memory, тик тот же
  Memory.rooms.R.tasks[TYPE] = [makeTask("t10")];
  check("в Memory #2 задача видна", taskManager.hasAvailableTask("R") === true);
}

// ── 9. Точечная инвалидация: чужая категория кеш не сбрасывает ───────────
// Прежний invalidateScanCache удалял запись КОМНАТЫ целиком, поэтому добавление
// Task в одну категорию заставляло заново просканировать очереди всех
// остальных. Проверяем, что кеш чужой категории переживает изменение соседней:
// очередь правится В ОБХОД task.manager, поэтому сброшенный кеш вернул бы
// вставленную probe-запись, а сохранившийся — прежнюю Task.

/**
 * @param {string} roomName
 * @param {string} taskType
 * @param {string} expectedTaskId
 * @returns {boolean} жив ли кеш категории
 */
function cacheSurvived(roomName, taskType, expectedTaskId) {
  const queue = Memory.rooms[roomName].tasks[taskType];
  const probe = makeTask("probe_" + taskType);
  queue.unshift(probe);
  const got = taskManager.getNextTask(roomName, taskType);
  queue.shift();
  resetHeap(); // результат probe не должен утечь в следующие проверки
  return !!got && got.taskId === expectedTaskId;
}

{
  console.log("\n9. addTask в соседнюю категорию не сбрасывает кеш TYPE");
  resetHeap();
  newMemory();
  Game.creeps = {};
  taskManager.addTask("R", TYPE, makeTask("t1"));
  taskManager.addTask("R", "fillTowers", makeTask("w1"));
  const first = taskManager.getNextTask("R", TYPE);
  check("кеш TYPE прогрет", !!first && first.taskId === "t1");

  taskManager.addTask("R", "fillTowers", makeTask("w2"));
  taskManager.addTask("R", TYPE, makeTask("t2")); // своя категория: в конец
  const still = taskManager.getNextTask("R", TYPE);
  check(
    "добавление в конец не меняет первую доступную (FIFO)",
    !!still && still.taskId === "t1",
    JSON.stringify(still),
  );
  check(
    "кеш TYPE жив (пересбора очереди не было)",
    cacheSurvived("R", TYPE, "t1"),
  );
}

// ── 10. Резервация сбрасывает только свою категорию ──────────────────────
{
  console.log("\n10. reserveTask сбрасывает только очередь своей категории");
  resetHeap();
  newMemory();
  Game.creeps = { A: {} };
  taskManager.addTask("R", TYPE, makeTask("t1"));
  taskManager.addTask("R", "fillTowers", makeTask("w1"));
  const t = taskManager.getNextTask("R", TYPE);
  const w = taskManager.getNextTask("R", "fillTowers");
  check("прогреты обе категории", !!t && !!w);

  check("резервация успешна", taskManager.reserveTask("R", TYPE, t, "A") === true);
  check("квартира TYPE пересчитана (t1 занята)", taskManager.getNextTask("R", TYPE) === null);
  check(
    "кеш fillTowers не тронут",
    cacheSurvived("R", "fillTowers", "w1"),
  );
}

// ── 11. completeTask сбрасывает только свою категорию ────────────────────
{
  console.log("\n11. completeTask сбрасывает только очередь своей категории");
  resetHeap();
  newMemory();
  Game.creeps = {};
  taskManager.addTask("R", TYPE, makeTask("t1"));
  taskManager.addTask("R", TYPE, makeTask("t2"));
  taskManager.addTask("R", "fillTowers", makeTask("w1"));
  const t = taskManager.getNextTask("R", TYPE);
  const w = taskManager.getNextTask("R", "fillTowers");
  check("прогреты обе категории", !!t && t.taskId === "t1" && !!w);

  check("complete успешен", taskManager.completeTask("R", TYPE, t) === true);
  const next = taskManager.getNextTask("R", TYPE);
  check("следующая Task видна сразу", !!next && next.taskId === "t2", JSON.stringify(next));
  check(
    "кеш fillTowers не тронут",
    cacheSurvived("R", "fillTowers", "w1"),
  );
}

// ── 12. releaseTask: освобождение видно сразу ────────────────────────────
{
  console.log("\n12. releaseTask: освобождённая Task доступна в том же тике");
  resetHeap();
  newMemory();
  Game.creeps = { A: {} };
  taskManager.addTask("R", TYPE, makeTask("t1"));
  const t = taskManager.getNextTask("R", TYPE);
  taskManager.reserveTask("R", TYPE, t, "A");
  check("после резервации пусто", taskManager.getNextTask("R", TYPE) === null);
  check("release успешен", taskManager.releaseTask("R", TYPE, t) === true);
  const back = taskManager.getNextTask("R", TYPE);
  check("Task снова доступна", !!back && back.taskId === "t1", JSON.stringify(back));
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
