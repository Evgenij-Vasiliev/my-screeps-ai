const { TASK_TYPES } = require("task.types");

class TaskExecutors {
  constructor() {
    this.RESULT = {
      DONE: "done",
      INVALID: "invalid",
      NO_ENERGY: "noEnergy",
      WORKING: "working",
    };
  }

  execute(creep, task) {
    if (!task) return this.RESULT.INVALID;

    switch (task.type) {
      case TASK_TYPES.TRANSFER:
        return this.executeTransfer(creep, task);

      case TASK_TYPES.BUILD:
        return this.executeBuild(creep, task);

      case TASK_TYPES.REPAIR:
        return this.executeRepair(creep, task);

      case TASK_TYPES.UPGRADE:
        return this.executeUpgrade(creep, task);

      default:
        return this.RESULT.INVALID;
    }
  }

  executeTransfer(creep, task) {
    const source = Game.getObjectById(task.sourceId);
    const target = Game.getObjectById(task.targetId);

    if (!source || !target) return this.RESULT.INVALID;

    const carrying = creep.store[task.resourceType] || 0;

    if (carrying === 0) {
      const result = creep.withdraw(source, task.resourceType, task.amount);

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
        return this.RESULT.WORKING;
      }

      return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
    }

    const result = creep.transfer(target, task.resourceType);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
      return this.RESULT.WORKING;
    }

    if (result === OK && creep.store[task.resourceType] === 0) {
      return this.RESULT.DONE;
    }

    return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
  }
  executeBuild(creep, task) {
    const target = Game.getObjectById(task.targetId);

    if (!target) return this.RESULT.INVALID;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      return this.RESULT.NO_ENERGY;
    }

    const result = creep.build(target);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
      return this.RESULT.WORKING;
    }

    return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
  }
  executeRepair(creep, task) {
    const target = Game.getObjectById(task.targetId);

    if (!target) return this.RESULT.INVALID;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      return this.RESULT.NO_ENERGY;
    }

    if (target.hits >= target.hitsMax) {
      return this.RESULT.DONE;
    }

    const result = creep.repair(target);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
      return this.RESULT.WORKING;
    }

    return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
  }
  executeUpgrade(creep, task) {
    const target = Game.getObjectById(task.targetId);

    if (!target) return this.RESULT.INVALID;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      return this.RESULT.NO_ENERGY;
    }

    const result = creep.upgradeController(target);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target);
      return this.RESULT.WORKING;
    }

    return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
  }
}

module.exports = new TaskExecutors();
