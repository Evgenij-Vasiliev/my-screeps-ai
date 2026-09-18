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

// Проверка «категория из цепочки» за O(1) вместо TASK_CHAIN.includes()
// (ТЗ №1, P7): порядок цепочки остаётся единственным источником правды.
const TASK_TYPES = /** @type {Object<string, boolean>} */ ({});
for (let i = 0; i < TASK_CHAIN.length; i++) {
  TASK_TYPES[TASK_CHAIN[i]] = true;
}

function initRoomTasks(roomName) {
  // ТЗ №1 (счётчик): полный проход по TASK_CHAIN — измеряем число прогонов и
  // итераций. Ставится в консоли/heap-вызове, addTask больше его не вызывает.
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

/**
 * Возвращает (создавая при необходимости) очередь конкретной категории.
 * Полная инициализация всех категорий (initRoomTasks) нужна при первом
 * появлении комнаты; на каждом addTask достаточно своей категории — O(1)
 * вместо прохода по всему TASK_CHAIN (ТЗ №1, P7).
 * @param {string} roomName
 * @param {string} taskType
 * @returns {any[]}
 */
function ensureQueue(roomName, taskType) {
  if (!Memory.rooms) {
    Memory.rooms = {};
  }
  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  const roomMemory = Memory.rooms[roomName];
  if (!roomMemory.tasks) {
    roomMemory.tasks = {};
  }
  if (!roomMemory.tasks[taskType]) {
    roomMemory.tasks[taskType] = [];
  }
  return roomMemory.tasks[taskType];
}

// ── ПЕР-ТИКОВЫЙ КЕШ ПРОСМОТРА ОЧЕРЕДЕЙ ──────────────────────────────────
// В комнате обычно больше Worker'ов, чем доступных Task, поэтому каждый
// холостой воркер каждый тик заново обходил все категории TASK_CHAIN и
// повторно просматривал очереди — в том числе целиком, когда все Task уже
// зарезервированы живыми крипами. Внутри тика доступность Task только падает:
// генераторы отрабатывают до крипов, reserveTask занимает запись, а
// complete/remove её удаляют (добавить Task в этом же тике уже некому), поэтому
// результат просмотра стабилен на весь тик и его можно переиспользовать всем
// воркерам комнаты. Кеш живёт в heap (не в Memory — не платим за сериализацию)
// и сбрасывается при смене тика или объекта Memory (global reset, офлайн-тесты).

/**
 * Кеш просмотра очередей на текущий тик.
 * @returns {{ tick: number, memory: any, rooms: Object<string, any> }}
 */
function getScanCache() {
  const cache = global._taskScan;
  if (!cache || cache.tick !== Game.time || cache.memory !== Memory) {
    return (global._taskScan = {
      tick: Game.time,
      memory: Memory,
      rooms: {},
    });
  }
  return cache;
}

/**
 * Пер-тиковый кеш одной комнаты. `hasAny`: -1 — неизвестно, 0 — доступных Task
 * нет, 1 — есть. `categories[taskType]` — первая доступная Task категории (или
 * null), чтобы не сканировать одну и ту же очередь несколько раз за тик.
 * @param {string} roomName
 * @returns {{ categories: Object<string, any>, hasAny: number }}
 */
function getRoomScan(roomName) {
  const cache = getScanCache();
  let room = cache.rooms[roomName];
  if (!room) {
    room = cache.rooms[roomName] = { categories: {}, hasAny: -1 };
  }
  return room;
}

/**
 * Сбрасывает кеш комнаты после любого изменения очередей. Без этого воркеры
 * этого же тика увидели бы устаревший результат (например, только что
 * зарезервированную Task как свободную).
 * @param {string} roomName
 */
function invalidateScanCache(roomName) {
  const cache = global._taskScan;
  if (cache && cache.tick === Game.time && cache.memory === Memory) {
    delete cache.rooms[roomName];
  }
}

/**
 * Есть ли в комнате хоть одна доступная Task (не зарезервированная живым
 * крипом) по всему TASK_CHAIN. Холостой Worker проверяет это одним вызовом и,
 * если Task нет, не обходит цепочку категорий вообще. Отрицательный ответ
 * стабилен на тик и кешируется.
 * @param {string} roomName
 * @returns {boolean}
 */
function hasAvailableTask(roomName) {
  const room = getRoomScan(roomName);
  if (room.hasAny !== -1) {
    return room.hasAny === 1;
  }

  for (let i = 0; i < TASK_CHAIN.length; i++) {
    if (getNextTask(roomName, TASK_CHAIN[i])) {
      room.hasAny = 1;
      return true;
    }
  }

  room.hasAny = 0;
  return false;
}

function generateTaskId() {
  if (typeof global._taskIdSeq !== "number") {
    global._taskIdSeq = 0;
  }

  global._taskIdSeq++;
  return "task_" + global._taskIdSeq;
}

function findIndexByTaskId(queue, taskId) {
  // ТЗ №1 (счётчик): полный проход очереди на каждую reserve/complete/remove.
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].taskId === taskId) {
      return i;
    }
  }

  return -1;
}

function addTask(roomName, taskType, task) {
  if (!TASK_TYPES[taskType]) {    return false;
  }
  if (typeof task !== "object" || task === null) {    return false;
  }

  // Раньше здесь вызывался initRoomTasks (проход по всем 11 категориям на
  // каждую создаваемую задачу) — теперь только очередь своей категории.
  const queue = ensureQueue(roomName, taskType);

  if (typeof task.taskId === "undefined") {
    task.taskId = generateTaskId();
  }

  queue.push(task);
  // Новая Task меняет доступность — кеш просмотра комнаты недействителен.
  invalidateScanCache(roomName);
  return true;
}

/**
 * Первая доступная Task категории: не зарезервированная либо зарезервированная
 * крипом, которого уже нет. Результат (включая null) кешируется на тик, поэтому
 * повторные вызовы из цикла Worker'ов очередь не сканируют. Кеш сбрасывается
 * при любом изменении очереди (см. invalidateScanCache).
 * @param {string} roomName
 * @param {string} taskType
 * @returns {any|null}
 */
function getNextTask(roomName, taskType) {
  const room = getRoomScan(roomName);
  if (Object.prototype.hasOwnProperty.call(room.categories, taskType)) {
    return room.categories[taskType];
  }

  let task = null;
  const queue =
    Memory.rooms &&
    Memory.rooms[roomName] &&
    Memory.rooms[roomName].tasks &&
    Memory.rooms[roomName].tasks[taskType];

  if (queue) {
    for (let i = 0; i < queue.length; i++) {
      const reservedBy = queue[i].reservedBy;
      // Запись, зарезервированная крипом, которого уже нет, доступна снова.
      if (!reservedBy || !Game.creeps[reservedBy]) {
        task = queue[i];
        break;
      }
    }
  }

  room.categories[taskType] = task;
  return task;
}

function reserveTask(roomName, taskType, task, creepName) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return false;
  }

  if (!task || typeof task.taskId === "undefined") {    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {    return false;
  }

  // Резервация проставляется на реальном объекте очереди, а не на
  // переданном параметре — после сериализации Memory между тиками это
  // могут быть разные объекты с одинаковым taskId.
  queue[index].reservedBy = creepName;
  // Task занята — пер-тиковый кеш комнаты больше не отражает реальность.
  invalidateScanCache(roomName);
  return true;
}

function releaseTask(roomName, taskType, task) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return false;
  }

  if (!task || typeof task.taskId === "undefined") {    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {    return false;
  }

  delete queue[index].reservedBy;
  invalidateScanCache(roomName);
  return true;
}

function completeTask(roomName, taskType, task) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return false;
  }

  if (!task || typeof task.taskId === "undefined") {    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {    return false;
  }

  delete queue[index].reservedBy;
  queue.splice(index, 1);
  invalidateScanCache(roomName);
  return true;
}

function removeTask(roomName, taskType, task) {
  return completeTask(roomName, taskType, task);
}

module.exports = {
  TASK_CHAIN,
  initRoomTasks,
  addTask,
  getNextTask,
  hasAvailableTask,
  reserveTask,
  releaseTask,
  completeTask,
  removeTask,
};
