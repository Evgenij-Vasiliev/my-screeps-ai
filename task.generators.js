const taskManager = require("task.manager");
const { POWER_SPAWN } = require("./constants");

const TASK_TYPE = "fillSpawnsExtensions";

function isDuplicateTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks[TASK_TYPE]) ||
    [];

  // Резервация (reservedBy) намеренно не участвует в сравнении —
  // зарезервированная Task тоже считается существующей.
  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.targetId === candidate.targetId &&
      task.sourceId === candidate.sourceId &&
      task.resourceType === candidate.resourceType,
  );
}

function needsEnergy(target) {
  if (
    !target ||
    !target.store ||
    typeof target.store.getFreeCapacity !== "function"
  ) {
    return false;
  }

  return target.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
}

function collectSpawnsAndExtensions(room) {
  const spawns = room.find(FIND_MY_SPAWNS);
  const extensions = room.find(FIND_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_EXTENSION,
  });

  return spawns.concat(extensions);
}

function findPowerSpawn(room) {
  return room.find(FIND_MY_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_POWER_SPAWN,
  })[0];
}

function generateFillSpawnsExtensions(room) {
  if (!room.storage) {
    return;
  }

  const targets = collectSpawnsAndExtensions(room);

  for (const target of targets) {
    if (!needsEnergy(target)) {
      continue;
    }

    const candidate = {
      type: "transfer",
      sourceId: room.storage.id,
      targetId: target.id,
      resourceType: RESOURCE_ENERGY,
    };

    if (isDuplicateTask(room.name, candidate)) {
      continue;
    }

    taskManager.addTask(room.name, TASK_TYPE, candidate);
  }
}
function isDuplicatePowerSpawnPowerTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillPowerSpawnPower) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
}

function isDuplicatePowerSpawnEnergyTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillPowerSpawnEnergy) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.sourceId === candidate.sourceId &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
}

function generateFillPowerSpawnPower(room) {
  const powerSpawn = findPowerSpawn(room);
  if (!powerSpawn) {
    return;
  }

  if (powerSpawn.store[RESOURCE_POWER] >= POWER_SPAWN.POWER_MIN) {
    return;
  }

  const needed = powerSpawn.store.getFreeCapacity(RESOURCE_POWER);
  if (needed <= 0) {
    return;
  }

  const storagePower = room.storage ? room.storage.store[RESOURCE_POWER] : 0;
  const terminalPower = room.terminal ? room.terminal.store[RESOURCE_POWER] : 0;

  if (storagePower + terminalPower < needed) {
    return;
  }

  const candidate = {
    type: "transfer",
    targetId: powerSpawn.id,
    resourceType: RESOURCE_POWER,
  };

  if (isDuplicatePowerSpawnPowerTask(room.name, candidate)) {
    return;
  }

  taskManager.addTask(room.name, "fillPowerSpawnPower", candidate);
}

function generateFillPowerSpawnEnergy(room) {
  if (!room.storage) {
    return;
  }

  const powerSpawn = findPowerSpawn(room);
  if (!powerSpawn) {
    return;
  }

  if (powerSpawn.store[RESOURCE_ENERGY] >= POWER_SPAWN.ENERGY_MIN) {
    return;
  }

  const needed = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);
  if (needed <= 0) {
    return;
  }

  if (room.storage.store[RESOURCE_ENERGY] < needed) {
    return;
  }

  const candidate = {
    type: "transfer",
    sourceId: room.storage.id,
    targetId: powerSpawn.id,
    resourceType: RESOURCE_ENERGY,
  };

  if (isDuplicatePowerSpawnEnergyTask(room.name, candidate)) {
    return;
  }

  taskManager.addTask(room.name, "fillPowerSpawnEnergy", candidate);
}

module.exports = {
  generateFillSpawnsExtensions,
  generateFillPowerSpawnPower,
  generateFillPowerSpawnEnergy,
};
