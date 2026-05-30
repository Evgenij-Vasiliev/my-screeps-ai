/**
 * ===================================================
 * DIAGNOSTICS.JS — Система диагностики и авторecovery
 * ===================================================
 * VERSION: 1.1
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Добавлена запись событий в Logger.event()
 * - Добавлен AUTO RECOVERY:
 *   * зависший крип → сброс памяти
 *   * невалидный ID → удаление из памяти
 *   * невалидная delivery → cancel + requeue
 *   * factory waiting_input слишком долго → reset status
 * ===================================================
 */

const Logger = require("./logger");

const RUN_INTERVAL = 50;
const STUCK_TICKS = 20;
const FACTORY_STUCK_TICKS = 100;

const DELIVERY_STATUS = {
  QUEUED: "queued",
  CANCELLED: "cancelled",
};

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
    const duration = Game.cpu.getUsed() - startCpu;
    Logger.diag("Diagnostics", "проверка завершена", {
      cpu: duration.toFixed(3),
    });
  },

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
  // ПРОВЕРКИ КРИПОВ
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

  _getStuckInfo: function (creep) {
    if (!creep.memory._diag) {
      creep.memory._diag = {
        x: creep.pos.x,
        y: creep.pos.y,
        energy: creep.store[RESOURCE_ENERGY] || 0,
        sinceAt: Game.time,
      };
      return null;
    }

    const d = creep.memory._diag;
    const moved = d.x !== creep.pos.x || d.y !== creep.pos.y;
    const carrying = (creep.store[RESOURCE_ENERGY] || 0) !== d.energy;

    if (moved || carrying) {
      d.x = creep.pos.x;
      d.y = creep.pos.y;
      d.energy = creep.store[RESOURCE_ENERGY] || 0;
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
  // ПРОВЕРКИ ФАБРИК
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

    // Фабрика слишком долго в waiting_input
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

      // AUTO RECOVERY: сбрасываем статус фабрики
      factoryData.status = "queued";
      factoryData.updatedAt = Game.time;
      Logger.event(
        "auto_recovery",
        room.name,
        "factory status сброшен в queued",
      );
    }

    // Store фабрики переполнен
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
  // ПРОВЕРКИ ЛИНКОВ
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

      // AUTO RECOVERY: пробуем transfer от полного к пустому
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
  // ПРОВЕРКИ REMOTE MINERS
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
};

module.exports = diagnostics;
