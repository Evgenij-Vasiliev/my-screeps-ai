/**
 * ===================================================
 * ROLE.DELIVERYWORKER.JS — Pure Delivery Execution Layer
 * ===================================================
 * VERSION: 2.0
 * Роль в памяти крипа: deliveryWorker
 *
 * ИЗМЕНЕНИЯ v2.0:
 * - Убрана ВСЯ логика поиска и назначения deliveries.
 * - Убрана зависимость от logisticsDirector.getQueuedDelivery().
 * - Убрана проактивная проверка фабрики.
 * - Воркер только читает creep.memory.deliveryAssignment
 *   (которое устанавливает TaskDispatcher) и везёт.
 * - Добавлена поддержка target: 'lab' (targetLabId).
 * - Добавлен terminal как fallback источник ресурса.
 *
 * НАЗНАЧЕНИЕ:
 * Единственная обязанность — физически выполнить уже
 * назначенную доставку.
 *
 * ЭТОТ КРИП НЕ:
 * - не ищет deliveries
 * - не назначает tasks
 * - не анализирует priorities
 * - не строит, не ремонтирует, не апгрейдит
 * - не использует taskManager
 * - не использует creep.memory.working / creep.memory.task
 *
 * OWNERSHIP:
 * DeliveryWorker owns:
 *   creep.memory.deliveryState
 *
 * TaskDispatcher owns:
 *   creep.memory.deliveryAssignment
 *
 * LogisticsDirector owns:
 *   Memory.empire.logistics.deliveries
 *
 * СОСТОЯНИЯ (creep.memory.deliveryState):
 * 'idle'    — нет назначения, ждём TaskDispatcher
 * 'pickup'  — идём в storage/terminal за ресурсом
 * 'deliver' — несём ресурс к цели
 *
 * СТРУКТУРА creep.memory.deliveryAssignment (устанавливает TaskDispatcher):
 * {
 *   deliveryId:  number  — createdAt из logistics delivery (ключ)
 *   roomName:    string  — имя комнаты
 *   resource:    string  — какой ресурс везём
 *   amount:      number  — сколько везём
 *   target:      string  — 'factory' | 'lab'
 *   targetLabId: string  — ID лаба (только для target='lab')
 * }
 * ===================================================
 */

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

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const roleDeliveryWorker = {
  /**
   * Главная точка входа.
   * Вызывается из main.js для каждого крипа с role='deliveryWorker'.
   * @param {Creep} creep
   */
  run: function (creep) {
    // Инициализируем состояние если нет
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
        // Неизвестное состояние — сброс
        this._reset(creep);
        break;
    }
  },

  // ── IDLE ───────────────────────────────────────────────────────────────

  /**
   * Состояние ожидания назначения от TaskDispatcher.
   *
   * ВАЖНО: воркер сам НИЧЕГО не ищет.
   * Он только проверяет creep.memory.deliveryAssignment.
   * Если есть — переходит в PICKUP.
   * Если нет — ждёт.
   *
   * @param {Creep} creep
   */
  _doIdle: function (creep) {
    const assignment = creep.memory.deliveryAssignment;

    // Нет назначения от TaskDispatcher — ждём
    if (!assignment) {
      creep.say("💤 жду");
      return;
    }

    // Валидация назначения
    if (!assignment.resource || !assignment.target) {
      // Некорректное назначение — сбрасываем
      console.log(
        `[DeliveryWorker] ${creep.name}: некорректное assignment, сброс`,
      );
      this._cancelAssignment(creep, "invalid_assignment");
      return;
    }

    // Уже несём нужный ресурс (например, крип выжил после перезагрузки)
    if ((creep.store[assignment.resource] || 0) > 0) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateDelivery(creep, DELIVERY_STATUS.DELIVERING);
      return;
    }

    // Начинаем pickup
    creep.memory.deliveryState = STATE.PICKUP;
    this._updateDelivery(creep, DELIVERY_STATUS.ASSIGNED);
    creep.say("📦 иду");
  },

  // ── PICKUP ─────────────────────────────────────────────────────────────

  /**
   * Идём в storage (или terminal как fallback), забираем ресурс.
   *
   * Порядок источников:
   * 1. storage — основной
   * 2. terminal — fallback если в storage нет
   *
   * @param {Creep} creep
   */
  _doPickup: function (creep) {
    const assignment = creep.memory.deliveryAssignment;

    // Назначение пропало пока шли — отмена
    if (!assignment) {
      this._reset(creep);
      return;
    }

    const resource = assignment.resource;

    // Уже взяли ресурс — идём сдавать
    if ((creep.store[resource] || 0) > 0) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateDelivery(creep, DELIVERY_STATUS.DELIVERING);
      return;
    }

    // ── Ищем источник ресурса ─────────────────────────────────────────────

    const source = this._findSource(creep, resource);

    if (!source) {
      // Ресурса нет нигде — отмена
      console.log(
        `[DeliveryWorker] ${creep.name}: нет ${resource}` +
          ` в storage/terminal — отмена`,
      );
      this._cancelAssignment(creep, "no_source");
      return;
    }

    // ── Withdraw ──────────────────────────────────────────────────────────

    const toWithdraw = Math.min(
      assignment.amount,
      creep.store.getFreeCapacity(resource),
      source.store[resource],
    );

    const result = creep.withdraw(source, resource, toWithdraw);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
      creep.say("🏃 взять");
      return;
    }

    if (result === OK) {
      creep.memory.deliveryState = STATE.DELIVER;
      this._updateDelivery(creep, DELIVERY_STATUS.DELIVERING);
      creep.say("✅ взял");
      return;
    }

    // Ошибка withdraw
    console.log(
      `[DeliveryWorker] ${creep.name}: withdraw error ${result}` +
        ` (${resource})`,
    );
    this._cancelAssignment(creep, `withdraw_error_${result}`);
  },

  // ── DELIVER ────────────────────────────────────────────────────────────

  /**
   * Несём ресурс к цели, делаем transfer().
   *
   * Поддерживаемые targets:
   * - 'factory' → StructureFactory комнаты
   * - 'lab'     → конкретный lab по targetLabId
   *
   * @param {Creep} creep
   */
  _doDeliver: function (creep) {
    const assignment = creep.memory.deliveryAssignment;

    // Назначение пропало — сброс
    if (!assignment) {
      this._reset(creep);
      return;
    }

    const resource = assignment.resource;

    // Ресурс уже сдан (store пуст) — завершаем
    if ((creep.store[resource] || 0) === 0) {
      this._completeAssignment(creep);
      return;
    }

    // ── Находим цель ──────────────────────────────────────────────────────

    const target = this._findTarget(creep, assignment);

    if (!target) {
      // Цель не найдена — отмена
      console.log(
        `[DeliveryWorker] ${creep.name}: цель не найдена` +
          ` (target=${assignment.target}, labId=${assignment.targetLabId})`,
      );
      this._cancelAssignment(creep, "target_missing");
      return;
    }

    // ── Transfer ──────────────────────────────────────────────────────────

    const result = creep.transfer(target, resource);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00aaff" },
      });
      creep.say("🏭 несу");
      return;
    }

    if (result === OK) {
      creep.say("✅ сдал");
      this._completeAssignment(creep);
      return;
    }

    if (result === ERR_FULL) {
      // Цель полная — сдаём обратно в storage
      creep.say("⚠️ полн");
      const storage = creep.room.storage;
      if (storage) {
        if (creep.transfer(storage, resource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, { reusePath: 5 });
        }
      }
      this._cancelAssignment(creep, "target_full");
      return;
    }

    // Другая ошибка transfer
    console.log(`[DeliveryWorker] ${creep.name}: transfer error ${result}`);
    this._cancelAssignment(creep, `transfer_error_${result}`);
  },

  // ── ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ─────────────────────────────────────────────

  /**
   * Ищет источник ресурса: сначала storage, потом terminal.
   *
   * @param {Creep} creep
   * @param {string} resource
   * @returns {StructureStorage|StructureTerminal|null}
   */
  _findSource: function (creep, resource) {
    const room = creep.room;

    // 1. storage
    if (room.storage && (room.storage.store[resource] || 0) >= 100) {
      return room.storage;
    }

    // 2. terminal как fallback
    if (room.terminal && (room.terminal.store[resource] || 0) >= 100) {
      return room.terminal;
    }

    return null;
  },

  /**
   * Находит цель доставки по assignment.
   *
   * @param {Creep} creep
   * @param {Object} assignment
   * @returns {Structure|null}
   */
  _findTarget: function (creep, assignment) {
    if (assignment.target === "factory") {
      // Ищем фабрику в комнате
      return (
        creep.room.find(FIND_MY_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_FACTORY,
        })[0] || null
      );
    }

    if (assignment.target === "lab") {
      // Конкретный лаб по ID
      if (!assignment.targetLabId) return null;
      return Game.getObjectById(assignment.targetLabId) || null;
    }

    // Неизвестный тип цели
    return null;
  },

  /**
   * Находит delivery запись в LogisticsDirector по deliveryId.
   * deliveryId — это createdAt из записи (используется как ключ).
   *
   * @param {Creep} creep
   * @returns {Object|null} ссылка на delivery запись (live reference)
   */
  _findDelivery: function (creep) {
    const assignment = creep.memory.deliveryAssignment;
    if (
      !assignment ||
      assignment.deliveryId === undefined ||
      assignment.deliveryId === null
    ) {
      return null;
    }

    const deliveries =
      Memory.empire &&
      Memory.empire.logistics &&
      Memory.empire.logistics.deliveries &&
      Memory.empire.logistics.deliveries[assignment.roomName];

    if (!deliveries) return null;

    return deliveries.find(d => d.createdAt === assignment.deliveryId) || null;
  },

  /**
   * Обновляет статус delivery в LogisticsDirector.
   *
   * @param {Creep} creep
   * @param {string} status
   */
  _updateDelivery: function (creep, status) {
    const delivery = this._findDelivery(creep);
    if (!delivery) return;

    delivery.status = status;
    delivery.updatedAt = Game.time;
  },

  /**
   * Завершает delivery: status=completed, очищает assignment.
   *
   * @param {Creep} creep
   */
  _completeAssignment: function (creep) {
    this._updateDelivery(creep, DELIVERY_STATUS.COMPLETED);

    // Очищаем только deliveryAssignment — TaskDispatcher его выдал
    delete creep.memory.deliveryAssignment;

    // Сбрасываем состояние
    creep.memory.deliveryState = STATE.IDLE;
  },

  /**
   * Отменяет delivery: status=cancelled, очищает assignment.
   *
   * @param {Creep} creep
   * @param {string} reason — для лога
   */
  _cancelAssignment: function (creep, reason) {
    const assignment = creep.memory.deliveryAssignment;
    if (assignment) {
      console.log(
        `[DeliveryWorker] ${creep.name}: отмена delivery` +
          ` [${reason}] resource=${assignment.resource}` +
          ` target=${assignment.target}`,
      );
    }

    this._updateDelivery(creep, DELIVERY_STATUS.CANCELLED);

    delete creep.memory.deliveryAssignment;
    creep.memory.deliveryState = STATE.IDLE;
  },

  /**
   * Полный сброс состояния крипа.
   * Используется при неизвестных ошибках.
   *
   * @param {Creep} creep
   */
  _reset: function (creep) {
    creep.memory.deliveryState = STATE.IDLE;
    delete creep.memory.deliveryAssignment;
  },
};

module.exports = roleDeliveryWorker;
