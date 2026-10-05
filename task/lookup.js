// ===================================================
// TASK/LOOKUP.JS — чтение очередей задач
// ===================================================
// Часть разбиения task.manager.js (554 строки, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад task.manager.js.
//
// Здесь только ЧТЕНИЕ: задача по её taskId (getTaskById), счётчик свободных
// задач (freeTasks) и выбор следующей (getNextTask, с необязательным rangeFn).
// Ни одна функция модуля не меняет Memory и heap-индекс — записи живут в
// task/lifecycle.js, структура очереди — в task/queue.js.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const { TASK_CONFIG } = require("../constants");
const { getQueueEntry, ensureIndex } = require("./queue");

/**
 * Задача по её taskId. O(1) — именно это позволяет хранить в памяти крипа
 * только идентификатор вместо полной копии задачи.
 * @param {string} roomName
 * @param {string} taskType
 * @param {string} taskId
 * @returns {Object|null}
 */
function getTaskById(roomName, taskType, taskId) {
  if (!taskId) return null;

  const entry = getQueueEntry(roomName, taskType);
  const index = ensureIndex(entry).get(taskId);

  return index === undefined ? null : entry.queue[index] || null;
}

/**
 * Сколько задач очереди НИКЕМ не зарезервировано. O(1) — по счётчику free,
 * который ведёт countQueue (getQueueEntry считает его один раз за тик на пару
 * «комната, тип»). Нужно гейтам генераторов: пока свободных задач заведомо
 * больше, чем воркеров, сканировать цели бессмысленно.
 *
 * @param {string} roomName
 * @param {string} taskType
 * @returns {number}
 */
function freeTasks(roomName, taskType) {
  return getQueueEntry(roomName, taskType).free;
}

/**
 * Следующая задача очереди.
 *
 * Без rangeFn — прежнее поведение: первая свободная от позиции hint.
 * С rangeFn(task) => number — БЛИЖАЙШАЯ из просмотренных свободных задач
 * (не более TASK_CONFIG.NEAREST_SCAN_LIMIT кандидатов, см. constants.js).
 * Расстояние считает вызывающий: семантика «куда крип поедет следующим шагом»
 * (пустой — к sourceId, гружёный — к targetId) живёт в worker.runner.js,
 * менеджер о ней не знает.
 *
 * `preferAdjacent` (пункт 8 плана — цепочка дорог): свободная задача ВПЛОТНУЮ к
 * воркеру (`rangeFn(task) <= NEAREST_STOP_RANGE`, то есть соседняя клетка)
 * берётся сразу, а окно поиска расширяется на всю очередь. Зачем расширять:
 * NEAREST_SCAN_LIMIT = 8 кандидатов, и соседняя дорога, стоящая в очереди
 * девятым номером, при обычном поиске не находится вовсе — воркер едет через
 * комнату, хотя ремонт вплотную. Цена расширения — один резолв на кандидата
 * (0.000094–0.000141 CPU, docs/resolve-measure.json), причём ранжер воркера
 * мемоизирует его на тик, а обход прекращается на первой же задаче вплотную.
 * Если задачи вплотную нет, поведение прежнее: ближайшая из окна лимита.
 *
 * @param {string} roomName
 * @param {string} taskType
 * @param {Function} [rangeFn]
 * @param {boolean} [preferAdjacent]
 * @returns {Object|null}
 */
function getNextTask(roomName, taskType, rangeFn, preferAdjacent) {
  const entry = getQueueEntry(roomName, taskType);
  const queue = entry.queue;

  if (!queue || queue.length === 0) return null;

  // Все задачи заняты живыми крипами — обходить очередь незачем.
  if (entry.free <= 0) return null;

  if (entry.hint >= queue.length) entry.hint = 0;

  // Обход начинается с прошлой удачной позиции: свободные задачи обычно
  // лежат рядом, поэтому в типичном случае цикл заканчивается сразу.
  const len = queue.length;
  const nearest = typeof rangeFn === "function";
  const chain = nearest && preferAdjacent === true;
  // Цепочка требует пройти очередь целиком: соседняя дорога может стоять в
  // любом месте. Обрыв — только на найденной задаче вплотную (ниже).
  const limit = nearest && !chain ? TASK_CONFIG.NEAREST_SCAN_LIMIT : Infinity;

  let best = null;
  let bestIndex = -1;
  let bestRange = Infinity;
  let checked = 0;

  for (let step = 0; step < len; step++) {
    const i = (entry.hint + step) % len;
    const task = queue[i];

    if (!task) continue; // надгробие

    // Задача, зарезервированная умершим крипом, считается свободной.
    if (task.reservedBy && Game.creeps[task.reservedBy]) continue;

    if (!nearest) {
      // Прежнее поведение: первая свободная задача.
      entry.hint = i;
      return task;
    }

    const range = rangeFn(task);

    // Цепочка (пункт 8): задача вплотную — берём её, не дочитывая очередь.
    if (chain && range <= TASK_CONFIG.NEAREST_STOP_RANGE) {
      entry.hint = i;
      return task;
    }

    if (bestIndex === -1 || range < bestRange) {
      best = task;
      bestIndex = i;
      bestRange = range;
    }

    checked++;

    // Ближе некуда (или лимит просмотра исчерпан) — дальше искать незачем.
    // При цепочке лимит бесконечен, а «ближе некуда» обработано выше, поэтому
    // цикл идёт до конца очереди и запоминает ближайшую как запасной вариант.
    if (bestRange <= TASK_CONFIG.NEAREST_STOP_RANGE || checked >= limit) break;
  }

  if (bestIndex === -1) return null;

  entry.hint = bestIndex;
  return best;
}

module.exports = {
  getTaskById,
  freeTasks,
  getNextTask,
};
