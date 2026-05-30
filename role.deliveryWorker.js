/**
 * ===================================================
 * ROLE.DELIVERYWORKER.JS — Pure Delivery Execution Layer
 * ===================================================
 * VERSION: 2.4
 *
 * target='factory_cycle' — полный цикл без пауз:
 *   storage→[взять energy]→factory→[сдать energy, взять battery]→storage→[сдать battery]→complete
 *
 * target='lab'     — доставка реагента в лаб
 * target='factory' — разовая доставка в фабрику (legacy)
 * target='storage' — разовая доставка в хранилище (legacy)
 *
 * СОСТОЯНИЯ для factory_cycle:
 *   cycle_load    — берём энергию из storage
 *   cycle_deliver — несём энергию на фабрику
 *   cycle_pickup  — берём батарейки с фабрики
 *   cycle_unload  — несём батарейки в storage
 *
 * СОСТОЯНИЯ для разовых доставок (lab и др.):
 *   pickup  — берём ресурс
 *   deliver — несём к цели
 *
 *   idle — нет задания
 * ===================================================
 */

const STATE = {
  IDLE: "idle",
  // factory_cycle
  CYCLE_LOAD: "cycle_load",
  CYCLE_DELIVER: "cycle_deliver",
  CYCLE_PICKUP: "cycle_pickup",
  CYCLE_UNLOAD: "cycle_unload",
  // разовые доставки
  PICKUP: "pickup",
  DELIVER: "deliver",
};

const DELIVERY_STATUS = {
  QUEUED: "queued",
  ASSIGNED: "assigned",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const roleDeliveryWorker = {
  run: function (creep) {
    if (!creep.memory.deliveryState) {
      creep.memory.deliveryState = STATE.IDLE;
    }

    switch (creep.memory.deliveryState) {
      case STATE.IDLE:
        this._doIdle(creep);
        break;
      case STATE.CYCLE_LOAD:
        this._cycleLoad(creep);
        break;
      case STATE.CYCLE_DELIVER:
        this._cycleDeliver(creep);
        break;
      case STATE.CYCLE_PICKUP:
        this._cyclePickup(creep);
        break;
      case STATE.CYCLE_UNLOAD:
        this._cycleUnload(creep);
        break;
      case STATE.PICKUP:
        this._doPickup(creep);
        break;
      case STATE.DELIVER:
        this._doDeliver(creep);
        break;
      default:
        this._reset(creep);
        break;
    }
  },

  // ── IDLE ───────────────────────────────────────────────────────────────

  _doIdle: function (creep) {
    const a = creep.memory.deliveryAssignment;

    if (!a) {
      creep.say("💤 жду");
      return;
    }

    if (!a.resource || !a.target) {
      this._cancelAssignment(creep, "invalid");
      return;
    }

    this._updateDelivery(creep, DELIVERY_STATUS.ASSIGNED);

    if (a.target === "factory_cycle") {
      // Полный цикл — начинаем с загрузки энергии
      creep.memory.deliveryState = STATE.CYCLE_LOAD;
    } else {
      // Разовая доставка
      creep.memory.deliveryState =
        (creep.store[a.resource] || 0) > 0 ? STATE.DELIVER : STATE.PICKUP;
    }
  },

  // ══════════════════════════════════════════════════════
  // FACTORY CYCLE
  // ══════════════════════════════════════════════════════

  // ШАГ 1: Берём энергию из storage
  _cycleLoad: function (creep) {
    if ((creep.store[RESOURCE_ENERGY] || 0) > 0) {
      creep.memory.deliveryState = STATE.CYCLE_DELIVER;
      return;
    }

    const storage = creep.room.storage;
    if (!storage || (storage.store[RESOURCE_ENERGY] || 0) < 100) {
      creep.say("⏳ нет ⚡");
      return;
    }

    const result = creep.withdraw(storage, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
      creep.say("⚡ иду");
    } else if (result === OK) {
      creep.memory.deliveryState = STATE.CYCLE_DELIVER;
      this._updateDelivery(creep, DELIVERY_STATUS.DELIVERING);
    }
  },

  // ШАГ 2: Несём энергию на фабрику
  _cycleDeliver: function (creep) {
    if ((creep.store[RESOURCE_ENERGY] || 0) === 0) {
      creep.memory.deliveryState = STATE.CYCLE_PICKUP;
      return;
    }

    const factory = this._getFactory(creep);
    if (!factory) {
      creep.say("❌ нет завода");
      return;
    }

    const result = creep.transfer(factory, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(factory, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00aaff" },
      });
      creep.say("🏭 несу ⚡");
    } else if (result === OK || result === ERR_FULL) {
      creep.memory.deliveryState = STATE.CYCLE_PICKUP;
    }
  },

  // ШАГ 3: Берём батарейки с фабрики
  _cyclePickup: function (creep) {
    const PRODUCT =
      (creep.room.memory && creep.room.memory.factoryProduct) ||
      RESOURCE_BATTERY;
    if ((creep.store[PRODUCT] || 0) > 0) {
      creep.memory.deliveryState = STATE.CYCLE_UNLOAD;
      return;
    }

    const factory = this._getFactory(creep);
    if (!factory) {
      creep.memory.deliveryState = STATE.CYCLE_LOAD;
      return;
    }

    const amount = factory.store[PRODUCT] || 0;
    if (amount === 0) {
      // Батареек нет — идём грузить ещё энергию
      creep.memory.deliveryState = STATE.CYCLE_LOAD;
      creep.say("⏳ нет 🔋");
      return;
    }

    const toTake = Math.min(amount, creep.store.getFreeCapacity(PRODUCT));
    if (toTake <= 0) {
      creep.memory.deliveryState = STATE.CYCLE_UNLOAD;
      return;
    }

    const result = creep.withdraw(factory, PRODUCT, toTake);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(factory, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ff00ff" },
      });
      creep.say("🔋 беру");
    } else if (result === OK) {
      creep.memory.deliveryState = STATE.CYCLE_UNLOAD;
    } else {
      creep.memory.deliveryState = STATE.CYCLE_LOAD;
    }
  },

  // ШАГ 4: Несём батарейки в storage → завершаем цикл
  _cycleUnload: function (creep) {
    const PRODUCT =
      (creep.room.memory && creep.room.memory.factoryProduct) ||
      RESOURCE_BATTERY;
    if ((creep.store[PRODUCT] || 0) === 0) {
      // Цикл завершён — помечаем completed и берём новый
      this._completeAssignment(creep);
      return;
    }

    const storage = creep.room.storage;
    if (!storage) {
      creep.say("❌ нет storage");
      return;
    }

    const result = creep.transfer(storage, PRODUCT);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00ff00" },
      });
      creep.say("🏠 сдаю 🔋");
    } else if (result === OK) {
      this._completeAssignment(creep);
    } else if (result === ERR_FULL) {
      creep.say("⚠️ storage full");
    }
  },

  // ══════════════════════════════════════════════════════
  // РАЗОВЫЕ ДОСТАВКИ (lab и др.)
  // ══════════════════════════════════════════════════════

  _doPickup: function (creep) {
    const a = creep.memory.deliveryAssignment;
    if (!a) {
      this._reset(creep);
      return;
    }

    const resource = a.resource;

    if ((creep.store[resource] || 0) > 0) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateDelivery(creep, DELIVERY_STATUS.DELIVERING);
      return;
    }

    const source =
      creep.room.storage && (creep.room.storage.store[resource] || 0) >= 100
        ? creep.room.storage
        : creep.room.terminal &&
          (creep.room.terminal.store[resource] || 0) >= 100
        ? creep.room.terminal
        : null;

    if (!source) {
      this._cancelAssignment(creep, "no_source");
      return;
    }

    const toWithdraw = Math.min(
      a.amount,
      creep.store.getFreeCapacity(resource),
      source.store[resource] || 0,
    );
    if (toWithdraw <= 0) {
      this._cancelAssignment(creep, "nothing_to_withdraw");
      return;
    }

    const result = creep.withdraw(source, resource, toWithdraw);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
      creep.say("📦 иду");
    } else if (result === OK) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateDelivery(creep, DELIVERY_STATUS.DELIVERING);
    } else {
      this._cancelAssignment(creep, `withdraw_err_${result}`);
    }
  },

  _doDeliver: function (creep) {
    const a = creep.memory.deliveryAssignment;
    if (!a) {
      this._reset(creep);
      return;
    }

    const resource = a.resource;
    if ((creep.store[resource] || 0) === 0) {
      this._completeAssignment(creep);
      return;
    }

    let target = null;
    if (a.target === "lab")
      target = a.targetLabId ? Game.getObjectById(a.targetLabId) : null;
    if (a.target === "factory") target = this._getFactory(creep);
    if (a.target === "storage") target = creep.room.storage;

    if (!target) {
      this._cancelAssignment(creep, "target_missing");
      return;
    }

    const result = creep.transfer(target, resource);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00aaff" },
      });
      creep.say("🧪 несу");
    } else if (result === OK) {
      this._completeAssignment(creep);
    } else if (result === ERR_FULL) {
      this._cancelAssignment(creep, "target_full");
    } else {
      this._cancelAssignment(creep, `transfer_err_${result}`);
    }
  },

  // ══════════════════════════════════════════════════════
  // ОБЩИЕ МЕТОДЫ
  // ══════════════════════════════════════════════════════

  _getFactory: function (creep) {
    if (creep.memory.factoryId) {
      const f = Game.getObjectById(creep.memory.factoryId);
      if (f) return f;
      delete creep.memory.factoryId;
    }
    const factory =
      creep.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_FACTORY,
      })[0] || null;
    if (factory) creep.memory.factoryId = factory.id;
    return factory;
  },

  _findDelivery: function (creep) {
    const a = creep.memory.deliveryAssignment;
    if (!a || a.deliveryId == null) return null;
    const list =
      Memory.empire &&
      Memory.empire.logistics &&
      Memory.empire.logistics.deliveries &&
      Memory.empire.logistics.deliveries[a.roomName];
    if (!list) return null;
    return list.find(d => d.createdAt === a.deliveryId) || null;
  },

  _updateDelivery: function (creep, status) {
    const d = this._findDelivery(creep);
    if (!d) return;
    d.status = status;
    d.assignedTo = creep.name;
    d.updatedAt = Game.time;
  },

  _completeAssignment: function (creep) {
    const a = creep.memory.deliveryAssignment;
    this._updateDelivery(creep, DELIVERY_STATUS.COMPLETED);
    delete creep.memory.deliveryAssignment;

    // Если завершили factory_cycle — сразу ищем новый в очереди
    // без ожидания TaskDispatcher (убирает паузу между циклами)
    if (a && a.target === "factory_cycle") {
      const next = this._findNextFactoryCycle(creep);
      if (next) {
        next.status = DELIVERY_STATUS.ASSIGNED;
        next.assignedTo = creep.name;
        next.assignedAt = Game.time;
        next.updatedAt = Game.time;
        creep.memory.deliveryAssignment = {
          roomName: a.roomName,
          deliveryId: next.createdAt,
          resource: next.resource,
          amount: next.amount,
          target: next.target,
          targetLabId: null,
        };
        creep.memory.deliveryState = STATE.CYCLE_LOAD;
        return;
      }
    }

    creep.memory.deliveryState = STATE.IDLE;
  },

  /**
   * Ищет следующий queued factory_cycle в комнате крипа.
   * @param {Creep} creep
   * @returns {Object|null}
   */
  _findNextFactoryCycle: function (creep) {
    const list =
      Memory.empire &&
      Memory.empire.logistics &&
      Memory.empire.logistics.deliveries &&
      Memory.empire.logistics.deliveries[creep.room.name];
    if (!list) return null;
    return (
      list.find(
        d =>
          d.target === "factory_cycle" && d.status === DELIVERY_STATUS.QUEUED,
      ) || null
    );
  },

  _cancelAssignment: function (creep, reason) {
    const a = creep.memory.deliveryAssignment;
    if (a)
      console.log(
        `[DeliveryWorker] ${creep.name}: отмена [${reason}] ${a.resource}→${a.target}`,
      );
    this._updateDelivery(creep, DELIVERY_STATUS.CANCELLED);
    delete creep.memory.deliveryAssignment;
    creep.memory.deliveryState = STATE.IDLE;
  },

  _reset: function (creep) {
    delete creep.memory.deliveryAssignment;
    creep.memory.deliveryState = STATE.IDLE;
  },
};

module.exports = roleDeliveryWorker;
