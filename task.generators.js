const taskManager = require("task.manager");

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

module.exports = {
  generateFillSpawnsExtensions,
};
