/**
 * ===================================================
 * ROLE.LABWORKER.JS — Крип для обслуживания лабораторий
 * ===================================================
 * ОПТИМИЗАЦИЯ v3: один крип на комнату вместо одного на тройку.
 * Экономия ~10 крипов и ~2.5 CPU.
 *
 * ОПТИМИЗАЦИЯ v4 (ТЗ №5): Round-Robin Scheduling
 * Добавлен вращающийся указатель старта обхода троек.
 * Хранится в room.memory.labWorkerIndex.
 * Каждый тик worker начинает с другой тройки → все тройки
 * обслуживаются равномерно, ни одна не голодает.
 *
 * Задачи:
 * 1. Выгружает чужие ресурсы из лаб (если поменяли конфиг)
 * 2. Загружает реагенты из Terminal или Storage в Лаб1 и Лаб2
 * 3. Выгружает готовый продукт из реактора в Terminal или Storage
 *
 * Крип перебирает ВСЕ тройки в комнате и берёт первую найденную задачу.
 * assignedLab больше не используется.
 *
 * Память крипа:
 * - task     {string} — текущая задача
 * - resource {string} — текущий ресурс
 * - targetId {string} — ID структуры назначения
 * - sourceId {string} — ID хранилища откуда брать
 * - labKey   {string} — какая тройка обслуживается
 *
 * Память комнаты (новое в v4):
 * - labWorkerIndex {number} — указатель текущей стартовой тройки (0, 1, 2...)
 * ===================================================
 */

const LAB_CAPACITY = 3000;
const MIN_UNLOAD = 50;

module.exports = {
  findSource: function (room, resource) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (terminal && terminal.store[resource] > 0) return terminal;
    if (storage && storage.store[resource] > 0) return storage;
    return null;
  },

  findDest: function (room) {
    const terminal = room.terminal;
    const storage = room.storage;
    if (terminal && terminal.store.getFreeCapacity() > 0) return terminal;
    if (storage && storage.store.getFreeCapacity() > 0) return storage;
    return null;
  },

  /**
   * Возвращает все конфиги троек в комнате в ПОРЯДКЕ ПО УМОЛЧАНИЮ.
   * Новый метод getRotatedConfigs применяет round-robin смещение.
   */
  getConfigs: function (room) {
    const mem = room.memory;
    const configs = [];
    if (mem.labs) configs.push({ key: "labs", config: mem.labs });
    if (mem.labs2) configs.push({ key: "labs2", config: mem.labs2 });
    if (mem.labs3) configs.push({ key: "labs3", config: mem.labs3 });
    if (mem.labs4) configs.push({ key: "labs4", config: mem.labs4 });
    if (mem.labs5) configs.push({ key: "labs5", config: mem.labs5 });
    return configs;
  },

  /**
   * [НОВОЕ v4] Возвращает конфиги в ротируемом порядке.
   *
   * Пример для 3 троек:
   *   index=0 → [labs, labs2, labs3]
   *   index=1 → [labs2, labs3, labs]
   *   index=2 → [labs3, labs, labs2]
   *
   * Также сдвигает указатель room.memory.labWorkerIndex вперёд.
   *
   * @param {Room} room
   * @returns {Array} — конфиги в ротируемом порядке
   */
  getRotatedConfigs: function (room) {
    const configs = this.getConfigs(room);
    if (configs.length === 0) return [];

    // Читаем текущий индекс старта. Если не было — начинаем с 0.
    let idx = room.memory.labWorkerIndex || 0;

    // Защита от выхода за пределы массива (если убрали тройку)
    if (idx >= configs.length) idx = 0;

    // Сдвигаем указатель для СЛЕДУЮЩЕГО тика
    room.memory.labWorkerIndex = (idx + 1) % configs.length;

    // Строим ротируемый порядок:
    // берём от idx до конца, потом от начала до idx
    return configs.slice(idx).concat(configs.slice(0, idx));
  },

  run: function (creep) {
    if (!creep || !creep.room) return;

    // Сбрасываем задачу когда крип пустой
    if (creep.store.getUsedCapacity() === 0) {
      creep.memory.task = null;
      delete creep.memory.resource;
      delete creep.memory.targetId;
      delete creep.memory.sourceId;
      delete creep.memory.labKey;
    }

    // Ищем задачу если нет текущей
    if (!creep.memory.task) {
      // [ИЗМЕНЕНО v4] Используем ротируемый порядок вместо прямого
      const configs = this.getRotatedConfigs(creep.room);

      if (configs.length === 0) {
        creep.say("❌ нет конфига");
        return;
      }

      for (const { key, config } of configs) {
        const lab1 = Game.getObjectById(config.lab1);
        const lab2 = Game.getObjectById(config.lab2);
        const reactor = Game.getObjectById(config.reactor);

        if (!lab1 || !lab2 || !reactor) continue;

        // Приоритет 1: чужой ресурс в lab1
        for (const res in lab1.store) {
          if (res !== config.reagent1 && lab1.store[res] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = res;
            creep.memory.targetId = config.lab1;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 2: чужой ресурс в lab2
        for (const res in lab2.store) {
          if (res !== config.reagent2 && lab2.store[res] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = res;
            creep.memory.targetId = config.lab2;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 3: чужой ресурс в реакторе
        for (const res in reactor.store) {
          if (res !== config.product && reactor.store[res] > 0) {
            creep.memory.task = "clear_lab";
            creep.memory.resource = res;
            creep.memory.targetId = config.reactor;
            creep.memory.labKey = key;
            break;
          }
        }
        if (creep.memory.task) break;

        // Приоритет 4: выгрузить продукт из реактора
        if ((reactor.store[config.product] || 0) >= MIN_UNLOAD) {
          creep.memory.task = "unload_reactor";
          creep.memory.resource = config.product;
          creep.memory.targetId = config.reactor;
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
            creep.memory.sourceId = src.id;
            creep.memory.targetId = config.lab1;
            creep.memory.labKey = key;
            creep.memory.amount = Math.min(
              needed,
              src.store[config.reagent1],
              creep.store.getFreeCapacity(),
            );
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
            creep.memory.sourceId = src.id;
            creep.memory.targetId = config.lab2;
            creep.memory.labKey = key;
            creep.memory.amount = Math.min(
              needed,
              src.store[config.reagent2],
              creep.store.getFreeCapacity(),
            );
            break;
          }
        }
      }

      if (!creep.memory.task) return;
    }

    // ── ВЫПОЛНЕНИЕ ЗАДАЧИ ─────────────────────────────────────────────────
    // (логика не изменена)

    // Очистка лабы от чужого ресурса
    if (creep.memory.task === "clear_lab") {
      const target = Game.getObjectById(creep.memory.targetId);
      const dest = this.findDest(creep.room);
      if (!target || !dest) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        const r = creep.withdraw(target, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE)
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff0000" },
          });
      } else {
        const r = creep.transfer(dest, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE)
          creep.moveTo(dest, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff0000" },
          });
        if (r === OK) creep.memory.task = null;
      }
      return;
    }

    // Выгрузка продукта из реактора
    if (creep.memory.task === "unload_reactor") {
      const reactor = Game.getObjectById(creep.memory.targetId);
      const dest = this.findDest(creep.room);
      if (!dest) {
        creep.say("❌ некуда");
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        if (!reactor || (reactor.store[creep.memory.resource] || 0) === 0) {
          creep.memory.task = null;
          return;
        }
        const r = creep.withdraw(reactor, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE)
          creep.moveTo(reactor, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
      } else {
        const r = creep.transfer(dest, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE)
          creep.moveTo(dest, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        if (r === OK) creep.memory.task = null;
      }
      return;
    }

    // Загрузка реагента в lab1 или lab2
    if (
      creep.memory.task === "load_lab1" ||
      creep.memory.task === "load_lab2"
    ) {
      const src =
        Game.getObjectById(creep.memory.sourceId) ||
        this.findSource(creep.room, creep.memory.resource);
      const dest = Game.getObjectById(creep.memory.targetId);
      if (!src || !dest) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        const r = creep.withdraw(
          src,
          creep.memory.resource,
          creep.memory.amount,
        );
        if (r === ERR_NOT_IN_RANGE)
          creep.moveTo(src, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        if (r === OK) delete creep.memory.amount;
      } else {
        const r = creep.transfer(dest, creep.memory.resource);
        if (r === ERR_NOT_IN_RANGE)
          creep.moveTo(dest, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        if (r === OK) creep.memory.task = null;
      }
      return;
    }
  },
};
