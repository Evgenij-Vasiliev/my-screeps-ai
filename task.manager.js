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
      set.add(taskKey(tasks[i], fields));
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
 * Индекс одной очереди на текущий тик (задание 9, часть 2).
 *
 * byId хранит ССЫЛКИ на объекты задач из Memory. Ссылки переживают splice:
 * элементы меняют позицию в массиве, но не идентичность. Поэтому индекс
 * остаётся верным и после удаления задач — перестраивать его не нужно.
 *
 * free — сколько задач никем не зарезервировано. Позволяет ответить
 * «свободных нет» за O(1), не обходя очередь (в E35S37 до 162 задач).
 */
function getQueueEntry(roomName, taskType) {
  const h = heap();
  const key = roomName + "\u0001" + taskType;

  const cached = h.queues[key];
  if (cached) return cached;

  const queue =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks[taskType]) ||
    null;

  const byId = new Map();
  let free = 0;

  if (queue) {
    for (let i = 0; i < queue.length; i++) {
      const task = queue[i];
      byId.set(task.taskId, task);
      // Свободна не только незарезервированная задача: резервация умершего
      // крипа — тоже свобода (иначе очередь навсегда застряла бы на
      // «свободных нет», ведь пересчёт счётчика идёт раз в тик).
      if (!task.reservedBy || !Game.creeps[task.reservedBy]) free++;
    }
  }

  const entry = { queue, byId, free, hint: 0 };
  h.queues[key] = entry;
  return entry;
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
  return entry.byId.get(taskId) || null;
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
    entry.queue = Memory.rooms[roomName].tasks[taskType];
    entry.byId.set(task.taskId, task);
    if (!task.reservedBy) entry.free++;
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

  // Обход начинается с прошлой удачной позиции: свободные задачи обычно
  // лежат рядом, поэтому в типичном случае цикл заканчивается сразу.
  const len = queue.length;
  for (let step = 0; step < len; step++) {
    const i = (entry.hint + step) % len;
    const task = queue[i];

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
  // ссылки на Memory, и резервация должна попасть именно туда.
  const queued = entry.byId.get(task.taskId);

  if (!queued) return false;

  if (!queued.reservedBy) entry.free--;
  queued.reservedBy = creepName;
  return true;
}

function releaseTask(roomName, taskType, task) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  const queued = entry.byId.get(task.taskId);

  if (!queued) return false;

  if (queued.reservedBy) entry.free++;
  delete queued.reservedBy;
  return true;
}

function completeTask(roomName, taskType, task) {
  if (!task || task.taskId === undefined) return false;

  const entry = getQueueEntry(roomName, taskType);
  const queued = entry.byId.get(task.taskId);

  if (!queued) return false;

  if (queued.reservedBy) entry.free++;
  delete queued.reservedBy;

  // splice оставлен намеренно: он держит Memory чистой (никаких null-дыр,
  // которые уехали бы в сериализацию). Стоит он O(n) сдвига ОДИН раз за
  // завершение задачи, а не O(n) поиска на каждую операцию, как раньше.
  const index = entry.queue.indexOf(queued);
  if (index !== -1) entry.queue.splice(index, 1);

  entry.byId.delete(task.taskId);

  if (entry.hint >= entry.queue.length) entry.hint = 0;
  return true;
}

function removeTask(roomName, taskType, task) {
  return completeTask(roomName, taskType, task);
}

module.exports = {
  TASK_CHAIN,
  TASK_TYPE_SET,
  hasDuplicate,
  getTaskById,
  initRoomTasks,
  addTask,
  getNextTask,
  reserveTask,
  releaseTask,
  completeTask,
  removeTask,
};
