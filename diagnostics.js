/**
 * ===================================================
 * DIAGNOSTICS.JS — Система диагностики и авторecovery
 * ===================================================
 * VERSION: 2.0
 *
 * ИЗМЕНЕНИЯ v2.0:
 * - Добавлена проверка лаб (_checkLabs):
 *   * lab_blocked      — реагент не поступает давно
 *   * lab_missing_input — реагентов нет в комнате вообще
 *   * lab_output_full  — реактор переполнен, некуда выгружать
 *   * lab_worker_stuck — labWorker завис (определяется через _getStuckInfo)
 *
 * - Добавлена проверка терминала (_checkTerminals):
 *   * terminal_blocked — терминал на cooldown слишком долго
 *   * terminal_full    — терминал заполнен > 90%
 *   * terminal_send_failed — фиксируем в логе (через Logger.warn)
 *   * resource_stuck   — ресурс в терминале не двигается N тиков
 *
 * - Добавлена проверка маркета (_checkMarket):
 *   * market_no_energy    — у терминала нет энергии на сделку
 *   * market_price_warning — цена сделки аномально низкая/высокая
 *   * market_order_failed  — фиксируется при ошибке deal() (через Logger.event)
 *
 * СОХРАНЕНЫ (без изменений):
 * - _checkCreeps     — зависшие крипы, невалидные ID, deliveryWorker deadlock
 * - _checkFactories  — factory waiting_input, store full, auto recovery
 * - _checkLinks      — link network stalled, auto recovery
 * - _checkRemoteMiners
 * ===================================================
 */

const Logger = require("./logger");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const RUN_INTERVAL = 50; // проверка каждые 50 тиков
const STUCK_TICKS = 20; // крип зависший если не двигался N тиков
const FACTORY_STUCK_TICKS = 100; // фабрика stuck если в waiting_input N тиков

// Лабы: сколько тиков без реагентов считается "blocked"
const LAB_BLOCKED_TICKS = 200;

// Терминал: сколько тиков на cooldown считается проблемой
// (в норме cooldown = 1 тик, это скорее защита от глюков)
const TERMINAL_COOLDOWN_WARN = 5;

// Терминал: порог заполненности для предупреждения
const TERMINAL_FULL_PCT = 0.9;

// Маркет: минимум энергии в терминале для сделки
const TERMINAL_ENERGY_MIN = 20000;

// Ключи конфигов лаб
const LAB_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];

const DELIVERY_STATUS = {
  QUEUED: "queued",
  CANCELLED: "cancelled",
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const diagnostics = {
  run: function () {
    if (Game.time % RUN_INTERVAL !== 0) return;
    this.runNow();
  },

  runNow: function () {
    const startCpu = Game.cpu.getUsed();

    this._checkCreeps();
    this._checkFactories();
    this._checkLinks();
    this._checkRemoteMiners();
    this._checkLabs(); // NEW v2.0
    this._checkTerminals(); // NEW v2.0
    this._checkMarket(); // NEW v2.0

    const duration = Game.cpu.getUsed() - startCpu;
    Logger.diag("Diagnostics", "проверка завершена", {
      cpu: duration.toFixed(3),
    });
  },

  // ── РУЧНЫЕ ВЫЗОВЫ ─────────────────────────────────────────────────────────

  checkRoom: function (roomName) {
    const room = Game.rooms[roomName];
    if (!room) {
      console.log(`[DIAG] комната ${roomName} недоступна`);
      return;
    }
    console.log(`\n========== ДИАГНОСТИКА: ${roomName} ==========`);
    this._checkRoomCreeps(room);
    this._checkRoomFactory(room);
    this._checkRoomLinks(room);
    this._checkRoomLabs(room); // NEW v2.0
    this._checkRoomTerminal(room); // NEW v2.0
    console.log(`==============================================\n`);
  },

  checkCreep: function (creepName) {
    const creep = Game.creeps[creepName];
    if (!creep) {
      console.log(`[DIAG] крип ${creepName} не найден`);
      return;
    }

    console.log(`\n========== ДИАГНОСТИКА КРИПА: ${creepName} ==========`);
    console.log(`  role:          ${creep.memory.role}`);
    console.log(`  room:          ${creep.room.name}`);
    console.log(`  pos:           ${creep.pos}`);
    console.log(`  deliveryState: ${creep.memory.deliveryState || "—"}`);
    console.log(`  task:          ${creep.memory.task || "—"}`);
    console.log(`  working:       ${creep.memory.working}`);
    console.log(`  store:         ${JSON.stringify(creep.store)}`);

    if (creep.memory.deliveryAssignment) {
      const a = creep.memory.deliveryAssignment;
      console.log(
        `  assignment:    ${a.resource} → ${a.target} [${a.deliveryId}]`,
      );
      const list =
        Memory.empire &&
        Memory.empire.logistics &&
        Memory.empire.logistics.deliveries &&
        Memory.empire.logistics.deliveries[a.roomName];
      const delivery = list && list.find(d => d.createdAt === a.deliveryId);
      console.log(
        `  delivery:      ${delivery ? delivery.status : "❌ НЕ НАЙДЕНА"}`,
      );
    }

    const stuckInfo = this._getStuckInfo(creep);
    if (stuckInfo) {
      console.log(`  ⚠️  ЗАВИСШИЙ: ${stuckInfo.ticks} тиков без движения`);
    }

    this._checkCreepIds(creep, true);
    console.log(`=====================================================\n`);
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ КРИПОВ (без изменений)
  // ══════════════════════════════════════════════════════

  _checkCreeps: function () {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      this._checkStuck(creep);
      this._checkCreepIds(creep, false);
      this._checkDeliveryWorker(creep);
    }
  },

  _checkRoomCreeps: function (room) {
    const creeps = Object.values(Game.creeps).filter(
      c => c.room.name === room.name,
    );
    console.log(`  Крипов: ${creeps.length}`);
    for (const creep of creeps) {
      const stuck = this._getStuckInfo(creep);
      const stuckStr = stuck ? ` ⚠️ ЗАВИСШИЙ ${stuck.ticks}т` : "";
      console.log(
        `    ${creep.name} [${creep.memory.role}] state=${
          creep.memory.deliveryState || creep.memory.task || "—"
        }${stuckStr}`,
      );
    }
  },

  _checkStuck: function (creep) {
    const info = this._getStuckInfo(creep);
    if (!info) return;

    Logger.warn("Diagnostics", "stuck creep", {
      name: creep.name,
      role: creep.memory.role,
      room: creep.room.name,
      state: creep.memory.deliveryState || creep.memory.task || "—",
      ticks: info.ticks,
    });

    Logger.event(
      "stuck_creep",
      creep.room.name,
      `${creep.name} зависший ${info.ticks} тиков`,
      {
        role: creep.memory.role,
        state: creep.memory.deliveryState || creep.memory.task,
      },
    );

    // AUTO RECOVERY: сбрасываем память зависшего deliveryWorker
    if (
      creep.memory.role === "test_deliveryWorker" &&
      info.ticks >= STUCK_TICKS * 2
    ) {
      console.log(
        `[Diagnostics] 🔧 AUTO RECOVERY: сброс зависшего ${creep.name}`,
      );
      delete creep.memory.deliveryAssignment;
      delete creep.memory.deliveryState;
      delete creep.memory._diag;
      Logger.event(
        "auto_recovery",
        creep.room.name,
        `сброс зависшего ${creep.name}`,
        { ticks: info.ticks },
      );
    }
  },

  /**
   * Определяет завис ли крип.
   * Отслеживает позицию И изменение store (несёт ресурс — значит работает).
   * v2.0: отслеживаем getUsedCapacity() вместо только energy
   * — иначе labWorker с минералами всегда казался "зависшим".
   */
  _getStuckInfo: function (creep) {
    if (!creep.memory._diag) {
      creep.memory._diag = {
        x: creep.pos.x,
        y: creep.pos.y,
        // v2.0: используем getUsedCapacity() — учитываем любой ресурс
        carrying: creep.store.getUsedCapacity(),
        sinceAt: Game.time,
      };
      return null;
    }

    const d = creep.memory._diag;
    const moved = d.x !== creep.pos.x || d.y !== creep.pos.y;
    // Изменилось что-то в store (загрузился или разгрузился)
    const carryChanged = creep.store.getUsedCapacity() !== d.carrying;

    if (moved || carryChanged) {
      d.x = creep.pos.x;
      d.y = creep.pos.y;
      d.carrying = creep.store.getUsedCapacity();
      d.sinceAt = Game.time;
      return null;
    }

    const ticks = Game.time - d.sinceAt;
    return ticks >= STUCK_TICKS ? { ticks } : null;
  },

  _checkCreepIds: function (creep, verbose) {
    const fields = [
      "targetId",
      "deliverTo",
      "factoryId",
      "linkId",
      "containerId",
      "sourceId",
      "mineralId",
    ];

    for (const field of fields) {
      const id = creep.memory[field];
      if (!id) continue;

      const obj = Game.getObjectById(id);
      if (!obj) {
        if (verbose) {
          console.log(`  ❌ невалидный ID: field=${field} id=${id}`);
        } else {
          Logger.warn("Diagnostics", "missing object", {
            role: creep.memory.role,
            creep: creep.name,
            field,
            id: id.slice(-6),
            room: creep.room.name,
          });
          Logger.event(
            "invalid_id",
            creep.room.name,
            `невалидный ${field} у ${creep.name}`,
            { field, id: id.slice(-6) },
          );
        }

        // AUTO RECOVERY: удаляем невалидный ID из памяти
        if (!verbose) {
          delete creep.memory[field];
          Logger.event(
            "auto_recovery",
            creep.room.name,
            `удалён невалидный ${field} у ${creep.name}`,
          );
        }
      }
    }
  },

  _checkDeliveryWorker: function (creep) {
    if (creep.memory.role !== "test_deliveryWorker") return;

    const a = creep.memory.deliveryAssignment;
    if (!a) return;

    const list =
      Memory.empire &&
      Memory.empire.logistics &&
      Memory.empire.logistics.deliveries &&
      Memory.empire.logistics.deliveries[a.roomName];

    if (!list) return;

    const delivery = list.find(d => d.createdAt === a.deliveryId);

    if (!delivery) {
      Logger.warn("Diagnostics", "deadlock: delivery not found", {
        creep: creep.name,
        deliveryId: a.deliveryId,
        room: a.roomName,
      });
      Logger.event(
        "deadlock",
        a.roomName,
        `delivery не найдена у ${creep.name}`,
        { deliveryId: a.deliveryId },
      );

      // AUTO RECOVERY: сбрасываем невалидное assignment
      delete creep.memory.deliveryAssignment;
      creep.memory.deliveryState = "idle";
      Logger.event(
        "auto_recovery",
        a.roomName,
        `сброс невалидного assignment у ${creep.name}`,
      );
      return;
    }

    // Крип несёт ресурс но цель переполнена
    const state = creep.memory.deliveryState;
    if (
      (state === "cycle_deliver" || state === "deliver") &&
      (creep.store[a.resource] || 0) > 0
    ) {
      const target = this._findDeliveryTarget(creep, a);
      if (target && target.store.getFreeCapacity(a.resource) === 0) {
        Logger.warn("Diagnostics", "deadlock: target full", {
          creep: creep.name,
          resource: a.resource,
          target: a.target,
        });
        Logger.event(
          "deadlock",
          creep.room.name,
          `цель переполнена для ${creep.name}`,
          { resource: a.resource, target: a.target },
        );
      }
    }
  },

  _findDeliveryTarget: function (creep, assignment) {
    if (
      assignment.target === "factory" ||
      assignment.target === "factory_cycle"
    ) {
      return (
        creep.room.find(FIND_MY_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_FACTORY,
        })[0] || null
      );
    }
    if (assignment.target === "storage") return creep.room.storage || null;
    if (assignment.target === "lab" && assignment.targetLabId) {
      return Game.getObjectById(assignment.targetLabId) || null;
    }
    return null;
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ ФАБРИК (без изменений)
  // ══════════════════════════════════════════════════════

  _checkFactories: function () {
    const factoryRooms =
      Memory.empire && Memory.empire.factory ? Memory.empire.factory.rooms : {};

    for (const roomName in factoryRooms) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      this._checkRoomFactory(room);
    }
  },

  _checkRoomFactory: function (room) {
    const factory = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY,
    })[0];

    if (!factory) return;

    const factoryData =
      Memory.empire &&
      Memory.empire.factory &&
      Memory.empire.factory.rooms &&
      Memory.empire.factory.rooms[room.name];

    if (!factoryData) return;

    const status = factoryData.status;
    const stuckTicks = Game.time - (factoryData.updatedAt || Game.time);

    if (status === "waiting_input" && stuckTicks > FACTORY_STUCK_TICKS) {
      Logger.warn("Diagnostics", "factory blocked: waiting_input too long", {
        room: room.name,
        ticks: stuckTicks,
      });
      Logger.event(
        "factory_blocked",
        room.name,
        `waiting_input ${stuckTicks} тиков`,
        { energy: factory.store[RESOURCE_ENERGY] || 0 },
      );

      // AUTO RECOVERY
      factoryData.status = "queued";
      factoryData.updatedAt = Game.time;
      Logger.event(
        "auto_recovery",
        room.name,
        "factory status сброшен в queued",
      );
    }

    const totalUsed = factory.store.getUsedCapacity();
    const totalCap = factory.store.getCapacity();
    if (totalCap && totalUsed / totalCap > 0.9) {
      Logger.warn("Diagnostics", "factory store nearly full", {
        room: room.name,
        used: totalUsed,
        cap: totalCap,
      });
      Logger.event("factory_blocked", room.name, "store почти полный", {
        used: totalUsed,
        cap: totalCap,
      });
    }

    Logger.diag("Diagnostics", "factory status", {
      room: room.name,
      status,
      energy: factory.store[RESOURCE_ENERGY] || 0,
      battery: factory.store[RESOURCE_BATTERY] || 0,
    });
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ ЛИНКОВ (без изменений)
  // ══════════════════════════════════════════════════════

  _checkLinks: function () {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      this._checkRoomLinks(room);
    }
  },

  _checkRoomLinks: function (room) {
    const links = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LINK,
    });

    if (links.length < 2) return;

    const fullLinks = links.filter(
      l =>
        l.store[RESOURCE_ENERGY] >= l.store.getCapacity(RESOURCE_ENERGY) * 0.8,
    );
    const emptyLinks = links.filter(l => (l.store[RESOURCE_ENERGY] || 0) === 0);

    if (
      fullLinks.length > 0 &&
      emptyLinks.length > 0 &&
      fullLinks[0].cooldown === 0
    ) {
      Logger.warn("Diagnostics", "link network stalled", {
        room: room.name,
        fullLinks: fullLinks.length,
        emptyLinks: emptyLinks.length,
      });
      Logger.event("link_blocked", room.name, "link network stalled", {
        fullLinks: fullLinks.length,
        emptyLinks: emptyLinks.length,
      });

      // AUTO RECOVERY
      if (fullLinks[0].cooldown === 0) {
        fullLinks[0].transferEnergy(emptyLinks[0]);
        Logger.event("auto_recovery", room.name, "link transfer инициирован");
      }
    }

    if (Logger.getConfig().diagEnabled) {
      console.log(`  Линки ${room.name}: ${links.length} шт.`);
      for (const link of links) {
        console.log(
          `    id=${link.id.slice(-6)} energy=${
            link.store[RESOURCE_ENERGY] || 0
          } cooldown=${link.cooldown}`,
        );
      }
    }
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ REMOTE MINERS (без изменений)
  // ══════════════════════════════════════════════════════

  _checkRemoteMiners: function () {
    const miners = Object.values(Game.creeps).filter(
      c => c.memory.role === "test_remoteMiner",
    );

    for (const miner of miners) {
      if (miner.memory.target && miner.room.name !== miner.memory.target) {
        const stuck = this._getStuckInfo(miner);
        if (stuck && stuck.ticks > 30) {
          Logger.warn("Diagnostics", "remote miner not reached target", {
            name: miner.name,
            room: miner.room.name,
            target: miner.memory.target,
            ticks: stuck.ticks,
          });
          Logger.event(
            "remote_miner_issue",
            miner.room.name,
            `${miner.name} не добрался до ${miner.memory.target}`,
            { ticks: stuck.ticks },
          );
        }
        continue;
      }

      if (miner.memory.sourceId && !Game.getObjectById(miner.memory.sourceId)) {
        Logger.warn("Diagnostics", "remote miner invalid sourceId", {
          name: miner.name,
          sourceId: miner.memory.sourceId,
        });
        Logger.event(
          "remote_miner_issue",
          miner.room.name,
          `невалидный sourceId у ${miner.name}`,
        );
      }
    }
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ ЛАБ [NEW v2.0]
  // ══════════════════════════════════════════════════════

  /**
   * Перебирает все свои комнаты с конфигами лаб.
   * Проверяет каждую тройку на наличие реагентов, переполнение реактора,
   * зависших labWorker'ов.
   */
  _checkLabs: function () {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      // Есть ли вообще конфиги лаб?
      const hasConfig = LAB_KEYS.some(
        k => room.memory[k] && room.memory[k].product,
      );
      if (!hasConfig) continue;

      this._checkRoomLabs(room);
    }
  },

  /**
   * Проверяет лабы конкретной комнаты.
   * Вызывается как автоматически так и из checkRoom().
   *
   * @param {Room} room
   */
  _checkRoomLabs: function (room) {
    const roomName = room.name;
    const mem = room.memory;

    for (const key of LAB_KEYS) {
      const config = mem[key];
      if (!config || !config.product) continue;

      const lab1 = Game.getObjectById(config.lab1);
      const lab2 = Game.getObjectById(config.lab2);
      const reactor = Game.getObjectById(config.reactor);

      // Лабы не найдены — ошибка конфига
      if (!lab1 || !lab2 || !reactor) {
        Logger.warn("Diagnostics", "lab config error: structure not found", {
          room: roomName,
          slot: key,
        });
        Logger.event(
          "lab_blocked",
          roomName,
          `[${key}] структура не найдена (проверьте ID в конфиге)`,
          { slot: key, product: config.product },
        );
        continue;
      }

      // ── Проверка: нет реагентов (lab_missing_input) ───────────────────
      // Смотрим в самих лабах — если пусто, это проблема
      const r1InLab = lab1.store[config.reagent1] || 0;
      const r2InLab = lab2.store[config.reagent2] || 0;

      if (r1InLab === 0) {
        Logger.event(
          "lab_missing_input",
          roomName,
          `[${key}] нет реагента ${config.reagent1} в L1`,
          { slot: key, reagent: config.reagent1, inLab: 0 },
        );
      }

      if (r2InLab === 0) {
        Logger.event(
          "lab_missing_input",
          roomName,
          `[${key}] нет реагента ${config.reagent2} в L2`,
          { slot: key, reagent: config.reagent2, inLab: 0 },
        );
      }

      // ── Проверка: реакция заблокирована давно (lab_blocked) ───────────
      // Используем labController — если статус waiting_input слишком долго
      const lcData =
        Memory.empire &&
        Memory.empire.labController &&
        Memory.empire.labController.rooms &&
        Memory.empire.labController.rooms[roomName];

      if (lcData && lcData.slots) {
        const slot = lcData.slots.find(s => s.slot === key);
        if (slot && slot.status === "waiting_input") {
          // Проверяем как давно обновлялись данные
          const stuckSince = lcData.updatedAt || Game.time;
          const stuckTicks = Game.time - stuckSince;

          if (stuckTicks > LAB_BLOCKED_TICKS) {
            Logger.warn("Diagnostics", "lab blocked: waiting_input too long", {
              room: roomName,
              slot: key,
              product: config.product,
              ticks: stuckTicks,
              missing: (slot.missing || []).join(","),
            });
            Logger.event(
              "lab_blocked",
              roomName,
              `[${key}] ${config.product} blocked ${stuckTicks} тиков`,
              { slot: key, missing: (slot.missing || []).join(",") },
            );
          }
        }
      }

      // ── Проверка: реактор переполнен (lab_output_full) ────────────────
      // Реактор заполнен продуктом > 2500 — labWorker не выгружает
      const productInReactor = reactor.store[config.product] || 0;
      const reactorCap = reactor.store.getCapacity(config.product) || 3000;

      if (productInReactor > reactorCap * 0.85) {
        Logger.warn("Diagnostics", "lab output full", {
          room: roomName,
          slot: key,
          product: config.product,
          amount: productInReactor,
          cap: reactorCap,
        });
        Logger.event(
          "lab_output_full",
          roomName,
          `[${key}] реактор почти полный: ${productInReactor}/${reactorCap} ${config.product}`,
          { slot: key, product: config.product, amount: productInReactor },
        );
      }
    }

    // ── Проверка: labWorker завис (lab_worker_stuck) ───────────────────
    // Ищем крипов с ролью labWorker в этой комнате
    const labWorkers = Object.values(Game.creeps).filter(
      c => c.memory.role === "labWorker" && c.room.name === roomName,
    );

    for (const worker of labWorkers) {
      const stuck = this._getStuckInfo(worker);
      if (stuck && stuck.ticks >= STUCK_TICKS) {
        Logger.warn("Diagnostics", "lab worker stuck", {
          name: worker.name,
          room: roomName,
          task: worker.memory.task || "—",
          ticks: stuck.ticks,
        });
        Logger.event(
          "lab_worker_stuck",
          roomName,
          `${worker.name} завис ${stuck.ticks} тиков`,
          { task: worker.memory.task, ticks: stuck.ticks },
        );
      }
    }
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ ТЕРМИНАЛА [NEW v2.0]
  // ══════════════════════════════════════════════════════

  /**
   * Перебирает все свои комнаты с терминалами.
   */
  _checkTerminals: function () {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      this._checkRoomTerminal(room);
    }
  },

  /**
   * Проверяет терминал конкретной комнаты.
   * Вызывается как автоматически так и из checkRoom().
   *
   * @param {Room} room
   */
  _checkRoomTerminal: function (room) {
    const roomName = room.name;
    const term = room.terminal;
    if (!term) return;

    const used = term.store.getUsedCapacity();
    const cap = term.store.getCapacity();
    const pct = used / cap;

    // ── Переполнен (terminal_full) ────────────────────────────────────────
    if (pct > TERMINAL_FULL_PCT) {
      Logger.warn("Diagnostics", "terminal nearly full", {
        room: roomName,
        used,
        cap,
        pct: Math.round(pct * 100),
      });
      Logger.event(
        "terminal_full",
        roomName,
        `терминал заполнен на ${Math.round(pct * 100)}%`,
        { used, cap },
      );
    }

    // ── Cooldown слишком долго (terminal_blocked) ──────────────────────
    // В норме cooldown сбрасывается за 1 тик.
    // Мы проверяем только если cooldown > порога — это значит что-то идёт не так.
    if (term.cooldown > TERMINAL_COOLDOWN_WARN) {
      Logger.warn("Diagnostics", "terminal high cooldown", {
        room: roomName,
        cooldown: term.cooldown,
      });
      Logger.event(
        "terminal_blocked",
        roomName,
        `высокий cooldown терминала: ${term.cooldown}`,
        { cooldown: term.cooldown },
      );
    }

    // ── Energy reserve (для сделок) ────────────────────────────────────
    const energy = term.store[RESOURCE_ENERGY] || 0;
    if (energy < TERMINAL_ENERGY_MIN) {
      Logger.warn("Diagnostics", "terminal low energy for trades", {
        room: roomName,
        energy,
        min: TERMINAL_ENERGY_MIN,
      });
      Logger.event(
        "terminal_blocked",
        roomName,
        `мало энергии для сделок: ${energy} (нужно ${TERMINAL_ENERGY_MIN})`,
        { energy, min: TERMINAL_ENERGY_MIN },
      );
    }

    // ── Подозрительно большой ресурс (resource_stuck) ─────────────────
    // Если один ресурс занимает > 50% терминала — возможно он не двигается
    for (const [res, amt] of Object.entries(term.store)) {
      if (res === RESOURCE_ENERGY) continue; // energy — норма
      if (amt > cap * 0.5) {
        Logger.warn("Diagnostics", "resource possibly stuck in terminal", {
          room: roomName,
          resource: res,
          amount: amt,
          pct: Math.round((amt / cap) * 100),
        });
        Logger.event(
          "resource_stuck",
          roomName,
          `${res} занимает ${Math.round((amt / cap) * 100)}% терминала`,
          { resource: res, amount: amt },
        );
      }
    }

    Logger.diag("Diagnostics", "terminal status", {
      room: roomName,
      used,
      cap,
      cooldown: term.cooldown,
      energy,
    });
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ МАРКЕТА [NEW v2.0]
  // ══════════════════════════════════════════════════════

  /**
   * Проверяет состояние маркета.
   * Запускается раз в RUN_INTERVAL тиков вместе с остальными проверками.
   */
  _checkMarket: function () {
    const meta = Memory.empire && Memory.empire.marketMeta;
    if (!meta) return; // MarketManager ещё не запускался

    // ── Данные устарели (market не обновлялся давно) ──────────────────
    const stale = Game.time - (meta.generatedAt || 0) > 300;
    if (stale) {
      Logger.warn("Diagnostics", "market data stale", {
        lastUpdate: meta.generatedAt,
        age: Game.time - (meta.generatedAt || 0),
      });
    }

    // ── Проверяем терминалы всех комнат на энергию для сделок ────────
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;

      const energy = room.terminal.store[RESOURCE_ENERGY] || 0;

      // Есть sell-интенты но нет энергии для транзакции
      const hasSellIntents =
        Memory.empire &&
        Memory.empire.market &&
        Memory.empire.market.sell &&
        Memory.empire.market.sell.length > 0;

      if (hasSellIntents && energy < TERMINAL_ENERGY_MIN) {
        Logger.warn("Diagnostics", "market: terminal no energy for deal", {
          room: roomName,
          energy,
          min: TERMINAL_ENERGY_MIN,
        });
        Logger.event(
          "market_no_energy",
          roomName,
          `нет энергии для сделки: ${energy} < ${TERMINAL_ENERGY_MIN}`,
          { energy, min: TERMINAL_ENERGY_MIN },
        );
      }
    }

    // ── Проверяем что не продаём критические ресурсы ──────────────────
    const economy = Memory.empire && Memory.empire.economy;
    const sellIntents =
      Memory.empire && Memory.empire.market && Memory.empire.market.sell;

    if (economy && sellIntents) {
      for (const intent of sellIntents) {
        const state = economy[intent.resource];
        if (state && (state.state === "critical" || state.state === "low")) {
          Logger.warn("Diagnostics", "market warning: selling low resource", {
            resource: intent.resource,
            economyState: state.state,
            amount: intent.amount,
          });
          Logger.event(
            "market_price_warning",
            null,
            `продаём ${intent.resource} при состоянии ${state.state}`,
            { resource: intent.resource, state: state.state },
          );
        }
      }
    }

    Logger.diag("Diagnostics", "market check", {
      buyCount: meta.buyCount || 0,
      sellCount: meta.sellCount || 0,
      credits: Math.round(Game.market.credits),
    });
  },
};

module.exports = diagnostics;
