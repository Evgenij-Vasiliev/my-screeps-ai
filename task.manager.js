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
  return true;
}

function getNextTask(roomName, taskType) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return null;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  for (let i = 0; i < queue.length; i++) {
    const reservedBy = queue[i].reservedBy;
    // ТЗ №1 (H6): запись, зарезервированная крипом, которого уже нет,
    // удлиняет просмотр очереди — считаем такие случаи отдельно.
    if (reservedBy && !Game.creeps[reservedBy]) {    }
    if (!reservedBy || !Game.creeps[reservedBy]) {
      return queue[i];
    }
  }

  if (queue.length === 0) {  } else {  }
  return null;
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
  reserveTask,
  releaseTask,
  completeTask,
  removeTask,
};
