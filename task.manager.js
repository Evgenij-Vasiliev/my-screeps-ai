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
    global.__taskHeap = { tick: Game.time, keys: {}, byType: {}, inited: {}, queues: {} };
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
  const entry = { queue, indexById: new Map(), free: 0, dead: 0, hint: 0 };
  reindex(entry);

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

/** Пересобирает позиции и счётчики очереди. O(n), вызывается один раз на индекс. */
function reindex(entry) {
  const queue = entry.queue;
  const indexById = entry.indexById;

  indexById.clear();
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

    indexById.set(task.taskId, i);

    // Свободна не только незарезервированная задача: резервация умершего
    // крипа — тоже свобода (иначе очередь навсегда застряла бы на
    // «свободных нет», ведь пересчёт счётчика идёт раз в тик).
    if (!task.reservedBy || !Game.creeps[task.reservedBy]) entry.free++;
  }
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
  const index = entry.indexById.get(taskId);

  return index === undefined ? null : entry.queue[index] || null;
}

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

  const tasks = Memory.rooms[roomName].tasks;

  for (const taskType of TASK_CHAIN) {
    if (!tasks[taskType]) {
      tasks[taskType] = [];
    }
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

  initRoomTasks(roomName);

  if (typeof task.taskId === "undefined") {
    task.taskId = generateTaskId();
  }

  Memory.rooms[roomName].tasks[taskType].push(task);

  // Держим индекс очереди в согласии с Memory (если он уже построен).
  const h = heap();
  const entry = h.queues[roomName + "\u0001" + taskType];
  if (entry) {
    const queue = Memory.rooms[roomName].tasks[taskType];

    if (entry.queue !== queue) {
      // Массив подменили извне — индекс недействителен, пересобираем.
      entry.queue = queue;
      reindex(entry);
    } else {
      entry.indexById.set(task.taskId, queue.length - 1);
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

function getNextTask(roomName, taskType) {
  const entry = getQueueEntry(roomName, taskType);
  const queue = entry.queue;

  if (!queue || queue.length === 0) return null;

  // Все задачи заняты живыми крипами — обходить очередь незачем.
  if (entry.free <= 0) return null;

  if (entry.hint >= queue.length) entry.hint = 0;

  // Обход начинается с прошлой удачной позиции: свободные задачи обычно
  // лежат рядом, поэтому в типичном случае цикл заканчивается сразу.
  const len = queue.length;
  for (let step = 0; step < len; step++) {
    const i = (entry.hint + step) % len;
    const task = queue[i];

    if (!task) continue; // надгробие

    // Задача, зарезервированная умершим крипом, считается свободной.
    if (!task.reservedBy || !Game.creeps[task.reservedBy]) {
      entry.hint = i;
      return task;
    }
  }

  return null;
}

function reserveTask(roomName, taskType, task, creepName) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  // Берём объект ИЗ ОЧЕРЕДИ, а не переданный параметр: индекс хранит
  // позиции в Memory, и резервация должна попасть именно туда.
  const index = entry.indexById.get(task.taskId);
  const queued = index === undefined ? null : entry.queue[index];

  if (!queued) return false;

  if (!queued.reservedBy) entry.free--;
  queued.reservedBy = creepName;
  return true;
}

function releaseTask(roomName, taskType, task) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  const index = entry.indexById.get(task.taskId);
  const queued = index === undefined ? null : entry.queue[index];

  if (!queued) return false;

  if (queued.reservedBy) entry.free++;
  delete queued.reservedBy;
  return true;
}

function completeTask(roomName, taskType, task) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  const index = entry.indexById.get(task.taskId);

  if (index === undefined) return false;

  const queued = entry.queue[index];
  if (!queued) return false;

  if (queued.reservedBy) entry.free++;
  delete queued.reservedBy;

  // НАДГРОБИЕ вместо splice: массив не сдвигается, поэтому позиции в
  // indexById остаются верными до конца тика, а завершение задачи — O(1).
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
 * Сжатие на месте: объекты задач сохраняют идентичность, поэтому позиции
 * просто пересчитываются (reindex).
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
  compactAll,
  initRoomTasks,
  addTask,
  getNextTask,
  reserveTask,
  releaseTask,
  completeTask,
  removeTask,
};
