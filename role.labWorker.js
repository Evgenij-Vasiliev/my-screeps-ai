/**
 * ===================================================
 * ROLE.LABWORKER.JS — Крип для обслуживания лабораторий
 * ===================================================
 * Задачи:
 * 1. Выгружает чужие ресурсы из лаб (если поменяли конфиг)
 * 2. Загружает реагенты из Terminal/Storage в Лаб1 и Лаб2
 * 3. Выгружает готовый продукт из реактора в Terminal/Storage
 *
 * Поддерживает несколько троек лаб в одной комнате:
 *   Memory.rooms['E35S37'].labs  — первая тройка
 *   Memory.rooms['E35S37'].labs2 — вторая тройка
 *   и так далее...
 *
 * Если в памяти крипа есть assignedLab — работает только с ней.
 * Если нет — перебирает все тройки по порядку.
 *
 * Память крипа:
 * - assignedLab {string} — закреплённая тройка (labs, labs2...)
 * - task        {string} — текущая задача
 * - resource    {string} — текущий ресурс
 * - amount      {number} — сколько взять
 * - labKey      {string} — какая тройка обслуживается сейчас
 * - targetId    {string} — ID структуры для текущей задачи
 * ===================================================
 */

const LAB_CAPACITY = 3000;

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const mem = creep.room.memory;

    // Собираем конфиги троек
    const allConfigs = [];
    if (creep.memory.assignedLab) {
      const config = mem[creep.memory.assignedLab];
      if (config) allConfigs.push({ key: creep.memory.assignedLab, config });
    } else {
      if (mem.labs) allConfigs.push({ key: "labs", config: mem.labs });
      if (mem.labs2) allConfigs.push({ key: "labs2", config: mem.labs2 });
      if (mem.labs3) allConfigs.push({ key: "labs3", config: mem.labs3 });
      if (mem.labs4) allConfigs.push({ key: "labs4", config: mem.labs4 });
      if (mem.labs5) allConfigs.push({ key: "labs5", config: mem.labs5 });
    }

    if (allConfigs.length === 0) {
      creep.say("❌ нет конфига");
      return;
    }

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;
    const source = terminal || storage;

    if (!source) {
      creep.say("❌ нет хранилища");
      return;
    }

    // Сбрасываем задачу если крип пустой
    if (creep.store.getUsedCapacity() === 0) {
      creep.memory.task = null;
      delete creep.memory.resource;
      delete creep.memory.amount;
      delete creep.memory.labKey;
      delete creep.memory.targetId;
    }

    // Ищем задачу если нет текущей
    if (!creep.memory.task) {
      for (const { key, config } of allConfigs) {
        const lab1 = Game.getObjectById(config.lab1);
        const lab2 = Game.getObjectById(config.lab2);
        const reactor = Game.getObjectById(config.reactor);

        if (!lab1 || !lab2 || !reactor) continue;

        // Приоритет 1: выгрузить чужой ресурс из lab1
        for (const resource in lab1.store) {
          if (resource !== config.reagent1) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = resource;
            creep.memory.targetId = config.lab1;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 2: выгрузить чужой ресурс из lab2
        for (const resource in lab2.store) {
          if (resource !== config.reagent2) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = resource;
            creep.memory.targetId = config.lab2;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 3: выгрузить чужой ресурс из реактора
        for (const resource in reactor.store) {
          if (resource !== config.product) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = resource;
            creep.memory.targetId = config.reactor;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 4: выгрузить готовый продукт из реактора
        if (reactor.store[config.product] > 0) {
          creep.memory.task = "unload_reactor";
          creep.memory.resource = config.product;
          creep.memory.labKey = key;
          break;
        }

        // Приоритет 5: загрузить реагент1 в lab1
        if (lab1.store[config.reagent1] < LAB_CAPACITY) {
          const needed = LAB_CAPACITY - lab1.store[config.reagent1];
          const available = source.store[config.reagent1] || 0;
          if (available > 0) {
            creep.memory.task = "load_lab1";
            creep.memory.resource = config.reagent1;
            creep.memory.amount = Math.min(
              needed,
              available,
              creep.store.getFreeCapacity(),
            );
            creep.memory.labKey = key;
            break;
          }
        }

        // Приоритет 6: загрузить реагент2 в lab2
        if (lab2.store[config.reagent2] < LAB_CAPACITY) {
          const needed = LAB_CAPACITY - lab2.store[config.reagent2];
          const available = source.store[config.reagent2] || 0;
          if (available > 0) {
            creep.memory.task = "load_lab2";
            creep.memory.resource = config.reagent2;
            creep.memory.amount = Math.min(
              needed,
              available,
              creep.store.getFreeCapacity(),
            );
            creep.memory.labKey = key;
            break;
          }
        }
      }

      if (!creep.memory.task) {
        creep.say("✅ всё ок");
        return;
      }
    }

    const currentConfig = mem[creep.memory.labKey];
    if (!currentConfig) {
      creep.memory.task = null;
      return;
    }

    const lab1 = Game.getObjectById(currentConfig.lab1);
    const lab2 = Game.getObjectById(currentConfig.lab2);
    const reactor = Game.getObjectById(currentConfig.reactor);

    // ── ОЧИСТКА ЛАБЫ ──────────────────────────────────────────────────────
    if (creep.memory.task === "clear_lab") {
      const target = Game.getObjectById(creep.memory.targetId);
      if (!target) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        const result = creep.withdraw(target, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
      } else {
        const result = creep.transfer(source, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }

    // ── ВЫГРУЗКА РЕАКТОРА ─────────────────────────────────────────────────
    if (creep.memory.task === "unload_reactor") {
      if (creep.store[creep.memory.resource] === 0) {
        const result = creep.withdraw(reactor, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(reactor, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
      } else {
        const result = creep.transfer(source, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }

    // ── ЗАГРУЗКА LAB1 ─────────────────────────────────────────────────────
    if (creep.memory.task === "load_lab1") {
      if (creep.store[creep.memory.resource] === 0) {
        const result = creep.withdraw(
          source,
          creep.memory.resource,
          creep.memory.amount,
        );
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) delete creep.memory.amount;
      } else {
        const result = creep.transfer(lab1, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(lab1, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }

    // ── ЗАГРУЗКА LAB2 ─────────────────────────────────────────────────────
    if (creep.memory.task === "load_lab2") {
      if (creep.store[creep.memory.resource] === 0) {
        const result = creep.withdraw(
          source,
          creep.memory.resource,
          creep.memory.amount,
        );
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) delete creep.memory.amount;
      } else {
        const result = creep.transfer(lab2, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(lab2, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }
  },
};
