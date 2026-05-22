/**
 * ===================================================
 * ROLE.WORKER.JS — Универсальный рабочий крип
 * ===================================================
 * VERSION: 4.0
 *
 * ИЗМЕНЕНИЯ v4.0:
 * - Удалён UNLOAD_LINK — занимается role.towerSupplier
 * - Удалены TOWER и TERMINAL — занимается role.towerSupplier
 * - Чистый рабочий цикл: SUPPLY → REPAIR → BUILD → UPGRADE
 *
 * ЦИКЛ:
 * 1. Пустой → берём энергию из storage
 * 2. Полный → выполняем задачу от taskManager
 * ===================================================
 */

const { taskManager, TASKS } = require("./taskManager");

const roleWorker = {
  run: function (creep) {
    const storage = creep.room.storage;

    // ── ПЕРЕКЛЮЧЕНИЕ РЕЖИМА ───────────────────────────────────────────────
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.memory.task = null;
      creep.memory.taskTargetId = null;
      creep.say("🔋 заряд");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("⚡ работа");
    }

    // ── РАБОТА ────────────────────────────────────────────────────────────
    if (creep.memory.working) {
      taskManager.assignTask(creep, creep.room);

      if (!creep.memory.task) {
        // Нет задач — отходим от storage
        if (storage && creep.pos.getRangeTo(storage) < 4) {
          creep.moveTo(creep.room.controller, {
            reusePath: 20,
            visualizePathStyle: { stroke: "#aaaaaa" },
          });
        }
        return;
      }

      this.doWork(creep);
      return;
    }

    // ── СБОР ЭНЕРГИИ ──────────────────────────────────────────────────────
    this.getEnergy(creep);
  },

  doWork: function (creep) {
    switch (creep.memory.task) {
      // ── SUPPLY ────────────────────────────────────────────────────────
      case TASKS.SUPPLY: {
        const target = Game.getObjectById(creep.memory.taskTargetId);
        if (!target || target.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          return;
        }
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
        break;
      }

      // ── REPAIR ────────────────────────────────────────────────────────
      case TASKS.REPAIR: {
        const target = Game.getObjectById(creep.memory.taskTargetId);
        if (!target || target.hits === target.hitsMax) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          return;
        }
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        break;
      }

      // ── BUILD ─────────────────────────────────────────────────────────
      case TASKS.BUILD: {
        const site = Game.getObjectById(creep.memory.taskTargetId);
        if (!site) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          return;
        }
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
          creep.moveTo(site, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        break;
      }

      // ── UPGRADE ───────────────────────────────────────────────────────
      case TASKS.UPGRADE: {
        const controller = creep.room.controller;
        if (!controller) return;
        if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
          creep.moveTo(controller, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        break;
      }

      default:
        creep.memory.task = null;
        break;
    }
  },

  getEnergy: function (creep) {
    const storage = creep.room.storage;

    if (storage && storage.store[RESOURCE_ENERGY] > 200) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
      }
      return;
    }

    // Аварийный режим — storage пуст
    creep.say("⚠️ авария");
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ff0000" },
        });
      }
    }
  },
};

module.exports = roleWorker;
