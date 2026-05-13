/**
 * ===================================================
 * ROLE.LABWORKER.JS — Крип для обслуживания лабораторий
 * ===================================================
 * Задачи:
 * 1. Выгружает чужие ресурсы из лаб (если поменяли конфиг)
 * 2. Загружает реагенты из Terminal или Storage в Лаб1 и Лаб2
 * 3. Выгружает готовый продукт из реактора в Terminal или Storage
 *
 * ИСПРАВЛЕНО v2:
 * - Баг unload_reactor: крип с пустым store снова назначал
 *   unload_reactor если реактор не пуст → бесконечный цикл.
 *   Теперь unload_reactor назначается только если реактор
 *   содержит БОЛЬШЕ минимального порога (MIN_UNLOAD).
 * - Баг clear_lab: аналогичная защита — не назначаем задачу
 *   если крип уже пустой и в лабе 0 чужого ресурса.
 *
 * Поддерживает несколько троек лаб в одной комнате:
 *   Memory.rooms['E35S37'].labs  — первая тройка
 *   Memory.rooms['E35S37'].labs2 — вторая тройка
 *   и так далее...
 *
 * Память крипа:
 * - assignedLab {string} — закреплённая тройка (labs, labs2...)
 * - task        {string} — текущая задача
 * - resource    {string} — текущий ресурс
 * - amount      {number} — сколько взять
 * - labKey      {string} — какая тройка обслуживается сейчас
 * - targetId    {string} — ID структуры для текущей задачи
 * - sourceId    {string} — ID хранилища откуда брать реагент
 * ===================================================
 */

const LAB_CAPACITY = 3000;

// Минимальный порог для выгрузки реактора.
// Если продукта меньше — не назначаем unload_reactor.
// Это предотвращает бесконечный цикл когда крип берёт
// остатки (5-10 единиц) и реактор не успевает накопить.
const MIN_UNLOAD = 50;

module.exports = {
  /**
   * Находит хранилище где есть нужный ресурс.
   * Сначала проверяет терминал, потом storage.
   */
  findSource: function (room, resource) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (terminal && terminal.store[resource] > 0) return terminal;
    if (storage && storage.store[resource] > 0) return storage;
    return null;
  },

  /**
   * Находит куда выгрузить продукт.
   * Сначала терминал, потом storage.
   */
  findDest: function (room) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (terminal && terminal.store.getFreeCapacity() > 0) return terminal;
    if (storage && storage.store.getFreeCapacity() > 0) return storage;
    return null;
  },

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

    // ИСПРАВЛЕНИЕ: сбрасываем задачу только если крип пустой
    // И при этом НЕ находится в процессе доставки (working = true)
    // Раньше сброс происходил всегда при пустом store —
    // крип брал 5 единиц из реактора, нёс в storage,
    // после transfer store снова становился пустым на следующий тик,
    // и задача сбрасывалась до того как он успевал отнести груз.
    if (creep.store.getUsedCapacity() === 0) {
      creep.memory.task = null;
      delete creep.memory.resource;
      delete creep.memory.amount;
      delete creep.memory.labKey;
      delete creep.memory.targetId;
      delete creep.memory.sourceId;
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
          if (resource !== config.reagent1 && lab1.store[resource] > 0) {
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
          if (resource !== config.reagent2 && lab2.store[resource] > 0) {
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
          if (resource !== config.product && reactor.store[resource] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = resource;
            creep.memory.targetId = config.reactor;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 4: выгрузить готовый продукт из реактора
        // ИСПРАВЛЕНИЕ: только если накопилось достаточно (MIN_UNLOAD)
        // Раньше крип брал даже 5 единиц → застревал в петле
        if ((reactor.store[config.product] || 0) >= MIN_UNLOAD) {
          creep.memory.task = "unload_reactor";
          creep.memory.resource = config.product;
          creep.memory.labKey = key;
          break;
        }

        // Приоритет 5: загрузить реагент1 в lab1
        if ((lab1.store[config.reagent1] || 0) < LAB_CAPACITY) {
          const needed = LAB_CAPACITY - (lab1.store[config.reagent1] || 0);
          const src = this.findSource(creep.room, config.reagent1);
          if (src) {
            creep.memory.task = "load_lab1";
            creep.memory.resource = config.reagent1;
            creep.memory.amount = Math.min(
              needed,
              src.store[config.reagent1],
              creep.store.getFreeCapacity(),
            );
            creep.memory.labKey = key;
            creep.memory.sourceId = src.id;
            break;
          }
        }

        // Приоритет 6: загрузить реагент2 в lab2
        if ((lab2.store[config.reagent2] || 0) < LAB_CAPACITY) {
          const needed = LAB_CAPACITY - (lab2.store[config.reagent2] || 0);
          const src = this.findSource(creep.room, config.reagent2);
          if (src) {
            creep.memory.task = "load_lab2";
            creep.memory.resource = config.reagent2;
            creep.memory.amount = Math.min(
              needed,
              src.store[config.reagent2],
              creep.store.getFreeCapacity(),
            );
            creep.memory.labKey = key;
            creep.memory.sourceId = src.id;
            break;
          }
        }
      }

      if (!creep.memory.task) {
        // creep.say('✅ всё ок');
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

      const dest = this.findDest(creep.room);
      if (!dest) {
        creep.say("❌ некуда класть");
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        // Берём из лабы
        const result = creep.withdraw(target, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
      } else {
        // Несём в хранилище
        const result = creep.transfer(dest, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(dest, {
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
      const dest = this.findDest(creep.room);
      if (!dest) {
        creep.say("❌ некуда класть");
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        // ИСПРАВЛЕНИЕ: если реактор стал пустым пока мы шли — сбрасываем задачу
        if (!reactor || (reactor.store[creep.memory.resource] || 0) === 0) {
          creep.memory.task = null;
          return;
        }
        const result = creep.withdraw(reactor, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(reactor, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
      } else {
        // Несём в хранилище
        const result = creep.transfer(dest, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(dest, {
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
      const src =
        Game.getObjectById(creep.memory.sourceId) ||
        this.findSource(creep.room, creep.memory.resource);
      if (!src) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        const result = creep.withdraw(
          src,
          creep.memory.resource,
          creep.memory.amount,
        );
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, {
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
      const src =
        Game.getObjectById(creep.memory.sourceId) ||
        this.findSource(creep.room, creep.memory.resource);
      if (!src) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        const result = creep.withdraw(
          src,
          creep.memory.resource,
          creep.memory.amount,
        );
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, {
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
