const { TASK_CONFIG } = require("./constants");

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
 * @param {string} roomName
 * @param {string} taskType
 * @param {Function} [rangeFn]
 * @returns {Object|null}
 */
function getNextTask(roomName, taskType, rangeFn) {
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
  const limit = nearest ? TASK_CONFIG.NEAREST_SCAN_LIMIT : Infinity;

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

    if (bestIndex === -1 || range < bestRange) {
      best = task;
      bestIndex = i;
      bestRange = range;
    }

    checked++;

    // Ближе некуда (или лимит просмотра исчерпан) — дальше искать незачем.
    if (bestRange <= TASK_CONFIG.NEAREST_STOP_RANGE || checked >= limit) break;
  }

  if (bestIndex === -1) return null;

  entry.hint = bestIndex;
  return best;
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
  TASK_CHAIN,
  TASK_TYPE_SET,
  hasDuplicate,
  getTaskById,
  freeTasks,
  compactAll,
  initRoomTasks,
  addTask,
  getNextTask,
  reserveTask,
  releaseTask,
  completeTask,
  removeTask,
};
