/**
 * ===================================================
 * ROLE.WORKER.JS — Универсальный крип
 * ===================================================
 * Роль в памяти крипа: test_worker
 *
 * Логика работы:
 *
 * ШАГ 0 (вне цикла working):
 * - UNLOAD_LINK — проверяется первым делом.
 *   Только ОДИН воркер может разгружать линк за раз.
 *   Блокировка через creep.memory.unloadingLink = true.
 *   Пока первый разгружает — второй идёт к обычным задачам.
 *
 * ШАГ 1 (обычный цикл working):
 * - TOWER    → TERMINAL → SUPPLY → REPAIR → BUILD → UPGRADE
 *
 * Память крипа:
 * - working        {boolean} — false = сбор, true = работа
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

    // ── ШАГ 0: РАЗГРУЗКА ЛИНКА — вне цикла working ───────────────────────
    // Проверяем линк ДО всего остального.
    // Только один воркер разгружает линк за раз —
    // остальные пропускают этот шаг и идут к обычным задачам.
    const linksConfig = creep.room.memory.links;
    const storageLink = linksConfig
      ? Game.getObjectById(linksConfig.storage)
      : null;
    const storage = creep.room.storage;

    if (
      storageLink &&
      storageLink.store[RESOURCE_ENERGY] > 0 &&
      storage &&
      storage.store.getFreeCapacity() > 0
    ) {
      // Проверяем — не разгружает ли линк уже другой воркер
      const anotherUnloading = Object.values(Game.creeps).some(
        c =>
          c.name !== creep.name &&
          c.memory.role === creep.memory.role &&
          c.room.name === creep.room.name &&
          c.memory.unloadingLink === true,
      );

      if (!anotherUnloading || creep.memory.unloadingLink) {
        // Мы разгружаем линк — помечаем себя
        creep.memory.unloadingLink = true;

        // Несём энергию из линка в storage
        if (creep.store[RESOURCE_ENERGY] > 0) {
          const r = creep.transfer(storage, RESOURCE_ENERGY);
          if (r === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, {
              reusePath: 5,
              visualizePathStyle: { stroke: "#00ff00" },
            });
          }
          return;
        }

        // Крип пустой — идём к линку
        const r = creep.withdraw(storageLink, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(storageLink, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        return;
      }
    } else {
      // Линк пустой — снимаем флаг
      creep.memory.unloadingLink = false;
    }

    // ── ШАГ 1: обычный цикл working ──────────────────────────────────────

    // Переключение состояний
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

      // Нет задач — отходим от storage чтобы не блокировать проход
      if (!creep.memory.task) {
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
    if (!creep.memory.task) {
      creep.memory.task = TASKS.UPGRADE;
    }

    switch (creep.memory.task) {
      // ── ЗАПРАВКА БАШНИ ────────────────────────────────────────────────
      case TASKS.TOWER: {
        const storage = creep.room.storage;

        if (!storage || storage.store[RESOURCE_ENERGY] === 0) {
          creep.memory.task = null;
          creep.memory.taskTargetId = null;
          creep.say("⏳ нет энергии");
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

      // ── ЗАПРАВКА ТЕРМИНАЛА ЭНЕРГИЕЙ ───────────────────────────────────
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

      // ── ЗАПРАВКА SPAWN/EXTENSIONS ──────────────────────────────────────
      case TASKS.SUPPLY: {
        let target = Game.getObjectById(creep.memory.taskTargetId);

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
        let target = Game.getObjectById(creep.memory.taskTargetId);

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
        let site = Game.getObjectById(creep.memory.taskTargetId);

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

      // ── АПГРЕЙД ───────────────────────────────────────────────────────
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

    // Аварийный режим — storage пуст, копаем сами
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
