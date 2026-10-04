// ===================================================
// TASK/runner.js — главный вход роли worker
// ===================================================
// Часть разбиения worker.runner.js (525 строк, 04.10.2026). Наружу блок
// по-прежнему отдаёт фасад worker.runner.js: те же ТРИ экспорта (run, diag,
// TASK_CHAIN), что и раньше, — их зовут room/creeps.js:15 и тесты
// (task.index2.test.js:52, worker.proximity.test.js:66).
//
// run(creep): решение о задаче на этот тик и передача её исполнителю
// (taskExecutors.executors[type]). Порядок шагов и правила CPU не менялись.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const taskManager = require("task.manager");
const taskExecutors = require("task.executors");
const { TASK_CHAIN } = require("./queue");
const { diag, sampling } = require("./runner.diag");
const { roomIndex, makeRanger, findTask } = require("./runner.pick");
const { readTypeIndex, migrateLegacyTask } = require("./runner.state");

/* ─────────────────────────── ГЛАВНЫЙ ВХОД ───────────────────────────────── */

function run(creep) {
  const memory = creep.memory;
  const ownIndex = readTypeIndex(memory);

  migrateLegacyTask(memory);

  const roomName = creep.room.name;
  const index = roomIndex(roomName);

  // ПРАВИЛО 1: задача ищется по taskId до чтения стора — стор нужен только
  // для дальности и для исполнителя.
  let task = memory.taskId
    ? taskManager.getTaskById(roomName, TASK_CHAIN[ownIndex], memory.taskId)
    : null;

  let typeIndex = ownIndex;

  if (!task) {
    if (memory.taskId) memory.taskId = null;

    // ПРАВИЛО 2: комната уже признана нерабочей в этом тике — выходим, не
    // трогая ни Memory, ни стор, ни очереди.
    if (index.built && index.count === 0) {
      diag().dryExits++;
      return;
    }

    const stats = diag();
    const samplingNow = sampling();
    const before = samplingNow ? Game.cpu.getUsed() : 0;

    // Стор читается ОДИН раз за тик и только теперь: до этого он был не нужен.
    const full = creep.store.getFreeCapacity() === 0;
    const ranger = makeRanger(creep, full);
    const found = findTask(creep, roomName, index, ownIndex, ranger);

    if (samplingNow) {
      stats.cpuTask += Game.cpu.getUsed() - before;
      stats.cpuSample++;
    }

    if (!found) {
      // Работы нет нигде: ничего не делаем и НЕ пишем в Memory.
      stats.noTask++;
      return;
    }

    task = found.task;
    typeIndex = found.typeIndex;

    // Тип меняется ТОЛЬКО когда своя очередь опустела: следующая задача той же
    // очереди сохраняет кэш пути воркера (reusePath). Смена типа — брошенный
    // кэш, поэтому она видна в счётчике `switched`.
    if (memory.taskIndex !== typeIndex) {
      memory.taskIndex = typeIndex;
      stats.switched++;
    }

    if (!taskManager.reserveTask(roomName, TASK_CHAIN[typeIndex], task, creep.name)) {
      return; // задачу забрал другой воркер — попробуем в следующем тике
    }

    memory.taskId = task.taskId;
    stats.selected++;
  }

  const executor = taskExecutors.executors[TASK_CHAIN[typeIndex]];

  // Исполнителя для этой категории нет: задача остаётся за воркером.
  if (!executor) return;

  const stats = diag();
  const samplingNow = sampling();
  const before = samplingNow ? Game.cpu.getUsed() : 0;
  const result = executor(creep, task);

  if (samplingNow) {
    stats.cpuExec += Game.cpu.getUsed() - before;
    stats.cpuSample++;
  }

  stats.calls++;

  if (result === "CONTINUE") return;

  if (result === "DONE" || result === "SKIP") {
    const done = result === "DONE";

    const removed = done
      ? taskManager.completeTask(roomName, TASK_CHAIN[typeIndex], task)
      : taskManager.removeTask(roomName, TASK_CHAIN[typeIndex], task);

    if (done) stats.done++;
    else stats.skip++;

    if (!removed) {
      // Задача не найдена в очереди по taskId: это аномалия, а не успех.
      // Логируем, но воркера всё равно освобождаем — иначе он пытался бы
      // завершить несуществующую запись вечно.
      console.log(
        "[worker.runner] " +
          creep.name +
          ": не удалось " +
          (done ? "completeTask" : "removeTask") +
          " для taskId=" +
          task.taskId +
          " (" +
          TASK_CHAIN[typeIndex] +
          ") — Task не найдена в очереди.",
      );
    }
  }

  if (memory.taskId) memory.taskId = null;
}


module.exports = {
  run,
  TASK_CHAIN,
};
