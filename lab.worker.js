/**
 * ===================================================
 * LAB.WORKER.JS — Крип для обслуживания лабораторий
 * ===================================================
 * ОПТИМИЗАЦИЯ v3: один крип на комнату вместо одного на тройку.
 *
 * ОПТИМИЗАЦИЯ v4 (ТЗ №5): Round-Robin Scheduling — указатель старта обхода
 * троек, чтобы ни одна тройка не голодала.
 *
 * ОПТИМИЗАЦИЯ v5 (CPU, отчёт docs/LAB-WORKER-CPU-OPTIMIZATION.md):
 * замеры на живом шарде (0.94 мс/тик, 13.8 % roomManager) показали, что ~85 %
 * бакета — это рейсы «хранилище → лаба»: крип возил по 5 единиц реагента
 * (ровно свежая порция реакции) и делал на каждые 5 единиц полный рейс.
 * Что изменено:
 *   1. Гистерезис дозаправки: задача «долить реагент» создаётся, только когда
 *      дефицит лабы не меньше рюкзака крипа — за рейс привозится полный
 *      рюкзак и крип возвращается пустым (рейсов в десятки раз меньше).
 *      Лаба держится в коридоре [CAPACITY − рюкзак, CAPACITY] — для реакции
 *      (5 единиц/тик) это буфер на сотни тиков.
 *   2. Порог выгрузки продукта — LAB_WORKER.PRODUCT_UNLOAD_AT (было 50):
 *      рейсов в 5 раз меньше.
 *   3. Действие вызывается только когда крип уже рядом (`isNearTo`) — раньше
 *      каждый тик поездки уходил «пустой» withdraw/transfer с
 *      ERR_NOT_IN_RANGE (0.03–0.07 мс впустую).
 *   4. Перебор конфигов крипом без задачи — не чаще IDLE_SCAN_INTERVAL тиков.
 *   5. Указатель round-robin переехал из `room.memory.labWorkerIndex` в heap:
 *      раньше каждый перебор конфигов писал в Memory, «пачкая» её каждый тик.
 *
 * Задачи (не изменились):
 * 1. Выгружает чужие ресурсы из лаб (если поменяли конфиг)
 * 2. Загружает реагенты из Terminal или Storage в Лаб1 и Лаб2
 * 3. Выгружает готовый продукт из реактора в Terminal или Storage
 *
 * Крип перебирает ВСЕ тройки в комнате и берёт первую найденную задачу.
 * Память крипа: task / resource / targetId / sourceId / labKey / amount.
 * Heap (global._labWorker): idx / scanAt / noCfgAt — по именам комнат.
 * ===================================================
 */

const { LAB_WORKER } = require("./constants");

const LAB_CAPACITY = LAB_WORKER.CAPACITY;
const MIN_UNLOAD = LAB_WORKER.PRODUCT_UNLOAD_AT;

/**
 * Heap-состояние роли: живёт между тиками внутри одного global и сбрасывается
 * при Global Reset. Это безопасно: указатель round-robin начинается с 0,
 * а троттлинг перебора просто исчезает на один тик.
 */
function heap() {
  if (!global._labWorker) {
    global._labWorker = { idx: {}, scanAt: {}, noCfgAt: {} };
  }
  return global._labWorker;
}

/**
 * Выполняет действие, только когда крип уже рядом с целью; иначе — идёт к ней.
 * Раньше действие вызывалось из любой точки и возвращало ERR_NOT_IN_RANGE
 * на каждом тике поездки (замер: 0.03–0.07 мс за «пустой» вызов).
 * @param {Creep} creep
 * @param {Object} target
 * @param {function(): number} fn
 * @returns {number}
 */
function actIfNear(creep, target, fn) {
  if (!creep.pos.isNearTo(target)) {
    creep.travelTo(target);
    return ERR_NOT_IN_RANGE;
  }
  return fn();
}

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
   * Все конфиги троек в комнате в порядке по умолчанию.
   * getRotatedConfigs применяет round-robin смещение.
   * Используется также terminalNetwork.js — сигнатура не меняется.
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
   * Возвращает конфиги в ротируемом порядке и сдвигает указатель.
   *
   * Пример для 3 троек:
   *   index=0 → [labs, labs2, labs3]
   *   index=1 → [labs2, labs3, labs]
   *   index=2 → [labs3, labs, labs2]
   *
   * Указатель хранится в heap (global._labWorker.idx), а не в room.memory:
   * запись в Memory при каждом переборе конфигов держала Memory «грязной».
   *
   * @param {Room} room
   * @returns {Array} — конфиги в ротируемом порядке
   */
  getRotatedConfigs: function (room) {
    const configs = this.getConfigs(room);
    if (configs.length === 0) return configs;

    const h = heap();
    let idx = h.idx[room.name] || 0;
    // Защита от выхода за пределы массива (если убрали тройку)
    if (idx >= configs.length) idx = 0;
    // Сдвигаем указатель для СЛЕДУЮЩЕГО перебора
    h.idx[room.name] = (idx + 1) % configs.length;

    // Одно выделение вместо slice+concat: собираем порядок в один проход.
    const rotated = [];
    for (let i = 0; i < configs.length; i++) {
      rotated.push(configs[(idx + i) % configs.length]);
    }
    return rotated;
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
      const h = heap();
      const roomName = creep.room.name;

      // Троттлинг: крип без задачи перебирает конфиги не каждый тик.
      const nextScan = h.scanAt[roomName];
      if (nextScan && Game.time < nextScan) return;

      const configs = this.getRotatedConfigs(creep.room);

      if (configs.length === 0) {
        // Спам убран (дефект №17 аудита): сообщение не чаще раза в 50 тиков.
        const said = h.noCfgAt[roomName];
        if (!said || Game.time - said >= 50) {
          creep.say("❌ нет конфига");
          h.noCfgAt[roomName] = Game.time;
        }
        h.scanAt[roomName] = Game.time + LAB_WORKER.IDLE_SCAN_INTERVAL;
        return;
      }

      // Дефицит, при котором есть смысл начинать рейс: не меньше свободного
      // места в рюкзаке крипа (см. п.1 в шапке файла).
      const freeCapacity = creep.store.getFreeCapacity();

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

        // Приоритет 5: загрузить реагент1 в lab1.
        // Гистерезис (см. п.1 в шапке): новый рейс начинаем, только если
        // дефицит не меньше рюкзака. Если крип уже везёт этот реагент — задачу
        // даём всегда, чтобы он сдал привезённое.
        const cur1 = lab1.store[config.reagent1] || 0;
        if (cur1 < LAB_CAPACITY) {
          const needed1 = LAB_CAPACITY - cur1;
          const carries1 = (creep.store[config.reagent1] || 0) > 0;
          if (carries1 || needed1 >= freeCapacity) {
            const src = this.findSource(creep.room, config.reagent1);
            if (src) {
              creep.memory.task = "load_lab1";
              creep.memory.resource = config.reagent1;
              creep.memory.sourceId = src.id;
              creep.memory.targetId = config.lab1;
              creep.memory.labKey = key;
              creep.memory.amount = Math.min(
                needed1,
                src.store[config.reagent1],
                creep.store.getFreeCapacity(),
              );
              break;
            }
          }
        }

        // Приоритет 6: загрузить реагент2 в lab2 (та же логика гистерезиса)
        const cur2 = lab2.store[config.reagent2] || 0;
        if (cur2 < LAB_CAPACITY) {
          const needed2 = LAB_CAPACITY - cur2;
          const carries2 = (creep.store[config.reagent2] || 0) > 0;
          if (carries2 || needed2 >= freeCapacity) {
            const src = this.findSource(creep.room, config.reagent2);
            if (src) {
              creep.memory.task = "load_lab2";
              creep.memory.resource = config.reagent2;
              creep.memory.sourceId = src.id;
              creep.memory.targetId = config.lab2;
              creep.memory.labKey = key;
              creep.memory.amount = Math.min(
                needed2,
                src.store[config.reagent2],
                creep.store.getFreeCapacity(),
              );
              break;
            }
          }
        }
      }

      // Перебор не дал задачи — не повторяем его каждый тик.
      if (!creep.memory.task) {
        h.scanAt[roomName] = Game.time + LAB_WORKER.IDLE_SCAN_INTERVAL;
        return;
      }
    }

    // ── ВЫПОЛНЕНИЕ ЗАДАЧИ ─────────────────────────────────────────────────

    // Очистка лабы от чужого ресурса
    if (creep.memory.task === "clear_lab") {
      const target = Game.getObjectById(creep.memory.targetId);
      const dest = this.findDest(creep.room);
      if (!target || !dest) {
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        actIfNear(creep, target, () =>
          creep.withdraw(target, creep.memory.resource),
        );
      } else {
        const r = actIfNear(creep, dest, () =>
          creep.transfer(dest, creep.memory.resource),
        );
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
        creep.memory.task = null;
        return;
      }

      if (creep.store[creep.memory.resource] === 0) {
        if (!reactor || (reactor.store[creep.memory.resource] || 0) === 0) {
          creep.memory.task = null;
          return;
        }
        actIfNear(creep, reactor, () =>
          creep.withdraw(reactor, creep.memory.resource),
        );
      } else {
        const r = actIfNear(creep, dest, () =>
          creep.transfer(dest, creep.memory.resource),
        );
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
        const r = actIfNear(creep, src, () =>
          creep.withdraw(src, creep.memory.resource, creep.memory.amount),
        );
        if (r === OK) delete creep.memory.amount;
      } else {
        const r = actIfNear(creep, dest, () =>
          creep.transfer(dest, creep.memory.resource),
        );
        if (r === OK) creep.memory.task = null;
      }
      return;
    }
  },
};
