/**
 * TASK EXECUTORS (Task System v4)
 * Класс-исполнитель. Диспетчер по task.type, каждый executeX()
 * выполняет один шаг работы Worker'а за тик и возвращает статус.
 *
 * Executor НЕ генерирует задачи и НЕ вызывает factory.produce() —
 * это ответственность TaskManager (см. task.manager.js).
 */

const { TASK_TYPES } = require("task.types");

class TaskExecutors {
  static RESULT = {
    WORKING: "working",
    DONE: "done",
    INVALID: "invalid",
    NO_ENERGY: "no_energy",
  };

  execute(creep, task) {
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
        return TaskExecutors.RESULT.INVALID;
    }
  }

  executeTransfer(creep, task) {
    const source = Game.getObjectById(task.sourceId);
    const target = Game.getObjectById(task.targetId);

    if (!source || !target) {
      return TaskExecutors.RESULT.INVALID;
    }

    const carrying = creep.store.getUsedCapacity(task.resourceType) || 0;

    if (carrying === 0) {
      const available = (source.store && source.store[task.resourceType]) || 0;
      if (available === 0) {
        return TaskExecutors.RESULT.DONE;
      }
      if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source);
        return TaskExecutors.RESULT.WORKING;
      }
      const result = creep.withdraw(source, task.resourceType);
      if (result !== OK && result !== ERR_FULL) {
        return TaskExecutors.RESULT.INVALID;
      }
      return TaskExecutors.RESULT.WORKING;
    }

    const targetFree = target.store
      ? target.store.getFreeCapacity(task.resourceType)
      : 0;
    if (targetFree === 0) {
      return TaskExecutors.RESULT.DONE;
    }
    if (creep.pos.getRangeTo(target) > 1) {
      creep.moveTo(target);
      return TaskExecutors.RESULT.WORKING;
    }

    const transferAmount = Math.min(carrying, task.amount, targetFree);
    const transferResult = creep.transfer(
      target,
      task.resourceType,
      transferAmount,
    );

    if (transferResult === OK) {
      task.amount -= transferAmount;
      if (task.amount <= 0) {
        return TaskExecutors.RESULT.DONE;
      }
    }
    return TaskExecutors.RESULT.WORKING;
  }

  executeBuild(creep, task) {
    const target = Game.getObjectById(task.targetId);
    if (!target) return TaskExecutors.RESULT.DONE;
    if (creep.store[RESOURCE_ENERGY] === 0)
      return TaskExecutors.RESULT.NO_ENERGY;
    if (creep.pos.getRangeTo(target) > 3) {
      creep.moveTo(target);
      return TaskExecutors.RESULT.WORKING;
    }
    const result = creep.build(target);
    if (result !== OK) return TaskExecutors.RESULT.INVALID;
    return TaskExecutors.RESULT.WORKING;
  }

  executeRepair(creep, task) {
    const target = Game.getObjectById(task.targetId);
    if (!target) return TaskExecutors.RESULT.INVALID;
    if (target.hits >= target.hitsMax) return TaskExecutors.RESULT.DONE;
    if (creep.store[RESOURCE_ENERGY] === 0)
      return TaskExecutors.RESULT.NO_ENERGY;
    if (creep.pos.getRangeTo(target) > 3) {
      creep.moveTo(target);
      return TaskExecutors.RESULT.WORKING;
    }
    creep.repair(target);
    return TaskExecutors.RESULT.WORKING;
  }

  executeUpgrade(creep, task) {
    const controller = Game.getObjectById(task.targetId);
    if (!controller) return TaskExecutors.RESULT.INVALID;
    if (creep.store[RESOURCE_ENERGY] === 0)
      return TaskExecutors.RESULT.NO_ENERGY;
    if (creep.pos.getRangeTo(controller) > 3) {
      creep.moveTo(controller);
      return TaskExecutors.RESULT.WORKING;
    }
    creep.upgradeController(controller);
    return TaskExecutors.RESULT.WORKING;
  }
}

module.exports = TaskExecutors;
