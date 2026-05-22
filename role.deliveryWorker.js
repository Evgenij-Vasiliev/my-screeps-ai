/**
 * ===================================================
 * ROLE.DELIVERYWORKER.JS — Dedicated Logistics Execution
 * ===================================================
 * VERSION: 1.1
 * Роль в памяти крипа: deliveryWorker
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - ИСПРАВЛЕН корневой баг: крип больше не зависит от
 *   logisticsDirector.getQueuedDelivery() как единственного
 *   источника задач. Теперь крип проактивно доставляет energy
 *   в фабрику если у фабрики есть task и мало сырья в store.
 * - Полная изоляция от worker/taskManager state machine.
 * - Только private memory fields: deliveryState, deliveryTarget,
 *   deliveryResource, deliveryAmount.
 *
 * НАЗНАЧЕНИЕ:
 * Единственная обязанность — доставлять ресурсы в фабрику.
 *
 * ЭТОТ КРИП НЕ:
 * - не строит
 * - не ремонтирует
 * - не апгрейдит
 * - не использует taskManager
 * - не использует creep.memory.working
 * - не использует creep.memory.task
 *
 * СОСТОЯНИЯ (creep.memory.deliveryState):
 * 'idle'    — ищем задачу
 * 'pickup'  — идём в storage за ресурсом
 * 'deliver' — несём ресурс к фабрике
 *
 * ПАМЯТЬ КРИПА (только private fields):
 * - deliveryState    {string} — текущее состояние
 * - deliveryTarget   {string} — ID цели (фабрики)
 * - deliveryResource {string} — какой ресурс везём
 * - deliveryAmount   {number} — сколько везём
 * ===================================================
 */

const factoryDirector = require("./factoryDirector");
const logisticsDirector = require("./logisticsDirector");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const STATE = {
  IDLE: "idle",
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

/**
 * Порог energy в фабрике ниже которого доставляем.
 * Если в фабрике меньше этого — нужна доставка.
 */
const FACTORY_ENERGY_THRESHOLD = 5000;

/**
 * Сколько energy везём за один рейс.
 */
const DELIVERY_AMOUNT = 5000;

/**
 * Карта: что нужно как сырьё для производства ресурса.
 */
const INPUT_MAP = {
  [RESOURCE_BATTERY]: RESOURCE_ENERGY,
  [RESOURCE_ENERGY]: RESOURCE_BATTERY,
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const roleDeliveryWorker = {
  /**
   * Главная точка входа.
   * @param {Creep} creep
   */
  run: function (creep) {
    // Инициализация
    if (!creep.memory.deliveryState) {
      creep.memory.deliveryState = STATE.IDLE;
    }

    switch (creep.memory.deliveryState) {
      case STATE.IDLE:
        this._doIdle(creep);
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

  /**
   * Ищем фабрику которой нужна доставка.
   *
   * Алгоритм:
   * 1. Сначала проверяем LogisticsDirector — есть ли queued delivery
   * 2. Если нет — проверяем фабрику напрямую:
   *    есть task + мало сырья в store → доставляем проактивно
   *
   * @param {Creep} creep
   */
  _doIdle: function (creep) {
    // ── ПУТЬ 1: через LogisticsDirector ───────────────────────────────────
    const delivery = logisticsDirector.getQueuedDelivery(creep.room.name);

    if (delivery) {
      // Берём delivery task
      delivery.status = DELIVERY_STATUS.ASSIGNED;
      delivery.assignedTo = creep.name;
      delivery.updatedAt = Game.time;

      // Находим фабрику
      const factory = this._getFactory(creep.room);
      if (!factory) {
        delivery.status = DELIVERY_STATUS.CANCELLED;
        delivery.updatedAt = Game.time;
        this._reset(creep);
        return;
      }

      creep.memory.deliveryState = STATE.PICKUP;
      creep.memory.deliveryTarget = factory.id;
      creep.memory.deliveryResource = delivery.resource;
      creep.memory.deliveryAmount = delivery.amount;
      creep.memory._deliveryId = delivery.createdAt;

      creep.say("📦 лог");
      return;
    }

    // ── ПУТЬ 2: проактивная проверка фабрики ──────────────────────────────
    const factory = this._getFactory(creep.room);
    if (!factory) {
      creep.say("💤 жду");
      return;
    }

    // Есть ли task для этой фабрики?
    const task = factoryDirector.getTask(creep.room.name);
    if (!task) {
      creep.say("💤 жду");
      return;
    }

    // Какое сырьё нужно?
    const inputResource = INPUT_MAP[task.resource];
    if (!inputResource) {
      creep.say("💤 жду");
      return;
    }

    // Сколько сырья в фабрике?
    const inFactory = factory.store[inputResource] || 0;

    if (inFactory >= FACTORY_ENERGY_THRESHOLD) {
      // Фабрика не голодает — ждём
      creep.say("✅ сыта");
      return;
    }

    // Есть ли сырьё в storage?
    const storage = creep.room.storage;
    if (!storage || (storage.store[inputResource] || 0) < 100) {
      creep.say("⚠️ нет");
      return;
    }

    // ── НАЗНАЧАЕМ ПРОАКТИВНУЮ ДОСТАВКУ ───────────────────────────────────
    const amount = Math.min(
      DELIVERY_AMOUNT,
      creep.store.getCapacity(),
      storage.store[inputResource],
    );

    creep.memory.deliveryState = STATE.PICKUP;
    creep.memory.deliveryTarget = factory.id;
    creep.memory.deliveryResource = inputResource;
    creep.memory.deliveryAmount = amount;
    creep.memory._deliveryId = null; // нет logistics delivery

    creep.say("📦 прямо");

    // console.log(
    //   `[DeliveryWorker] ${creep.name}: проактивная доставка` +
    //     ` ${inputResource} x${amount} → фабрика (в фабрике: ${inFactory})`,
    // );
  },

  // ── PICKUP ─────────────────────────────────────────────────────────────

  /**
   * Идём в storage, забираем ресурс.
   * @param {Creep} creep
   */
  _doPickup: function (creep) {
    const resource = creep.memory.deliveryResource;
    const amount = creep.memory.deliveryAmount;

    // Уже несём ресурс — идём сдавать
    if ((creep.store[resource] || 0) > 0) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateLogistics(creep, DELIVERY_STATUS.DELIVERING);
      return;
    }

    const storage = creep.room.storage;
    if (!storage || (storage.store[resource] || 0) === 0) {
      console.log(`[DeliveryWorker] ${creep.name}: нет ${resource} в storage`);
      this._updateLogistics(creep, DELIVERY_STATUS.CANCELLED);
      this._reset(creep);
      return;
    }

    const toWithdraw = Math.min(
      amount,
      creep.store.getFreeCapacity(resource),
      storage.store[resource],
    );

    const result = creep.withdraw(storage, resource, toWithdraw);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
      creep.say("🏃 storage");
      this._updateLogistics(creep, DELIVERY_STATUS.ASSIGNED);
      return;
    }

    if (result === OK) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateLogistics(creep, DELIVERY_STATUS.DELIVERING);
      creep.say("✅ взял");
      return;
    }

    // Ошибка
    console.log(`[DeliveryWorker] ${creep.name}: withdraw error ${result}`);
    this._updateLogistics(creep, DELIVERY_STATUS.CANCELLED);
    this._reset(creep);
  },

  // ── DELIVER ────────────────────────────────────────────────────────────

  /**
   * Несём ресурс к фабрике, сдаём.
   * @param {Creep} creep
   */
  _doDeliver: function (creep) {
    const resource = creep.memory.deliveryResource;

    if ((creep.store[resource] || 0) === 0) {
      // Всё сдали
      this._updateLogistics(creep, DELIVERY_STATUS.COMPLETED);
      this._reset(creep);
      return;
    }

    // Получаем фабрику по ID
    const factory = Game.getObjectById(creep.memory.deliveryTarget);
    if (!factory) {
      console.log(`[DeliveryWorker] ${creep.name}: фабрика не найдена`);
      this._updateLogistics(creep, DELIVERY_STATUS.CANCELLED);
      this._reset(creep);
      return;
    }

    const result = creep.transfer(factory, resource);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(factory, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00aaff" },
      });
      creep.say("🏭 несу");
      this._updateLogistics(creep, DELIVERY_STATUS.DELIVERING);
      return;
    }

    if (result === OK) {
      creep.say("✅ сдал");
      // console.log(
      //   `[DeliveryWorker] ${creep.name}: доставлено` + ` ${resource} → фабрика`,
      // );
      this._updateLogistics(creep, DELIVERY_STATUS.COMPLETED);
      this._reset(creep);
      return;
    }

    if (result === ERR_FULL) {
      // Фабрика полная — сдаём в storage
      const storage = creep.room.storage;
      if (storage) {
        if (creep.transfer(storage, resource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, { reusePath: 5 });
        }
      }
      this._updateLogistics(creep, DELIVERY_STATUS.CANCELLED);
      this._reset(creep);
      return;
    }

    console.log(`[DeliveryWorker] ${creep.name}: transfer error ${result}`);
    this._updateLogistics(creep, DELIVERY_STATUS.CANCELLED);
    this._reset(creep);
  },

  // ── ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ─────────────────────────────────────────────

  /**
   * Находим фабрику в комнате.
   * @param {Room} room
   * @returns {StructureFactory|null}
   */
  _getFactory: function (room) {
    return (
      room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_FACTORY,
      })[0] || null
    );
  },

  /**
   * Обновляем статус в LogisticsDirector если есть привязанная delivery.
   * Если доставка проактивная (нет _deliveryId) — ничего не делаем.
   * @param {Creep} creep
   * @param {string} status
   */
  _updateLogistics: function (creep, status) {
    if (!creep.memory._deliveryId) return;

    const list =
      Memory.empire &&
      Memory.empire.logistics &&
      Memory.empire.logistics.deliveries &&
      Memory.empire.logistics.deliveries[creep.room.name];

    if (!list) return;

    const delivery = list.find(d => d.createdAt === creep.memory._deliveryId);
    if (!delivery) return;

    delivery.status = status;
    delivery.updatedAt = Game.time;
  },

  /**
   * Сброс памяти крипа → IDLE.
   * @param {Creep} creep
   */
  _reset: function (creep) {
    creep.memory.deliveryState = STATE.IDLE;
    creep.memory.deliveryTarget = null;
    creep.memory.deliveryResource = null;
    creep.memory.deliveryAmount = null;
    creep.memory._deliveryId = null;
  },
};

module.exports = roleDeliveryWorker;
