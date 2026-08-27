const energySource = require("energySource");

function withdrawPower(creep) {
  const storage = creep.room.storage;
  const terminal = creep.room.terminal;

  if (storage && storage.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(storage, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 15 });
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  if (terminal && terminal.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(terminal, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(terminal, { reusePath: 15 });
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  return false;
}

function isValidPowerSpawnTask(task, resourceType) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.targetId &&
    task.resourceType === resourceType
  );
}

function isValidTask(task) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.sourceId &&
    !!task.targetId &&
    task.resourceType === RESOURCE_ENERGY
  );
}

function isTargetFull(target) {
  if (
    target &&
    target.store &&
    typeof target.store.getFreeCapacity === "function"
  ) {
    return target.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  }
  return false;
}

function executeFillSpawnsExtensions(creep, task) {
  if (!isValidTask(task)) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    const withdrawn = energySource.withdrawFromStorage(creep);

    if (!withdrawn) {
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (isTargetFull(target)) {
    return "DONE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return isTargetFull(target) ? "DONE" : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.moveTo(target, { reusePath: 15 });
      return "CONTINUE";

    case ERR_FULL:
      return "DONE";

    case ERR_INVALID_TARGET:
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      return "SKIP";

    default:
      return "SKIP";
  }
}

function executeFillTerminalEnergy(creep, task) {
  if (!isValidTask(task) || task.resourceType !== RESOURCE_ENERGY) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    const withdrawn = energySource.withdrawFromStorage(creep);

    if (!withdrawn) {
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (isTargetFull(target)) {
    return "DONE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return isTargetFull(target) ? "DONE" : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.moveTo(target, { reusePath: 15 });
      return "CONTINUE";

    case ERR_FULL:
      return "DONE";

    case ERR_INVALID_TARGET:
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      return "SKIP";

    default:
      return "SKIP";
  }
}

function executeFillTerminalResources(creep, task) {
  if (
    !task ||
    task.type !== "transfer" ||
    !task.sourceId ||
    !task.targetId ||
    !task.resourceType
  ) {
    return "SKIP";
  }

  const source = Game.getObjectById(task.sourceId);
  const target = Game.getObjectById(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  const resourceType = task.resourceType;

  if (creep.store[resourceType] === 0) {
    const result = creep.withdraw(source, resourceType);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 15 });
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    return "SKIP";
  }

  if (target.store.getFreeCapacity(resourceType) === 0) {
    return "DONE";
  }

  const result = creep.transfer(target, resourceType);

  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 15 });
    return "CONTINUE";
  }

  if (result === OK) {
    return creep.store[resourceType] === 0 ? "DONE" : "CONTINUE";
  }

  if (result === ERR_FULL) {
    return "DONE";
  }

  return "SKIP";
}

function executeFillPowerSpawnPower(creep, task) {
  if (!isValidPowerSpawnTask(task, RESOURCE_POWER)) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);
  if (!target) {
    return "SKIP";
  }

  const storage = creep.room.storage;
  const carrying = creep.store[RESOURCE_POWER];
  const targetFull = target.store.getFreeCapacity(RESOURCE_POWER) === 0;

  if (carrying === 0) {
    if (targetFull) {
      return "DONE";
    }

    return withdrawPower(creep) ? "CONTINUE" : "SKIP";
  }

  if (!targetFull) {
    const result = creep.transfer(target, RESOURCE_POWER);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 15 });
      return "CONTINUE";
    }

    if (result === OK || result === ERR_FULL) {
      return creep.store[RESOURCE_POWER] === 0 ? "DONE" : "CONTINUE";
    }

    return "SKIP";
  }

  if (!storage) {
    return "SKIP";
  }

  const dropResult = creep.transfer(storage, RESOURCE_POWER);

  if (dropResult === ERR_NOT_IN_RANGE) {
    creep.moveTo(storage, { reusePath: 15 });
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return creep.store[RESOURCE_POWER] === 0 ? "DONE" : "CONTINUE";
  }

  return "SKIP";
}

function executeFillPowerSpawnEnergy(creep, task) {
  if (!isValidPowerSpawnTask(task, RESOURCE_ENERGY) || !task.sourceId) {
    return "SKIP";
  }

  const target = Game.getObjectById(task.targetId);
  const source = Game.getObjectById(task.sourceId);

  if (!target || !source) {
    return "SKIP";
  }

  const carrying = creep.store[RESOURCE_ENERGY];
  const targetFull = target.store.getFreeCapacity(RESOURCE_ENERGY) === 0;

  if (carrying === 0) {
    if (targetFull) {
      return "DONE";
    }

    const result = creep.withdraw(source, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 15 });
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    return "DONE";
  }

  if (!targetFull) {
    const result = creep.transfer(target, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 15 });
      return "CONTINUE";
    }

    if (result === OK || result === ERR_FULL) {
      return "CONTINUE";
    }

    return "SKIP";
  }

  const dropResult = creep.transfer(source, RESOURCE_ENERGY);

  if (dropResult === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { reusePath: 15 });
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return creep.store[RESOURCE_ENERGY] === 0 ? "DONE" : "CONTINUE";
  }

  return "SKIP";
}

module.exports = {
  executeFillSpawnsExtensions,
  executeFillPowerSpawnPower,
  executeFillPowerSpawnEnergy,
  executors: {
    fillSpawnsExtensions: executeFillSpawnsExtensions,
    fillTerminalEnergy: executeFillTerminalEnergy,
    fillTerminalResources: executeFillTerminalResources,
    fillPowerSpawnPower: executeFillPowerSpawnPower,
    fillPowerSpawnEnergy: executeFillPowerSpawnEnergy,
  },
};
