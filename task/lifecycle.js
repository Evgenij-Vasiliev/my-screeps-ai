// ===================================================
// TASK/LIFECYCLE.JS — постановка, резервация и завершение задач
// ===================================================
// Часть разбиения task.manager.js (554 строки, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад task.manager.js.
//
// Здесь только ЗАПИСЬ: постановка с потолком на тик (addTask), продление
// жизни задачи (reserveTask, releaseTask), завершение через null-надгробие
// (completeTask, removeTask) и сжатие очередей в конце тика (compactAll).
// Структура очереди — task/queue.js, чтение — task/lookup.js.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const { TASK_CONFIG } = require("../constants");
const {
  TASK_TYPE_SET,
  heap,
  taskKey,
  getQueueEntry,
  ensureIndex,
  reindex,
  initRoomTasks,
} = require("./queue");

function generateTaskId() {
  if (typeof Memory._taskIdSeq !== "number") {
    Memory._taskIdSeq = 0;
  }

  Memory._taskIdSeq++;
  return "task_" + Memory._taskIdSeq;
}

function addTask(roomName, taskType, task) {
  if (!TASK_TYPE_SET.has(taskType)) {
    return false;
  }
  if (typeof task !== "object" || task === null) {
    return false;
  }

  // ── Потолок постановки задач на тик ──────────────────────────────────
  // Раньше очередь росла без предела: в E35S37 накопилось 187 задач, в
  // E37S38 — 137. На комнату с ДВУМЯ воркерами это значит, что воркер берёт
  // задачу не «следующую по делу», а произвольную из длинного хвоста и едет
  // через всю комнату, бросая кэш пути. Плюс каждая задача — байты в Memory,
  // которая сериализуется целиком.
  //
  // Потолок НЕ меняет порядок очереди: он только прекращает дописывать новые
  // задачи того же типа, когда на этот тик их уже достаточно. Уже стоящие
  // задачи и их приоритет не трогаются, воркеры работают по прежней FIFO.
  const h = heap();
  const addedKey = roomName + "\u0001" + taskType;
  const alreadyAdded = h.added[addedKey] || 0;

  if (alreadyAdded >= TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK) {
    return false;
  }

  initRoomTasks(roomName);

  // Ленивое создание очереди: массив типа появляется в Memory только тогда,
  // когда в нём есть хотя бы одна задача (см. initRoomTasks выше). Пустые
  // массивы остальных типов в Memory не лежат и не сериализуются.
  const tasks = Memory.rooms[roomName].tasks;
  let queue = tasks[taskType];
  if (!queue) {
    queue = tasks[taskType] = [];
  }

  if (typeof task.taskId === "undefined") {
    task.taskId = generateTaskId();
  }

  queue.push(task);

  // Считаем поставленные в этом тике задачи этого типа (см. потолок выше).
  h.added[addedKey] = alreadyAdded + 1;

  // Держим индекс очереди в согласии с Memory (если он уже построен).
  const entry = h.queues[roomName + "\u0001" + taskType];
  if (entry) {
    if (entry.queue !== queue) {
      // Массив создан лениво в этом же тике (или подменён извне) — позиции
      // недействительны, пересобираем счётчики. countQueue увидит только что
      // добавленную задачу, поэтому отдельный free++ здесь не нужен.
      entry.queue = queue;
      reindex(entry);
    } else {
      // Позиции дописываем ТОЛЬКО в уже построенный Map (ленивый indexById):
      // строить его здесь ради одной задачи — это та самая работа, которую
      // убрал ensureIndex.
      if (entry.indexById) entry.indexById.set(task.taskId, queue.length - 1);
      if (!task.reservedBy) entry.free++;
    }
  }

  // Дописываем ключ новой задачи в уже построенные кэши этой очереди:
  // иначе второй кандидат с тем же ключом в том же тике прошёл бы проверку.
  const sets = heap().byType[roomName + "\u0001" + taskType];
  if (sets) {
    for (let i = 0; i < sets.length; i++) {
      sets[i].set.add(taskKey(task, sets[i].fields));
    }
  }

  return true;
}

function reserveTask(roomName, taskType, task, creepName) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  // Берём объект ИЗ ОЧЕРЕДИ, а не переданный параметр: индекс хранит
  // позиции в Memory, и резервация должна попасть именно туда.
  const index = ensureIndex(entry).get(task.taskId);
  const queued = index === undefined ? null : entry.queue[index];

  if (!queued) return false;

  if (!queued.reservedBy) entry.free--;
  queued.reservedBy = creepName;
  return true;
}

function releaseTask(roomName, taskType, task) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  const index = ensureIndex(entry).get(task.taskId);
  const queued = index === undefined ? null : entry.queue[index];

  if (!queued) return false;

  if (queued.reservedBy) entry.free++;
  delete queued.reservedBy;
  return true;
}

function completeTask(roomName, taskType, task) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  const index = ensureIndex(entry).get(task.taskId);

  if (index === undefined) return false;

  const queued = entry.queue[index];
  if (!queued) return false;

  if (queued.reservedBy) entry.free++;
  delete queued.reservedBy;

  // НАДГРОБИЕ вместо splice: массив не сдвигается, поэтому позиции в
  // indexById (уже построенном ensureIndex) остаются верными до конца тика,
  // а завершение задачи — O(1).
  // Обход очереди его пропускает, а сжимает очередь compactAll() в конце
  // тика, ДО сериализации Memory, — иначе null-дыры уехали бы в Memory.
  entry.queue[index] = null;
  entry.indexById.delete(task.taskId);
  entry.dead++;

  return true;
}

/**
 * Сжатие очередей с надгробиями. Вызывается один раз в конце тика
 * (empire.js) — обязательно ДО сериализации Memory.
 *
 * Сжатие на месте: объекты задач сохраняют идентичность, поэтому достаточно
 * пересчитать счётчики и сбросить позиции (reindex): они сдвинулись.
 *
 * @returns {number} сколько очередей было сжато
 */
function compactAll() {
  const h = global.__taskHeap;
  // Heap от прошлого тика означает, что задач в этом тике не трогали —
  // сжимать нечего (в конце прошлого тика всё уже сжато).
  if (!h || h.tick !== Game.time) return 0;

  let compacted = 0;

  for (const key in h.queues) {
    const entry = h.queues[key];
    if (!entry.dead || !entry.queue) continue;

    const queue = entry.queue;
    let write = 0;

    for (let read = 0; read < queue.length; read++) {
      const task = queue[read];
      if (task) queue[write++] = task;
    }

    queue.length = write;
    reindex(entry);
    compacted++;
  }

  return compacted;
}

function removeTask(roomName, taskType, task) {
  return completeTask(roomName, taskType, task);
}

module.exports = {
  addTask,
  reserveTask,
  releaseTask,
  completeTask,
  removeTask,
  compactAll,
};
