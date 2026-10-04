// ===================================================
// TASK/QUEUE.JS — очереди задач: структура и heap-индекс
// ===================================================
// Часть разбиения task.manager.js (554 строки, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад task.manager.js
// (empire.js, room/run.js, room/creeps.js и консольные замеры зовут
// require("task.manager"), require("task.generators"), require("worker.runner")).
//
// Здесь только СТРУКТУРА: цепочка категорий (TASK_CHAIN, TASK_TYPE_SET),
// адресация очередей в Memory (queueRef, getQueueEntry, countQueue) и
// heap-индекс на текущий тик (heap, hasDuplicate, ensureIndex, reindex).
// Чтение задачи — task/lookup.js, запись и сжатие — task/lifecycle.js.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const TASK_CHAIN = [
  "fillSpawnsExtensions",
  "fillPowerSpawnPower",
  "fillPowerSpawnEnergy",
  "fillTerminalEnergy",
  "fillTerminalResources",
  "fillFactoryEnergy",
  "collectFactoryBattery",
  "repairStructures",
  "buildStructures",
  "fillTowers",
  "upgradeController",
];

/** Быстрая проверка «это вообще тип задачи» без Array.includes. */
const TASK_TYPE_SET = new Set(TASK_CHAIN);

/**
 * Heap-индекс задач на текущий тик (задание 9 плана).
 *
 * Зачем: каждый генератор задач отсекает дубли, сравнивая кандидата с
 * очередью. Раньше это был tasks.some(...) на КАЖДОГО кандидата — при
 * ~250 повреждённых структурах и ~70 spawns+extensions на комнату это
 * O(кандидаты x очередь) с обходом цепочки Memory внутри колбэка.
 *
 * Теперь на пару (комната, тип) за тик строится один Set ключей, и
 * проверка дубля становится O(1).
 *
 * Ключ — Game.time: очередь живёт в Memory, но индекс должен быть
 * согласован с ней в пределах тика, поэтому переживать тик он не должен.
 */
function heap() {
  if (!global.__taskHeap || global.__taskHeap.tick !== Game.time) {
    global.__taskHeap = {
      tick: Game.time,
      keys: {},
      byType: {},
      inited: {},
      queues: {},
      // Сколько задач каждого типа уже ДОБАВЛЕНО в этом тике (см. addTask).
      added: {},
    };
  }
  return global.__taskHeap;
}

/**
 * Ключ кандидата по набору полей. Поля перечисляются явно: у разных типов
 * задач «дубль» означает разное (где-то достаточно targetId, где-то важен
 * ещё и ресурс).
 */
function taskKey(task, fields) {
  let key = "";
  for (let i = 0; i < fields.length; i++) {
    key += String(task[fields[i]]) + "\u0000";
  }
  return key;
}

/**
 * Set ключей уже существующих задач указанного типа.
 * @param {string} roomName
 * @param {string} taskType
 * @param {string[]} fields
 * @returns {Set<string>}
 */
function getExistingKeys(roomName, taskType, fields) {
  const h = heap();
  const cacheKey = roomName + "\u0001" + taskType + "\u0001" + fields.join(",");

  let set = h.keys[cacheKey];
  if (set) return set;

  set = new Set();

  const tasks =
    Memory.rooms &&
    Memory.rooms[roomName] &&
    Memory.rooms[roomName].tasks &&
    Memory.rooms[roomName].tasks[taskType];

  if (tasks) {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i]) set.add(taskKey(tasks[i], fields)); // null — надгробие
    }
  }

  h.keys[cacheKey] = set;

  // Список кэшей этой очереди — чтобы addTask мог дописать ключ в каждый
  // из них, не сбрасывая кэш целиком (сброс вернул бы O(кандидаты x очередь)).
  const typeKey = roomName + "\u0001" + taskType;
  (h.byType[typeKey] = h.byType[typeKey] || []).push({ fields, set });

  return set;
}

/**
 * Есть ли уже такая задача в очереди.
 * @param {string} roomName
 * @param {string} taskType
 * @param {Object} candidate
 * @param {string[]} fields
 * @returns {boolean}
 */
function hasDuplicate(roomName, taskType, candidate, fields) {
  return getExistingKeys(roomName, taskType, fields).has(
    taskKey(candidate, fields),
  );
}

/**
 * Индекс одной очереди на текущий тик (задание 9, части 2 и 3).
 *
 * indexById хранит ПОЗИЦИИ задач в массиве Memory. Позиции стабильны в
 * пределах тика, потому что завершение задачи больше не сдвигает массив:
 * на месте удалённой остаётся null-«надгробие» (см. completeTask), а сама
 * очередь сжимается один раз в конце тика (compactAll) — до сериализации
 * Memory. Благодаря этому поиск, резервация и завершение стали O(1).
 *
 * free — сколько задач никем не зарезервировано. Позволяет ответить
 * «свободных нет» за O(1), не обходя очередь (в E35S37 до 162 задач).
 */
function getQueueEntry(roomName, taskType) {
  const h = heap();
  const key = roomName + "\u0001" + taskType;

  const cached = h.queues[key];
  if (cached && cached.queue === queueRef(roomName, taskType)) return cached;

  const queue = queueRef(roomName, taskType);
  // indexById === null: позиции задач строятся ЛЕНИВО (ensureIndex). Замер
  // shard3 30.09.2026 (scripts/task.manager.bench.js): построение индекса
  // непустой очереди — 0.0014-0.0029 CPU, а за тик трогается 45 пар
  // (комната, тип) и лишь в 1-3 из них задачу ищут по taskId.
  const entry = { queue, indexById: null, free: 0, dead: 0, hint: 0 };
  countQueue(entry);

  h.queues[key] = entry;
  return entry;
}

/** Массив очереди из Memory (или null, если её нет). */
function queueRef(roomName, taskType) {
  return (
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks[taskType]) ||
    null
  );
}

/**
 * Счётчики очереди: сколько задач никем не зарезервировано и сколько
 * надгробий. O(n), вызывается один раз на индекс.
 * Позиции (indexById) здесь НЕ считаются — см. ensureIndex.
 */
function countQueue(entry) {
  const queue = entry.queue;

  entry.free = 0;
  entry.dead = 0;

  if (!queue) return;

  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];

    // null-надгробие: задача завершена в этом тике, массив сожмётся в конце.
    if (!task) {
      entry.dead++;
      continue;
    }

    // Свободна не только незарезервированная задача: резервация умершего
    // крипа — тоже свобода (иначе очередь навсегда застряла бы на
    // «свободных нет», ведь пересчёт счётчика идёт раз в тик).
    if (!task.reservedBy || !Game.creeps[task.reservedBy]) entry.free++;
  }
}

/**
 * Позиции задач в массиве очереди (taskId -> индекс). Нужны только там, где
 * задачу ищут по taskId: getTaskById, reserveTask, releaseTask, completeTask.
 * getNextTask обходится счётчиками free/dead и Map не требует.
 *
 * @param {Object} entry
 * @returns {Map<string, number>}
 */
function ensureIndex(entry) {
  const ready = entry.indexById;
  if (ready) return ready;

  const indexById = new Map();
  entry.indexById = indexById;

  const queue = entry.queue;
  if (!queue) return indexById;

  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];
    if (task) indexById.set(task.taskId, i);
  }

  return indexById;
}

/**
 * Пересобирает счётчики очереди и СБРАСЫВАЕТ позиции: после подмены массива
 * извне или сжатия (compactAll) индексы сдвигаются, поэтому старый Map
 * недействителен и построится заново при первом обращении по taskId.
 */
function reindex(entry) {
  countQueue(entry);
  entry.indexById = null;
}

/**
 * Готовит КОНТЕЙНЕР очередей комнаты. Сами массивы типов здесь больше НЕ
 * создаются — это делает addTask в момент появления первой задачи (ленивое
 * создание).
 *
 * Почему так. Прежняя версия создавала все 11 массивов TASK_CHAIN на комнату
 * сразу, при первом же обращении к очереди в тике. Замер shard3 30.09.2026
 * (t=83334141): 55 ключей очередей на 5 комнат, из них 54 пустых — 1 220 Б
 * в Memory, которая сериализуется целиком каждый тик (замер цены байта одним
 * протоколом: парс 5.0-5.2e-6, сериализация 2.3-2.8e-6 CPU/Б).
 *
 * Консольное удаление пустых очередей проблему не решает — тот же опыт
 * показал, что initRoomTasks возвращает ключи на первом обращении к комнате
 * (Memory 6 907 Б сразу после команды и 7 256 Б через 8 тиков, E35S37 снова
 * со всеми 11 типами).
 *
 * @param {string} roomName
 */
function initRoomTasks(roomName) {
  const h = heap();
  if (h.inited[roomName]) return;
  h.inited[roomName] = true;

  if (!Memory.rooms) {
    Memory.rooms = {};
  }
  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].tasks) {
    Memory.rooms[roomName].tasks = {};
  }
}

module.exports = {
  // Публичные: фасад task.manager.js отдаёт их наружу без изменений.
  TASK_CHAIN,
  TASK_TYPE_SET,
  hasDuplicate,
  // Внутренние (task/lookup.js, task/lifecycle.js): наружу не выходят.
  heap,
  taskKey,
  getExistingKeys,
  getQueueEntry,
  queueRef,
  countQueue,
  ensureIndex,
  reindex,
  initRoomTasks,
};
