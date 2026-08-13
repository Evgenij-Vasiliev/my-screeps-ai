"use strict";

const {
  TransferTask,
  BuildTask,
  RepairTask,
  UpgradeTask,
} = require("task.types");

const { STORAGE, TASK_TYPES, TERMINAL_SUPPLY } = require("constants");

/**
 * task.manager.js
 *
 * Единое ядро задач: FIFO-очередь + генераторы 7 постоянных задач.
 * Никакого scheduler/dispatcher/assignmentEngine — только линейный проход очереди.
 */

// Единый порог для заполнения башен.
// Один и тот же порог используется и генератором, и (при необходимости) исполнителем.
const TOWER_REFILL_THRESHOLD = 500;

// Единый порог для пополнения терминала энергией.
const TERMINAL_ENERGY_REFILL_THRESHOLD = 5000;

// Локальный лимит неэнергетических ресурсов, которые терминалу разрешено держать
// сверх которого излишек выгружается обратно в Storage.
const TERMINAL_RESOURCE_LOCAL_LIMIT = 10000;

const TASK_CHAIN = [
  "fillSpawnsExtensions",
  "fillTerminals",
  "operateFactory",
  "repairStructures",
  "buildStructures",
  "fillTowers",
  "upgradeController",
];

class TaskManager {
  constructor() {
    this.TASK_CHAIN = TASK_CHAIN;
    this.TOWER_REFILL_THRESHOLD = TOWER_REFILL_THRESHOLD;
    this.TERMINAL_ENERGY_REFILL_THRESHOLD = TERMINAL_ENERGY_REFILL_THRESHOLD;
    this.TERMINAL_RESOURCE_LOCAL_LIMIT = TERMINAL_RESOURCE_LOCAL_LIMIT;
  }

  // ---------------------------------------------------------------
  // 6.1 Память
  // ---------------------------------------------------------------

  ensureMemory() {
    if (!Memory.taskSystem) {
      Memory.taskSystem = {
        queue: [],
        nextId: 1,
      };
    }
  }

  // ---------------------------------------------------------------
  // 6.2 Обязательные методы
  // ---------------------------------------------------------------

  /**
   * Добавляет задачу в FIFO-очередь.
   * @param {BaseTask} task
   * @returns {number} id добавленной задачи
   */
  add(task) {
    this.ensureMemory();

    task.id = Memory.taskSystem.nextId;
    Memory.taskSystem.nextId += 1;

    Memory.taskSystem.queue.push(task);

    return task.id;
  }

  /**
   * Удаляет задачу из очереди по id (задача выполнена).
   * @param {number} taskId
   */
  complete(taskId) {
    this.ensureMemory();

    Memory.taskSystem.queue = Memory.taskSystem.queue.filter(
      task => task.id !== taskId,
    );
  }

  /**
   * Снимает назначение Worker с задачи, не удаляя саму задачу.
   * @param {number} taskId
   */
  release(taskId) {
    this.ensureMemory();

    const task = Memory.taskSystem.queue.find(t => t.id === taskId);
    if (task) {
      task.assignedTo = null;
    }
  }

  /**
   * Возвращает первую неназначенную задачу из очереди и назначает её worker'у.
   * @param {Creep} worker
   * @returns {object|null}
   */
  getNext(worker) {
    this.ensureMemory();

    for (const task of Memory.taskSystem.queue) {
      if (task.completed) {
        continue;
      }

      if (task.assignedTo && task.assignedTo !== worker.name) {
        continue;
      }

      const target = task.targetId ? Game.getObjectById(task.targetId) : null;
      const source = task.sourceId ? Game.getObjectById(task.sourceId) : null;

      const taskRoom = target?.room?.name || source?.room?.name;

      if (taskRoom && taskRoom !== worker.room.name) {
        continue;
      }

      task.assignedTo = worker.name;
      return task;
    }

    return null;
  }

  _releaseDeadWorkers() {
    if (!Memory.taskSystem || !Memory.taskSystem.queue) {
      return;
    }

    for (const task of Memory.taskSystem.queue) {
      if (!task.completed && task.assignedTo && !Game.creeps[task.assignedTo]) {
        task.assignedTo = null;
      }
    }
  }

  /**
   * Главный генератор задач комнаты.
   * Вызывается один раз за тик для каждой своей комнаты.
   * @param {Room} room
   */
  run(room) {
    this.ensureMemory();
    this._releaseDeadWorkers();

    // this.generateFillSpawnsExtensions(room);
    this.generateFillTerminals(room);
    // this.generateOperateFactory(room); // логистика фабрики (Storage <-> Factory)
    // this.runFactoryProduction(room); // действие фабрики (не Task, не Worker)
    // this.generateRepair(room);
    // this.generateBuild(room);
    // this.generateFillTowers(room);
    // this.generateUpgrade(room);
  }

  /**
   * runFactoryProduction — прямой вызов действия структуры Factory.
   *
   * Архитектурное решение (подтверждено):
   * factory.produce(RESOURCE_BATTERY) не является задачей Worker'а.
   * Это действие выполняет сама структура, а не creep, поэтому оно
   * не проходит через FIFO-очередь и не оформляется как Task.
   *
   * Единое условие производства (совпадает по смыслу с генератором
   * логистики в generateOperateFactory — правило "generator === executor"):
   *   cooldown === 0
   *   и достаточно энергии для производства батарейки.
   *
   * @param {Room} room
   */
  runFactoryProduction(room) {
    const factory = room.factory;
    if (!factory) {
      return;
    }

    if (factory.cooldown === 0 && factory.store[RESOURCE_ENERGY] >= 600) {
      factory.produce(RESOURCE_BATTERY);
    }
  }

  // ---------------------------------------------------------------
  // Вспомогательное: проверка "такая задача уже есть в очереди"
  // Чтобы run() можно было безопасно вызывать каждый тик, не плодя дубликаты.
  // ---------------------------------------------------------------

  _hasQueuedTask(predicate) {
    return Memory.taskSystem.queue.some(
      task => !task.completed && predicate(task),
    );
  }

  // ---------------------------------------------------------------
  // 7.1 fillSpawnsExtensions
  // ---------------------------------------------------------------

  generateFillSpawnsExtensions(room) {
    if (!room.storage) {
      return;
    }

    const targets = room.find(FIND_MY_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    for (const target of targets) {
      const alreadyQueued = this._hasQueuedTask(
        task =>
          task.type === TASK_TYPES.TRANSFER && task.targetId === target.id,
      );
      if (alreadyQueued) {
        continue;
      }

      this.add(new TransferTask(room.storage.id, target.id, RESOURCE_ENERGY));
    }
  }

  // ---------------------------------------------------------------
  // 7.2 fillTowers
  // ---------------------------------------------------------------

  generateFillTowers(room) {
    if (!room.storage) {
      return;
    }

    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_TOWER &&
        s.store[RESOURCE_ENERGY] < this.TOWER_REFILL_THRESHOLD,
    });

    for (const tower of towers) {
      const alreadyQueued = this._hasQueuedTask(
        task => task.type === TASK_TYPES.TRANSFER && task.targetId === tower.id,
      );
      if (alreadyQueued) {
        continue;
      }

      this.add(new TransferTask(room.storage.id, tower.id, RESOURCE_ENERGY));
    }
  }

  // ---------------------------------------------------------------
  // 7.3 buildStructures
  // ---------------------------------------------------------------

  generateBuild(room) {
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    if (sites.length === 0) {
      return;
    }

    const target = sites[0];

    const alreadyQueued = this._hasQueuedTask(
      task => task.type === TASK_TYPES.BUILD && task.targetId === target.id,
    );
    if (alreadyQueued) {
      return;
    }

    this.add(new BuildTask(target.id));
  }

  // ---------------------------------------------------------------
  // 7.4 repairStructures
  // ---------------------------------------------------------------

  generateRepair(room) {
    const structures = room.find(FIND_STRUCTURES, {
      filter: s =>
        s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART &&
        s.hits < s.hitsMax,
    });

    if (structures.length === 0) {
      return;
    }

    // В очереди может существовать только одна активная
    // RepairTask для этой комнаты.
    const alreadyQueued = this._hasQueuedTask(
      task =>
        task.type === TASK_TYPES.REPAIR &&
        task.targetId &&
        Game.getObjectById(task.targetId)?.room?.name === room.name,
    );

    if (alreadyQueued) {
      return;
    }

    // Берём только одну текущую цель.
    this.add(new RepairTask(structures[0].id));
  }

  // ---------------------------------------------------------------
  // 7.5 upgradeController
  // ---------------------------------------------------------------

  generateUpgrade(room) {
    if (!room.controller || !room.controller.my) {
      return;
    }

    const alreadyQueued = this._hasQueuedTask(
      task =>
        task.type === TASK_TYPES.UPGRADE &&
        task.targetId === room.controller.id,
    );
    if (alreadyQueued) {
      return;
    }

    this.add(new UpgradeTask(room.controller.id));
  }

  // ---------------------------------------------------------------
  // 7.6 fillTerminals
  // ---------------------------------------------------------------

  generateFillTerminals(room) {
    if (!room.storage || !room.terminal) {
      return;
    }

    const terminal = room.terminal;
    const storage = room.storage;

    const terminalReserve =
      STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
    const terminalEnergy = terminal.store[RESOURCE_ENERGY];
    const storageEnergy = storage.store[RESOURCE_ENERGY];

    if (
      terminalEnergy < TERMINAL_SUPPLY.ENERGY_TARGET &&
      storageEnergy > terminalReserve
    ) {
      const alreadyQueuedEnergy = this._hasQueuedTask(
        task =>
          task.type === TASK_TYPES.TRANSFER &&
          task.sourceId === storage.id &&
          task.targetId === terminal.id &&
          task.resourceType === RESOURCE_ENERGY,
      );

      if (!alreadyQueuedEnergy) {
        this.add(new TransferTask(storage.id, terminal.id, RESOURCE_ENERGY));
      }
    }

    for (const resourceType in storage.store) {
      if (resourceType === RESOURCE_ENERGY) {
        continue;
      }

      const amountInStorage = storage.store[resourceType];
      if (amountInStorage <= 0) {
        continue;
      }

      const maxInTerminal = this._resourceMaxForTerminal(resourceType);
      const amountInTerminal = terminal.store[resourceType] || 0;

      if (amountInTerminal >= maxInTerminal) {
        continue;
      }

      const alreadyQueuedOut = this._hasQueuedTask(
        task =>
          task.type === TASK_TYPES.TRANSFER &&
          task.sourceId === storage.id &&
          task.targetId === terminal.id &&
          task.resourceType === resourceType,
      );
      if (alreadyQueuedOut) {
        continue;
      }

      this.add(new TransferTask(storage.id, terminal.id, resourceType));
    }
  }

  /**
   * Возвращает лимит терминала для конкретного типа ресурса.
   * RESOURCE_BATTERY -> BATTERY_MAX, всё остальное (минералы, компаунды) -> MINERAL_MAX
   * (значения намеренно равны в constants.js).
   * @param {ResourceConstant} resourceType
   * @returns {number}
   */
  _resourceMaxForTerminal(resourceType) {
    if (resourceType === RESOURCE_BATTERY) {
      return TERMINAL_SUPPLY.BATTERY_MAX;
    }
    return TERMINAL_SUPPLY.MINERAL_MAX;
  }

  // ---------------------------------------------------------------
  // 7.7 operateFactory
  // ---------------------------------------------------------------

  generateOperateFactory(room) {
    if (!room.storage || !room.factory) {
      return;
    }

    const factory = room.factory;
    const storage = room.storage;

    if (storage.store[RESOURCE_ENERGY] <= STORAGE.ENERGY_MIN) {
      return;
    }

    const alreadyQueued = this._hasQueuedTask(
      task => task.type === TASK_TYPES.OPERATE_FACTORY,
    );

    if (alreadyQueued) {
      return;
    }

    this.add(new OperateFactoryTask(factory.id, storage.id));
  }
}

module.exports = new TaskManager();
