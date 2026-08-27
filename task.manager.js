const TASK_CHAIN = [
  "fillSpawnsExtensions",
  "fillPowerSpawnPower",
  "fillPowerSpawnEnergy",
  "fillTerminalEnergy",
  "fillTerminalResources",
  "operateFactory",
  "repairStructures",
  "buildStructures",
  "fillTowers",
  "upgradeController",
];

function initRoomTasks(roomName) {
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

function findIndexByTaskId(queue, taskId) {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].taskId === taskId) {
      return i;
    }
  }

  return -1;
}

function addTask(roomName, taskType, task) {
  if (!TASK_CHAIN.includes(taskType)) {
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
  return true;
}

function getNextTask(roomName, taskType) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {
    return null;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];

  for (let i = 0; i < queue.length; i++) {
    if (!queue[i].reservedBy || !Game.creeps[queue[i].reservedBy]) {
      return queue[i];
    }
  }

  return null;
}

function reserveTask(roomName, taskType, task, creepName) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {
    return false;
  }

  if (!task || typeof task.taskId === "undefined") {
    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {
    return false;
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
  ) {
    return false;
  }

  if (!task || typeof task.taskId === "undefined") {
    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {
    return false;
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
  ) {
    return false;
  }

  if (!task || typeof task.taskId === "undefined") {
    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {
    return false;
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
