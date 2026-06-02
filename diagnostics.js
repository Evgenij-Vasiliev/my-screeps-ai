/**
 * ===================================================
 * DIAGNOSTICS.JS — Система диагностики и авторecovery
 * ===================================================
 * VERSION: 2.1
 *
 * ИЗМЕНЕНИЯ v2.1:
 * - Подключён diagnostics.labs.js
 * - _checkLabs() и _checkRoomLabs() делегированы в diagnosticsLabs
 * - Добавлен diagnostics.printLabRoom(roomName) как публичный метод
 *
 * ИЗМЕНЕНИЯ v2.0:
 * - Добавлена проверка лаб (_checkLabs)
 * - Добавлена проверка терминала (_checkTerminals)
 * - Добавлена проверка маркета (_checkMarket)
 *
 * СОХРАНЕНЫ (без изменений):
 * - _checkCreeps
 * - _checkFactories
 * - _checkLinks
 * - _checkRemoteMiners
 * ===================================================
 */

const Logger = require("./logger");
const diagnosticsLabs = require("./diagnostics.labs");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const RUN_INTERVAL = 50;
const STUCK_TICKS = 20;
const FACTORY_STUCK_TICKS = 100;
const LAB_BLOCKED_TICKS = 200;
const TERMINAL_COOLDOWN_WARN = 5;
const TERMINAL_FULL_PCT = 0.9;
const TERMINAL_ENERGY_MIN = 20000;
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
    this._checkLabs(); // делегируется в diagnostics.labs
    this._checkTerminals();
    this._checkMarket();

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
    this._checkRoomLabs(room);
    this._checkRoomTerminal(room);
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

  // Публичный метод — полный вывод диагностики лаб комнаты
  // Используется из console.js (labsDiag)
  printLabRoom: function (roomName) {
    diagnosticsLabs.printRoom(roomName);
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

  _getStuckInfo: function (creep) {
    if (!creep.memory._diag) {
      creep.memory._diag = {
        x: creep.pos.x,
        y: creep.pos.y,
        carrying: creep.store.getUsedCapacity(),
        sinceAt: Game.time,
      };
      return null;
    }

    const d = creep.memory._diag;
    const moved = d.x !== creep.pos.x || d.y !== creep.pos.y;
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
      delete creep.memory.deliveryAssignment;
      creep.memory.deliveryState = "idle";
      Logger.event(
        "auto_recovery",
        a.roomName,
        `сброс невалидного assignment у ${creep.name}`,
      );
      return;
    }

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
  // ПРОВЕРКИ ЛАБ — делегируется в diagnostics.labs.js
  // ══════════════════════════════════════════════════════

  _checkLabs: function () {
    diagnosticsLabs.run();
  },

  _checkRoomLabs: function (room) {
    // Краткая сводка при вызове checkRoom()
    const { status, reasons } = diagnosticsLabs.getRoomStatus(room.name);
    const icon = { OK: "✅", WARN: "⚠️ ", ERROR: "❌" };
    console.log(`  Labs: ${icon[status]} ${status}`);
    for (const r of reasons) console.log(`    ${r}`);
  },

  // ══════════════════════════════════════════════════════
  // ПРОВЕРКИ ТЕРМИНАЛА (без изменений v2.0)
  // ══════════════════════════════════════════════════════

  _checkTerminals: function () {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      this._checkRoomTerminal(room);
    }
  },

  _checkRoomTerminal: function (room) {
    const roomName = room.name;
    const term = room.terminal;
    if (!term) return;

    const used = term.store.getUsedCapacity();
    const cap = term.store.getCapacity();
    const pct = used / cap;

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

    for (const [res, amt] of Object.entries(term.store)) {
      if (res === RESOURCE_ENERGY) continue;
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
  // ПРОВЕРКИ МАРКЕТА (без изменений v2.0)
  // ══════════════════════════════════════════════════════

  _checkMarket: function () {
    const meta = Memory.empire && Memory.empire.marketMeta;
    if (!meta) return;

    const stale = Game.time - (meta.generatedAt || 0) > 300;
    if (stale) {
      Logger.warn("Diagnostics", "market data stale", {
        lastUpdate: meta.generatedAt,
        age: Game.time - (meta.generatedAt || 0),
      });
    }

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;

      const energy = room.terminal.store[RESOURCE_ENERGY] || 0;
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
