const { STORAGE, TERMINAL_SUPPLY, TASK_TYPES } = require("constants");

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
      case TASK_TYPES.OPERATE_FACTORY:
        return this.executeOperateFactory(creep, task);

      default:
        return this.RESULT.INVALID;
    }
  }

  executeTransfer(creep, task) {
    const source = Game.getObjectById(task.sourceId);
    const target = Game.getObjectById(task.targetId);

    if (!source || !target) return this.RESULT.INVALID;

    const foreignResource = this._findForeignResource(creep, task.resourceType);
    if (foreignResource) {
      const dump = creep.room.storage;
      if (!dump) return this.RESULT.INVALID;

      const result = creep.transfer(dump, foreignResource);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(dump);
        return this.RESULT.WORKING;
      }
      return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
    }

    const carrying = creep.store[task.resourceType] || 0;

    if (carrying === 0) {
      const roomLeft = this._transferRoomLeft(
        source,
        target,
        task.resourceType,
      );

      if (roomLeft <= 0) {
        return this.RESULT.DONE;
      }

      const result = creep.withdraw(source, task.resourceType);

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

    if (result !== OK) {
      return this.RESULT.INVALID;
    }

    if (this._transferRoomLeft(source, target, task.resourceType) <= 0) {
      return this.RESULT.DONE;
    }

    return this.RESULT.WORKING;
  }

  /**
   * Сколько ещё ресурса можно перенести из source в target прямо сейчас.
   * Учитывает квоту терминала (TERMINAL_SUPPLY), свободную ёмкость любого
   * другого ограниченного target (spawn/extension/tower/...), и резерв
   * storage (STORAGE.ENERGY_MIN) для энергии.
   * @param {Structure} source
   * @param {Structure} target
   * @param {ResourceConstant} resourceType
   * @returns {number}
   */
  _transferRoomLeft(source, target, resourceType) {
    const availableInSource = source.store[resourceType] || 0;
    if (availableInSource <= 0) {
      return 0;
    }

    let limit = availableInSource;

    if (target.structureType === STRUCTURE_TERMINAL) {
      const maxInTarget =
        resourceType === RESOURCE_ENERGY
          ? TERMINAL_SUPPLY.ENERGY_TARGET
          : resourceType === RESOURCE_BATTERY
          ? TERMINAL_SUPPLY.BATTERY_MAX
          : TERMINAL_SUPPLY.MINERAL_MAX;

      const freeInTarget = maxInTarget - (target.store[resourceType] || 0);
      limit = Math.min(limit, Math.max(freeInTarget, 0));
    } else if (
      target.store &&
      typeof target.store.getFreeCapacity === "function"
    ) {
      const freeInTarget = target.store.getFreeCapacity(resourceType) || 0;
      limit = Math.min(limit, freeInTarget);
    }

    if (
      source.structureType === STRUCTURE_STORAGE &&
      resourceType === RESOURCE_ENERGY
    ) {
      const reserve =
        STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
      const availableAboveReserve = availableInSource - reserve;
      limit = Math.min(limit, Math.max(availableAboveReserve, 0));
    }

    return limit;
  }

  /**
   * Возвращает первый найденный тип ресурса в store creep'а, не совпадающий
   * с ожидаемым для задачи, либо null.
   * @param {Creep} creep
   * @param {ResourceConstant} expectedResourceType
   * @returns {ResourceConstant|null}
   */
  _findForeignResource(creep, expectedResourceType) {
    for (const resourceType in creep.store) {
      if (
        resourceType !== expectedResourceType &&
        creep.store[resourceType] > 0
      ) {
        return resourceType;
      }
    }
    return null;
  }

  /**
   * Сколько ещё ресурса можно перенести из source в target прямо сейчас,
   * с учётом квоты терминала (TERMINAL_SUPPLY) и резерва storage
   * (STORAGE.ENERGY_MIN), если они применимы. Возвращает Infinity,
   * если ограничений нет (обычный transfer без квоты).
   * @param {Structure} source
   * @param {Structure} target
   * @param {ResourceConstant} resourceType
   * @returns {number}
   */
  _transferRoomLeft(source, target, resourceType) {
    const availableInSource = source.store[resourceType] || 0;
    if (availableInSource <= 0) {
      return 0;
    }

    let limit = availableInSource;

    if (target.structureType === STRUCTURE_TERMINAL) {
      const maxInTarget =
        resourceType === RESOURCE_ENERGY
          ? TERMINAL_SUPPLY.ENERGY_TARGET
          : resourceType === RESOURCE_BATTERY
          ? TERMINAL_SUPPLY.BATTERY_MAX
          : TERMINAL_SUPPLY.MINERAL_MAX;

      const freeInTarget = maxInTarget - (target.store[resourceType] || 0);
      limit = Math.min(limit, Math.max(freeInTarget, 0));
    }

    if (
      source.structureType === STRUCTURE_STORAGE &&
      resourceType === RESOURCE_ENERGY
    ) {
      const reserve =
        STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
      const availableAboveReserve = availableInSource - reserve;
      limit = Math.min(limit, Math.max(availableAboveReserve, 0));
    }

    return limit;
  }
  /**
   * Возвращает первый найденный тип ресурса в store creep'а, не совпадающий
   * с ожидаемым для задачи, либо null, если рюкзак чист от посторонних ресурсов.
   * @param {Creep} creep
   * @param {ResourceConstant} expectedResourceType
   * @returns {ResourceConstant|null}
   */
  _findForeignResource(creep, expectedResourceType) {
    for (const resourceType in creep.store) {
      if (
        resourceType !== expectedResourceType &&
        creep.store[resourceType] > 0
      ) {
        return resourceType;
      }
    }
    return null;
  }

  executeOperateFactory(creep, task) {
    const factory = Game.getObjectById(task.factoryId);
    const storage = Game.getObjectById(task.storageId);

    if (!factory || !storage) return this.RESULT.INVALID;

    // Несём энергию на фабрику.
    if (creep.store[RESOURCE_ENERGY] > 0) {
      const result = creep.transfer(factory, RESOURCE_ENERGY);

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory);
        return this.RESULT.WORKING;
      }

      return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
    }

    // Энергия выгружена, батарейки у creep пока нет — проверяем фабрику.
    if (creep.store[RESOURCE_BATTERY] === 0) {
      if (factory.store[RESOURCE_BATTERY] === 0) {
        return this.RESULT.DONE;
      }

      const result = creep.withdraw(factory, RESOURCE_BATTERY);

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory);
        return this.RESULT.WORKING;
      }

      return result === OK ? this.RESULT.WORKING : this.RESULT.INVALID;
    }

    // Батарейки у creep есть — несём в storage.
    const result = creep.transfer(storage, RESOURCE_BATTERY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage);
      return this.RESULT.WORKING;
    }

    if (result === OK && creep.store[RESOURCE_BATTERY] === 0) {
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
