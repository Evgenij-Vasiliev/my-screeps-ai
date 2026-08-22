const energySource = require("energySource");

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

module.exports = {
  executeFillSpawnsExtensions,
  executors: {
    fillSpawnsExtensions: executeFillSpawnsExtensions,
  },
};
