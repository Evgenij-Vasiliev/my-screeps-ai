/**
 * ===================================================
 * DIAGNOSTICS.LABS.JS — Диагностика цепочки лабораторий
 * ===================================================
 * VERSION: 1.0
 *
 * Официальный диагностический модуль лабораторий.
 * Подключается ТОЛЬКО через diagnostics.js.
 *
 * Архитектура:
 *   main.js → diagnostics.js → diagnostics.labs.js
 *
 * Публичное API:
 *   diagnosticsLabs.run()              — автопроверка всех комнат (каждые N тиков)
 *   diagnosticsLabs.printRoom(room)    — полный отчёт по комнате в консоль
 *   diagnosticsLabs.getRoomStatus(room)— возвращает { status, reasons } для roomHealth()
 *
 * Типы событий для history():
 *   lab_chain_blocked       — цепочка заблокирована
 *   lab_missing_reagent     — нет реагента в storage/terminal
 *   lab_missing_intermediate— нет промежуточного продукта
 *   lab_chain_recovered     — цепочка восстановилась
 *
 * События пишутся только при ИЗМЕНЕНИИ состояния (не каждый тик).
 * ===================================================
 */

const Logger = require("./logger");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const LAB_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];
const RUN_INTERVAL = 50; // проверка каждые 50 тиков

// Ключ в Memory для хранения предыдущих статусов (для детекции изменений)
// Memory.empire.labDiagState[roomName][key] = 'ok' | 'blocked' | 'missing_reagent' | ...
const STATE_KEY = "labDiagState";

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const diagnosticsLabs = {
  // ── АВТОПРОВЕРКА (вызывается из diagnostics.js каждые 50 тиков) ──────────

  run: function () {
    if (Game.time % RUN_INTERVAL !== 0) return;

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const hasConfig = LAB_KEYS.some(
        k => room.memory[k] && room.memory[k].product,
      );
      if (!hasConfig) continue;

      this._checkRoom(room);
    }
  },

  // ── ПОЛНЫЙ ВЫВОД В КОНСОЛЬ (вызывается из console.js через labsDiag) ─────

  printRoom: function (roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
      console.log(`[LABS DIAG] Комната ${roomName} не видна`);
      return;
    }

    const configs = this._getConfigs(room);
    if (configs.length === 0) {
      console.log(`[LABS DIAG] ${roomName}: нет конфигов троек`);
      return;
    }

    // Находим всех labWorker'ов комнаты
    const workers = _.filter(
      Game.creeps,
      c =>
        c.room.name === roomName &&
        c.memory.role &&
        c.memory.role.toLowerCase().includes("labworker"),
    );

    console.log("=".repeat(60));
    console.log(`[LABS DIAG] Комната: ${roomName}  Тик: ${Game.time}`);
    console.log("=".repeat(60));

    // ── БЛОК 0: PLANNER ────────────────────────────────────────────────────
    console.log("\n── БЛОК 0: PLANNER ──────────────────────────────────────");
    const planner = Memory.labPlanner;
    if (!planner) {
      console.log("  ❌ Memory.labPlanner отсутствует");
    } else {
      console.log(`  needs:       ${JSON.stringify(planner.needs)}`);
      console.log(`  bottlenecks: ${JSON.stringify(planner.bottlenecks)}`);
      const age = Game.time - (planner.updatedAt || 0);
      console.log(
        `  updatedAt:   ${planner.updatedAt}  (возраст: ${age} тиков)`,
      );
      if (age > 10) console.log(`  ⚠️  Planner не обновлялся ${age} тиков`);
    }

    // ── ПЕРЕБИРАЕМ ТРОЙКИ ─────────────────────────────────────────────────
    for (const { key, config } of configs) {
      console.log("\n" + "═".repeat(60));
      console.log(
        `[${key}]  ${config.reagent1} + ${config.reagent2} → ${config.product}`,
      );
      console.log("═".repeat(60));

      const lab1 = Game.getObjectById(config.lab1);
      const lab2 = Game.getObjectById(config.lab2);
      const reactor = Game.getObjectById(config.reactor);

      // БЛОК 1: КОНФИГ
      console.log(
        "\n── БЛОК 1: КОНФИГ ───────────────────────────────────────",
      );
      console.log(
        `  lab1    id=...${(config.lab1 || "").slice(-6)}  exists=${!!lab1}`,
      );
      console.log(
        `  lab2    id=...${(config.lab2 || "").slice(-6)}  exists=${!!lab2}`,
      );
      console.log(
        `  reactor id=...${(config.reactor || "").slice(
          -6,
        )}  exists=${!!reactor}`,
      );

      if (!lab1 || !lab2 || !reactor) {
        console.log("  ❌ Одна из структур не найдена — тройка нерабочая");
        continue;
      }

      // БЛОК 2: СОСТОЯНИЕ ЛАБ
      console.log(
        "\n── БЛОК 2: СОСТОЯНИЕ ЛАБ ────────────────────────────────",
      );
      console.log(
        `  lab1    resource=${config.reagent1}  amount=${
          lab1.store[config.reagent1] || 0
        }`,
      );
      console.log(
        `  lab2    resource=${config.reagent2}  amount=${
          lab2.store[config.reagent2] || 0
        }`,
      );
      console.log(
        `  reactor resource=${config.product}   amount=${
          reactor.store[config.product] || 0
        }`,
      );
      console.log(`  reactor cooldown=${reactor.cooldown || 0}`);

      // Чужие ресурсы
      for (const res in lab1.store) {
        if (res !== config.reagent1)
          console.log(`  ⚠️  lab1 ЧУЖОЙ: ${res}=${lab1.store[res]}`);
      }
      for (const res in lab2.store) {
        if (res !== config.reagent2)
          console.log(`  ⚠️  lab2 ЧУЖОЙ: ${res}=${lab2.store[res]}`);
      }
      for (const res in reactor.store) {
        if (res !== config.product)
          console.log(`  ⚠️  reactor ЧУЖОЙ: ${res}=${reactor.store[res]}`);
      }

      // БЛОК 3: НАЛИЧИЕ РЕАГЕНТОВ
      console.log(
        "\n── БЛОК 3: НАЛИЧИЕ РЕАГЕНТОВ ────────────────────────────",
      );
      for (const reagent of [config.reagent1, config.reagent2]) {
        const inStorage = (room.storage && room.storage.store[reagent]) || 0;
        const inTerminal = (room.terminal && room.terminal.store[reagent]) || 0;
        const total = inStorage + inTerminal;
        const flag = total === 0 ? "❌" : total < 500 ? "⚠️ " : "✅";
        console.log(
          `  ${flag} ${reagent}  storage=${inStorage}  terminal=${inTerminal}  total=${total}`,
        );
      }

      // БЛОК 4: LABWORKER
      console.log(
        "\n── БЛОК 4: LABWORKER ────────────────────────────────────",
      );
      if (workers.length === 0) {
        console.log("  ❌ Нет ни одного labWorker в комнате");
      } else {
        for (const w of workers) {
          const m = w.memory;
          console.log(`  name=${w.name}  role=${m.role}`);
          console.log(
            `    task=${m.task || "null"}  resource=${
              m.resource || "—"
            }  labKey=${m.labKey || "—"}`,
          );
          console.log(
            `    store=${JSON.stringify(w.store)}  pos=(${w.pos.x},${w.pos.y})`,
          );
          console.log(
            `    targetId=...${(m.targetId || "").slice(-6)}  sourceId=...${(
              m.sourceId || ""
            ).slice(-6)}`,
          );
        }
      }

      // БЛОК 5: АКТИВНАЯ ЗАДАЧА
      console.log(
        "\n── БЛОК 5: АКТИВНАЯ ЗАДАЧА ──────────────────────────────",
      );
      const workerOnKey = workers.find(w => w.memory.labKey === key);
      if (!workerOnKey) {
        console.log(`  NO TASK (нет worker'а на тройке ${key})`);
      } else {
        const m = workerOnKey.memory;
        if (!m.task) {
          console.log("  NO TASK (worker пустой, ищет задачу)");
        } else {
          console.log(
            `  task=${m.task}  resource=${m.resource}  amount=${
              m.amount || "max"
            }`,
          );
          const labels = {
            load_lab1: `→ load ${m.resource} into lab1`,
            load_lab2: `→ load ${m.resource} into lab2`,
            unload_reactor: `→ unload ${m.resource} from reactor`,
            clear_lab: `→ clear ${m.resource} from lab`,
          };
          console.log(`  ${labels[m.task] || m.task}`);
        }
      }

      // БЛОК 6: АНАЛИЗ ЦЕПОЧКИ A→H
      console.log(
        "\n── БЛОК 6: АНАЛИЗ ЦЕПОЧКИ ───────────────────────────────",
      );
      this._analyzeChain(room, key, config, lab1, lab2, reactor, workers);
    }

    console.log("\n" + "=".repeat(60));
    console.log("[LABS DIAG] Готово");
    console.log("=".repeat(60));
  },

  // ── СТАТУС ДЛЯ ROOMHEALTH() ───────────────────────────────────────────────
  // Возвращает { status: 'OK'|'WARN'|'ERROR', reasons: string[] }

  getRoomStatus: function (roomName) {
    const room = Game.rooms[roomName];
    if (!room) return { status: "ERROR", reasons: ["комната не видна"] };

    const configs = this._getConfigs(room);
    if (configs.length === 0)
      return { status: "WARN", reasons: ["нет конфигов лаб"] };

    const reasons = [];
    let worst = "OK"; // OK < WARN < ERROR

    const bump = level => {
      if (level === "ERROR") worst = "ERROR";
      else if (level === "WARN" && worst !== "ERROR") worst = "WARN";
    };

    for (const { key, config } of configs) {
      const lab1 = Game.getObjectById(config.lab1);
      const lab2 = Game.getObjectById(config.lab2);
      const reactor = Game.getObjectById(config.reactor);

      // ERROR: битый конфиг или несуществующая структура
      if (!lab1 || !lab2 || !reactor) {
        bump("ERROR");
        reasons.push(`[${key}] структура не найдена`);
        continue;
      }

      // WARN: нет реагента в комнате
      const r1 =
        ((room.storage && room.storage.store[config.reagent1]) || 0) +
        ((room.terminal && room.terminal.store[config.reagent1]) || 0);
      const r2 =
        ((room.storage && room.storage.store[config.reagent2]) || 0) +
        ((room.terminal && room.terminal.store[config.reagent2]) || 0);

      if (r1 === 0) {
        bump("WARN");
        reasons.push(`[${key}] нет ${config.reagent1}`);
      }
      if (r2 === 0) {
        bump("WARN");
        reasons.push(`[${key}] нет ${config.reagent2}`);
      }

      // WARN: реагент не загружен в лабу
      if ((lab1.store[config.reagent1] || 0) === 0) {
        bump("WARN");
        reasons.push(`[${key}] lab1 пустая (${config.reagent1})`);
      }
      if ((lab2.store[config.reagent2] || 0) === 0) {
        bump("WARN");
        reasons.push(`[${key}] lab2 пустая (${config.reagent2})`);
      }
    }

    return { status: worst, reasons };
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ПРИВАТНЫЕ МЕТОДЫ
  // ══════════════════════════════════════════════════════════════════════════

  // ── Автопроверка одной комнаты (для run()) ────────────────────────────────

  _checkRoom: function (room) {
    const roomName = room.name;
    const configs = this._getConfigs(room);

    // Инициализируем хранилище состояний
    if (!Memory.empire) Memory.empire = {};
    if (!Memory.empire[STATE_KEY]) Memory.empire[STATE_KEY] = {};
    if (!Memory.empire[STATE_KEY][roomName])
      Memory.empire[STATE_KEY][roomName] = {};

    const prevStates = Memory.empire[STATE_KEY][roomName];

    for (const { key, config } of configs) {
      const lab1 = Game.getObjectById(config.lab1);
      const lab2 = Game.getObjectById(config.lab2);
      const reactor = Game.getObjectById(config.reactor);

      const stateKey = `${roomName}_${key}`;
      let newState = "ok";
      let eventType = null;
      let eventMsg = null;

      if (!lab1 || !lab2 || !reactor) {
        newState = "error";
        eventType = "lab_chain_blocked";
        eventMsg = `[${key}] структура не найдена`;
      } else {
        const r1 =
          ((room.storage && room.storage.store[config.reagent1]) || 0) +
          ((room.terminal && room.terminal.store[config.reagent1]) || 0);
        const r2 =
          ((room.storage && room.storage.store[config.reagent2]) || 0) +
          ((room.terminal && room.terminal.store[config.reagent2]) || 0);

        if (r1 === 0 || r2 === 0) {
          newState = "missing_reagent";
          eventType = "lab_missing_reagent";
          eventMsg = `[${key}] нет реагента: ${
            r1 === 0 ? config.reagent1 : config.reagent2
          }`;
        } else if (
          (lab1.store[config.reagent1] || 0) === 0 ||
          (lab2.store[config.reagent2] || 0) === 0
        ) {
          newState = "blocked";
          eventType = "lab_chain_blocked";
          eventMsg = `[${key}] реагент не загружен в лабу`;
        }
      }

      const prevState = prevStates[key] || "ok";

      // Пишем событие только при ИЗМЕНЕНИИ состояния
      if (newState !== prevState) {
        if (newState === "ok" && prevState !== "ok") {
          Logger.event(
            "lab_chain_recovered",
            roomName,
            `[${key}] ${config.product} — цепочка восстановлена`,
            { slot: key },
          );
        } else if (eventType) {
          Logger.event(eventType, roomName, eventMsg, {
            slot: key,
            product: config.product,
          });
        }
        prevStates[key] = newState;
      }
    }
  },

  // ── Анализ цепочки A→H ────────────────────────────────────────────────────

  _analyzeChain: function (room, key, config, lab1, lab2, reactor, workers) {
    const planner = Memory.labPlanner;

    // A: planner не видит need
    const needExists =
      planner && planner.needs && planner.needs.includes(config.product);
    if (!needExists) {
      console.log(`  ВАРИАНТ A: Planner не включает ${config.product} в needs`);
      console.log(`  → Либо stock достаточен, либо planner не работает`);
      return;
    }
    console.log(`  ✅ A: need для ${config.product} есть`);

    // B: autoconfig не назначил реагенты
    if (!config.reagent1 || !config.reagent2) {
      console.log(`  ВАРИАНТ B: AutoConfig не назначил реагенты`);
      return;
    }
    console.log(`  ✅ B: реагенты назначены`);

    // C: нет worker'а вообще
    if (workers.length === 0) {
      console.log(`  ВАРИАНТ C: Нет labWorker в комнате — задача не создаётся`);
      return;
    }
    console.log(`  ✅ C: worker существует (${workers.length} шт.)`);

    // D: worker не выбирает эту тройку
    const workerOnKey = workers.find(w => w.memory.labKey === key);
    const workerBusy = workers.find(w => w.memory.task);
    if (!workerOnKey) {
      if (workerBusy) {
        console.log(
          `  ВАРИАНТ D: Worker занят тройкой ${workerBusy.memory.labKey}, не обслуживает ${key}`,
        );
        console.log(`  → Round-robin должен исправить при следующем цикле`);
      } else {
        console.log(
          `  ВАРИАНТ D: Worker без задачи, но тройка ${key} не выбрана`,
        );
        console.log(`  → Проверить логику поиска задачи в role.labWorker`);
      }
      return;
    }
    console.log(`  ✅ D: worker выбрал тройку ${key}`);

    // E: не может найти ресурс
    const r1total =
      ((room.storage && room.storage.store[config.reagent1]) || 0) +
      ((room.terminal && room.terminal.store[config.reagent1]) || 0);
    const r2total =
      ((room.storage && room.storage.store[config.reagent2]) || 0) +
      ((room.terminal && room.terminal.store[config.reagent2]) || 0);
    if (r1total === 0) {
      console.log(
        `  ВАРИАНТ E: ${config.reagent1} отсутствует в storage и terminal`,
      );
      return;
    }
    if (r2total === 0) {
      console.log(
        `  ВАРИАНТ E: ${config.reagent2} отсутствует в storage и terminal`,
      );
      return;
    }
    console.log(
      `  ✅ E: ресурсы найдены (${config.reagent1}=${r1total}, ${config.reagent2}=${r2total})`,
    );

    // F: не делает withdraw
    const w = workerOnKey;
    const wStore = w.store.getUsedCapacity();
    if (w.memory.task && w.memory.task.startsWith("load") && wStore === 0) {
      console.log(
        `  ВАРИАНТ F: task=${w.memory.task}, но store пустой — withdraw не выполнен`,
      );
      const src = Game.getObjectById(w.memory.sourceId);
      console.log(`    sourceId exists=${!!src}`);
      if (src) {
        const amt = src.store[w.memory.resource] || 0;
        console.log(`    source.store[${w.memory.resource}]=${amt}`);
        if (amt === 0)
          console.log(
            `    ❌ Источник пустой — findSource вернул неверную структуру`,
          );
      } else {
        console.log(`    ❌ sourceId невалидный или структура уничтожена`);
      }
      return;
    }

    // G: не делает transfer
    if (wStore > 0 && (lab1.store[config.reagent1] || 0) === 0) {
      console.log(
        `  ВАРИАНТ G: Worker несёт ресурс, но lab1 пустая — transfer не выполнен`,
      );
      const dest = Game.getObjectById(w.memory.targetId);
      console.log(`    targetId exists=${!!dest}`);
      return;
    }

    // H: реакция не запускается
    if (
      (lab1.store[config.reagent1] || 0) > 0 &&
      (lab2.store[config.reagent2] || 0) > 0 &&
      (reactor.store[config.product] || 0) === 0
    ) {
      console.log(
        `  ВАРИАНТ H: Оба реагента загружены, реактор пустой — реакция не запускается`,
      );
      console.log(`  → Проверить runReaction / lab controller`);
      return;
    }

    // Всё ок
    if (
      (lab1.store[config.reagent1] || 0) > 0 &&
      (lab2.store[config.reagent2] || 0) > 0 &&
      (reactor.store[config.product] || 0) > 0
    ) {
      console.log(`  ✅ Реакция идёт нормально`);
    } else {
      console.log(`  ❓ Состояние неопределённо — требуется живое наблюдение`);
    }
  },

  // ── Конфиги троек ────────────────────────────────────────────────────────

  _getConfigs: function (room) {
    const mem = room.memory;
    const configs = [];
    for (const key of LAB_KEYS) {
      if (mem[key] && mem[key].product) configs.push({ key, config: mem[key] });
    }
    return configs;
  },
};

module.exports = diagnosticsLabs;
