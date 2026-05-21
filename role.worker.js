/**
 * ===================================================
 * ROLE.WORKER.JS — Универсальный крип
 * ===================================================
 * VERSION: 3.0
 * Роль в памяти крипа: test_worker
 *
 * ИЗМЕНЕНИЯ v3.0:
 * - Delivery логика полностью удалена.
 *   Доставкой в фабрику занимается role.deliveryWorker.js.
 * - Воркер отвечает только за room work:
 *   UNLOAD_LINK → TOWER → TERMINAL → SUPPLY → REPAIR → BUILD
 * - UPGRADE оставлен как fallback но на 8 уровне
 *   taskManager его не назначает (ticksToDowngrade > 100000).
 *
 * ЛОГИКА:
 * ШАГ 0: UNLOAD_LINK — один воркер за раз разгружает линк в storage.
 * ШАГ 1: рабочий цикл — набрать энергию → выполнить задачу.
 *
 * Память крипа:
 * - working        {boolean} — false = сбор энергии, true = работа
 * - task           {string}  — текущая задача
 * - taskTargetId   {string}  — ID цели
 * - unloadingLink  {boolean} — этот воркер разгружает линк
 * ===================================================
 */

const { taskManager, TASKS } = require("./taskManager");

const TERMINAL_ENERGY_MIN = 20000;

const roleWorker = {
  run: function (creep) {
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    const storage = creep.room.storage;

    // ── ШАГ 0: РАЗГРУЗКА ЛИНКА ───────────────────────────────────────────
    // Выполняется ДО рабочего цикла.
    // Только ОДИН воркер разгружает линк за раз.
    const linksConfig = creep.room.memory.links;
    const storageLink = linksConfig
      ? Game.getObjectById(linksConfig.storage)
      : null;

    if (
      storageLink &&
      storageLink.store[RESOURCE_ENERGY] > 0 &&
      storage &&
      storage.store.getFreeCapacity() > 0
    ) {
      const anotherUnloading = Object.values(Game.creeps).some(
        c =>
          c.name !== creep.name &&
          c.memory.role === creep.memory.role &&
          c.room.name === creep.room.name &&
          c.memory.unloadingLink === true,
      );

      if (!anotherUnloading || creep.memory.unloadingLink) {
        creep.memory.unloadingLink = true;

        if (creep.store[RESOURCE_ENERGY] > 0) {
          if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, {
              reusePath: 5,
              visualizePathStyle: { stroke: "#00ff00" },
            });
          }
          return;
        }

        if (creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storageLink, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        return;
      }
    } else {
      creep.memory.unloadingLink = false;
    }

    // ── ШАГ 1: РАБОЧИЙ ЦИКЛ ──────────────────────────────────────────────

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

    if (creep.memory.working) {
      taskManager.assignTask(creep, creep.room);

      if (!creep.memory.task) {
        // Нет задач — отходим от storage чтобы не блокировать проход
        if (storage && creep.pos.getRangeTo(storage) < 4) {
          creep.moveTo(creep.room.controller, {
            reusePath: 20,
            visualizePathStyle: { stroke: "#aaaaaa" },
          });
        }
        return;
      }

      this.doWork(creep);
    } else {
      this.getEnergy(creep);
    }
  },

  doWork: function (creep) {
    if (!creep.memory.task) return;

    switch (creep.memory.task) {
      // ── ЗАПРАВКА БАШНИ ────────────────────────────────────────────────
      case TASKS.TOWER: {
        const storage = creep.room.storage;

        if (!storage || storage.store[RESOURCE_ENERGY] === 0) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          return;
        }

        const towers = creep.room._towers || [];
        const needyTowers = towers
          .filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
          .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY]);

        if (needyTowers.length === 0) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          if (creep.store[RESOURCE_ENERGY] > 0) {
            if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
              creep.moveTo(storage, { reusePath: 5 });
            }
          }
          return;
        }

        const target = needyTowers[0];
        const r = creep.transfer(target, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
        if (r === OK) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
        }
        break;
      }

      // ── ЗАПРАВКА ТЕРМИНАЛА ────────────────────────────────────────────
      case TASKS.TERMINAL: {
        const terminal = creep.room.terminal;
        const storage = creep.room.storage;

        if (!terminal || !storage) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          return;
        }

        if (
          (terminal.store[RESOURCE_ENERGY] || 0) >= TERMINAL_ENERGY_MIN ||
          terminal.store.getFreeCapacity() === 0
        ) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          return;
        }

        const r = creep.transfer(terminal, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
        if (r === OK) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
        }
        break;
      }

      // ── ЗАПРАВКА SPAWN/EXTENSIONS ─────────────────────────────────────
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

      // ── РЕМОНТ ────────────────────────────────────────────────────────
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

      // ── СТРОИТЕЛЬСТВО ─────────────────────────────────────────────────
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

      // ── АПГРЕЙД (fallback) ────────────────────────────────────────────
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

    // Аварийный режим — storage пуст, копаем из источника
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
