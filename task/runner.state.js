// ===================================================
// TASK/runner.state.js — состояние воркера в Memory
// ===================================================
// Часть разбиения worker.runner.js (525 строк, 04.10.2026). Наружу блок
// по-прежнему отдаёт фасад worker.runner.js: те же ТРИ экспорта (run, diag,
// TASK_CHAIN), что и раньше, — их зовут room/creeps.js:15 и тесты
// (task.index2.test.js:52, worker.proximity.test.js:66).
//
// Позиция воркера в цепочке (creep.memory.taskIndex) и миграция старого формата
// «копия задачи в памяти крипа» → taskId.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const { TASK_CHAIN } = require("./queue");

const TYPE_COUNT = TASK_CHAIN.length;

/* ─────────────────────────── СОСТОЯНИЕ ВОРКЕРА ──────────────────────────── */

/**
 * Позиция воркера в цепочке TASK_CHAIN. Хранится в `creep.memory.taskIndex`,
 * потому что переживает рестарт VM: иначе воркер после каждого рестарта
 * начинал бы перебор с нулевой очереди.
 */
function readTypeIndex(memory) {
  const stored = memory.taskIndex;
  const numeric = typeof stored === "number" ? stored : 0;

  if (numeric >= 0 && numeric < TYPE_COUNT) return numeric;

  // Память повреждена (тип удалён из TASK_CHAIN) — чиним один раз.
  if (memory.taskIndex !== 0) memory.taskIndex = 0;
  return 0;
}

/** Миграция со старого формата: копия задачи в памяти воркера → taskId. */
function migrateLegacyTask(memory) {
  if (!memory.task) return;

  memory.taskId = memory.task.taskId;
  delete memory.task;
}


module.exports = {
  readTypeIndex,
  migrateLegacyTask,
};
