"use strict";

/**
 * task.types.js
 *
 * Единый источник форматов Task для Task System v4.
 * Никакой логики выполнения здесь нет — только данные.
 */

const { TASK_TYPES } = require("constants");

/**
 * BaseTask — общий каркас любой задачи.
 * Все остальные классы задач обязаны наследоваться от него.
 */
class BaseTask {
  /**
   * @param {string} type - один из TASK_TYPES
   */
  constructor(type) {
    this.id = null; // назначается TaskManager'ом при add()
    this.type = type; // тип задачи (TASK_TYPES.*)
    this.created = Game.time;
    this.assignedTo = null; // creep.name текущего исполнителя
    this.completed = false;
  }
}

/**
 * TransferTask — универсальная логистическая задача.
 * Один механизм для энергии, батареек, минералов и т.д.
 */
class TransferTask extends BaseTask {
  /**
   * @param {string} sourceId
   * @param {string} targetId
   * @param {ResourceConstant} resourceType
   */
  constructor(sourceId, targetId, resourceType) {
    super(TASK_TYPES.TRANSFER);
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.resourceType = resourceType;
  }
}

/**
 * BuildTask — постройка construction site.
 */
class BuildTask extends BaseTask {
  /**
   * @param {string} targetId
   */
  constructor(targetId) {
    super(TASK_TYPES.BUILD);
    this.targetId = targetId;
  }
}

/**
 * RepairTask — ремонт структуры.
 */
class RepairTask extends BaseTask {
  /**
   * @param {string} targetId
   */
  constructor(targetId) {
    super(TASK_TYPES.REPAIR);
    this.targetId = targetId;
  }
}

/**
 * UpgradeTask — апгрейд контроллера.
 */
class UpgradeTask extends BaseTask {
  /**
   * @param {string} targetId
   */
  constructor(targetId) {
    super(TASK_TYPES.UPGRADE);
    this.targetId = targetId;
  }
}

class OperateFactoryTask extends BaseTask {
  /**
   * @param {string} factoryId
   * @param {string} storageId
   */
  constructor(factoryId, storageId) {
    super(TASK_TYPES.OPERATE_FACTORY);
    this.factoryId = factoryId;
    this.storageId = storageId;
  }
}

module.exports = {
  BaseTask,
  TransferTask,
  BuildTask,
  RepairTask,
  UpgradeTask,
  OperateFactoryTask,
};
