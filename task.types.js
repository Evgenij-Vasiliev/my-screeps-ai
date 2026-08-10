/**
 * TASK TYPES (Task System v4)
 * Константы и классы задач. Чистые структуры данных — без логики
 * исполнения и без обращений к Game/Memory.
 */

const TASK_TYPES = {
  TRANSFER: "transfer",
  BUILD: "build",
  REPAIR: "repair",
  UPGRADE: "upgrade",
};

/**
 * Базовый класс задачи. Все конкретные типы задач наследуются от него.
 */
class BaseTask {
  /**
   * @param {number} id — уникальный id задачи (выдаётся TaskManager'ом)
   * @param {string} type — один из TASK_TYPES
   */
  constructor(id, type) {
    this.id = id;
    this.type = type;
    this.created = Game.time;
    this.assignedTo = null;
    this.completed = false;
  }
}

/**
 * Универсальная логистическая задача: перенос ресурса
 * из одного объекта (store-owner) в другой.
 */
class TransferTask extends BaseTask {
  constructor(id, sourceId, targetId, resourceType, amount) {
    super(id, TASK_TYPES.TRANSFER);
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.resourceType = resourceType;
    this.amount = amount;
  }
}

/**
 * Задача постройки конкретного construction site.
 */
class BuildTask extends BaseTask {
  constructor(id, targetId) {
    super(id, TASK_TYPES.BUILD);
    this.targetId = targetId;
  }
}

/**
 * Задача ремонта конкретной структуры.
 */
class RepairTask extends BaseTask {
  constructor(id, targetId) {
    super(id, TASK_TYPES.REPAIR);
    this.targetId = targetId;
  }
}

/**
 * Задача апгрейда контроллера.
 */
class UpgradeTask extends BaseTask {
  constructor(id, targetId) {
    super(id, TASK_TYPES.UPGRADE);
    this.targetId = targetId;
  }
}

module.exports = {
  TASK_TYPES,
  BaseTask,
  TransferTask,
  BuildTask,
  RepairTask,
  UpgradeTask,
};
