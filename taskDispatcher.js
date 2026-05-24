/**
 * ===================================================
 * TASKDISPATCHER.JS — Task Coordination Layer
 * ===================================================
 * VERSION: 1.0
 *
 * НАЗНАЧЕНИЕ:
 * Координирует назначение delivery задач воркерам.
 * Стоит между LogisticsDirector и DeliveryWorker.
 *
 * ЭТОТ МОДУЛЬ:
 * - читает queued deliveries из LogisticsDirector
 * - находит свободных deliveryWorker крипов
 * - назначает delivery → worker (1 к 1)
 * - восстанавливает stale assignments
 * - публикует в Memory.empire.dispatcher
 *
 * ЭТОТ МОДУЛЬ НЕ:
 * - не создаёт deliveries
 * - не двигает крипов
 * - не вызывает transfer()
 * - не анализирует экономику
 * - не управляет рынком
 *
 * PIPELINE:
 * LogisticsDirector → TaskDispatcher → DeliveryWorker
 *
 * INPUTS:
 * Memory.empire.logistics.deliveries  — очередь доставок
 * Game.creeps                         — список крипов
 *
 * OUTPUTS:
 * Memory.empire.dispatcher            — таблица назначений
 * creep.memory.deliveryAssignment     — задача воркера
 *
 * OWNERSHIP:
 * TaskDispatcher владеет:
 * - assignment lifecycle: queued → assigned
 * - Memory.empire.dispatcher
 * - creep.memory.deliveryAssignment
 *
 * DeliveryWorker владеет:
 * - execution lifecycle: assigned → delivering → completed
 * ===================================================
 */

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Как часто запускаем диспетчер (в тиках).
 * Каждые 5 тиков — достаточно быстро для реакции,
 * достаточно редко для экономии CPU.
 */
const UPDATE_INTERVAL = 5;

/**
 * Версия формата данных в Memory.
 */
const DISPATCHER_VERSION = 1;

/**
 * Через сколько тиков без обновления считаем assignment устаревшим.
 * Если воркер завис или умер — возвращаем delivery в очередь.
 */
const STALE_TIMEOUT = 100;

/**
 * Роль крипов которые выполняют доставки.
 */
const DELIVERY_ROLE = "deliveryWorker";

/**
 * Статусы delivery (зеркало из LogisticsDirector).
 */
const DELIVERY_STATUS = {
  QUEUED: "queued",
  ASSIGNED: "assigned",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

/**
 * Приоритеты (зеркало из LogisticsDirector).
 */
const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const taskDispatcher = {
  /**
   * Главная точка входа.
   * Вызывать из main.js после logisticsDirector.run().
   *
   * Порядок вызовов в main.js:
   * empireResourceRegistry.run()   // offset 0
   * economyManager.run()           // offset 1
   * factoryDirector.run()          // offset 2
   * logisticsDirector.run()        // offset 3
   * taskDispatcher.run()           // каждые 5 тиков
   */
  run: function () {
    // Инициализация хранилища
    if (!Memory.empire) Memory.empire = {};
    if (!Memory.empire.dispatcher) {
      Memory.empire.dispatcher = { assignments: {} };
    }

    // Запускаем каждые UPDATE_INTERVAL тиков
    if (Game.time % UPDATE_INTERVAL !== 0) return;

    this._dispatch();
  },

  /**
   * Главная логика диспетчеризации.
   *
   * Алгоритм:
   * 1. Восстанавливаем stale assignments (мёртвые воркеры / таймаут)
   * 2. Собираем все queued deliveries (HIGH приоритет первым)
   * 3. Собираем свободных воркеров
   * 4. Назначаем: delivery → worker (1 к 1)
   * 5. Публикуем метаданные
   */
  _dispatch: function () {
    const startCpu = Game.cpu.getUsed();

    const deliveries =
      Memory.empire.logistics && Memory.empire.logistics.deliveries
        ? Memory.empire.logistics.deliveries
        : null;

    // Нет данных от LogisticsDirector — ждём
    if (!deliveries) return;

    // ── ШАГ 1: Восстановление stale assignments ───────────────────────
    const recoveredCount = this._recoverStale(deliveries);

    // ── ШАГ 2: Собираем очередь (HIGH сначала) ────────────────────────
    // Формат: [{ roomName, index, delivery }]
    const queue = this._buildQueue(deliveries);

    // ── ШАГ 3: Свободные воркеры ──────────────────────────────────────
    // Свободный = нет deliveryAssignment в памяти
    const idleWorkers = Object.values(Game.creeps).filter(
      c => c.memory.role === DELIVERY_ROLE && !c.memory.deliveryAssignment,
    );

    // ── ШАГ 4: Назначение ─────────────────────────────────────────────
    let assignedCount = 0;
    const assignments = Memory.empire.dispatcher.assignments;

    for (let i = 0; i < queue.length && idleWorkers.length > 0; i++) {
      const { roomName, index, delivery } = queue[i];

      // Берём первого свободного воркера
      const worker = idleWorkers.shift();

      // Обновляем delivery в памяти
      delivery.status = DELIVERY_STATUS.ASSIGNED;
      delivery.assignedTo = worker.name;
      delivery.assignedAt = Game.time;
      delivery.updatedAt = Game.time;

      // Пишем задачу воркеру
      // DeliveryWorker читает это поле и выполняет доставку
      worker.memory.deliveryAssignment = {
        roomName, // комната где лежит delivery
        deliveryIndex: index, // индекс в массиве deliveries[roomName]
      };

      // Публикуем в dispatcher registry
      // Ключ: уникальный по времени создания delivery
      const key = `delivery_${delivery.createdAt}`;
      assignments[key] = {
        creep: worker.name,
        assignedAt: Game.time,
        status: DELIVERY_STATUS.ASSIGNED,
        roomName,
        deliveryIndex: index,
        resource: delivery.resource,
        target: delivery.target,
      };

      assignedCount++;

      if (Game.time % 50 === 0 || assignedCount <= 3) {
        console.log(
          `[TaskDispatcher] ✅ ${worker.name} → ${delivery.resource}` +
            ` x${delivery.amount} [${delivery.priority}]` +
            ` target=${delivery.target} room=${roomName}`,
        );
      }
    }

    // ── ШАГ 5: Очищаем завершённые записи из dispatcher registry ──────
    this._cleanupAssignments(assignments, deliveries);

    // ── ПУБЛИКАЦИЯ МЕТАДАННЫХ ─────────────────────────────────────────
    const planDuration = Game.cpu.getUsed() - startCpu;

    Memory.empire.dispatcherMeta = {
      version: DISPATCHER_VERSION,
      generatedAt: Game.time,
      queuedCount: queue.length,
      idleWorkers: idleWorkers.length + assignedCount, // до назначения
      assignedCount,
      recoveredCount,
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    // Throttled logging — раз в 50 тиков
    if (Game.time % 50 === 0) {
      console.log(
        `[TaskDispatcher] 📋 queued=${queue.length}` +
          ` idle=${idleWorkers.length + assignedCount}` +
          ` assigned=${assignedCount}` +
          ` recovered=${recoveredCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );
    }
  },

  /**
   * Восстанавливает stale assignments.
   *
   * Случаи когда нужно восстановить:
   * 1. Воркер умер (нет в Game.creeps)
   * 2. Прошло STALE_TIMEOUT тиков с момента assignedAt
   *
   * Действие:
   * - delivery.status → queued
   * - delivery.assignedTo → удалить
   * - creep.memory.deliveryAssignment → удалить (если крип жив)
   * - dispatcher registry → удалить запись
   *
   * @param {Object} deliveries — Memory.empire.logistics.deliveries
   * @returns {number} количество восстановленных
   */
  _recoverStale: function (deliveries) {
    let recoveredCount = 0;
    const assignments = Memory.empire.dispatcher.assignments;

    for (const key in assignments) {
      const record = assignments[key];

      // Проверяем живость воркера
      const workerDead = !Game.creeps[record.creep];

      // Проверяем таймаут
      const isStale = Game.time - record.assignedAt > STALE_TIMEOUT;

      // Проверяем что delivery всё ещё assigned (не completed/cancelled)
      const roomDeliveries = deliveries[record.roomName];
      if (!roomDeliveries) {
        // Комната исчезла — чистим запись
        delete assignments[key];
        continue;
      }

      const delivery = roomDeliveries[record.deliveryIndex];

      // Если delivery завершена/отменена — просто чистим запись диспетчера
      if (
        !delivery ||
        delivery.status === DELIVERY_STATUS.COMPLETED ||
        delivery.status === DELIVERY_STATUS.CANCELLED
      ) {
        // Очищаем память живого воркера если нужно
        if (!workerDead && Game.creeps[record.creep]) {
          delete Game.creeps[record.creep].memory.deliveryAssignment;
        }
        delete assignments[key];
        continue;
      }

      // Восстанавливаем если воркер умер или таймаут
      if (workerDead || isStale) {
        const reason = workerDead ? "воркер мёртв" : "timeout";

        console.log(
          `[TaskDispatcher] ♻️  Восстановление: ${record.resource}` +
            ` room=${record.roomName} (${reason}, был: ${record.creep})`,
        );

        // Возвращаем delivery в очередь
        delivery.status = DELIVERY_STATUS.QUEUED;
        delete delivery.assignedTo;
        delete delivery.assignedAt;
        delivery.updatedAt = Game.time;

        // Очищаем память живого воркера (если жив но stale)
        if (!workerDead && Game.creeps[record.creep]) {
          delete Game.creeps[record.creep].memory.deliveryAssignment;
        }

        // Чистим запись диспетчера
        delete assignments[key];
        recoveredCount++;
      }
    }

    return recoveredCount;
  },

  /**
   * Строит очередь задач: HIGH приоритет сначала.
   *
   * @param {Object} deliveries — Memory.empire.logistics.deliveries
   * @returns {Array} [{ roomName, index, delivery }]
   */
  _buildQueue: function (deliveries) {
    const high = [];
    const normal = [];

    for (const roomName in deliveries) {
      const list = deliveries[roomName];

      for (let i = 0; i < list.length; i++) {
        const delivery = list[i];

        // Берём только queued — не assigned/delivering/completed
        if (delivery.status !== DELIVERY_STATUS.QUEUED) continue;

        const item = { roomName, index: i, delivery };

        if (delivery.priority === PRIORITY.HIGH) {
          high.push(item);
        } else {
          normal.push(item);
        }
      }
    }

    // HIGH сначала, потом NORMAL
    return [...high, ...normal];
  },

  /**
   * Очищает завершённые записи из dispatcher registry.
   * Нет смысла хранить записи о completed/cancelled delivery.
   *
   * @param {Object} assignments — Memory.empire.dispatcher.assignments
   * @param {Object} deliveries  — Memory.empire.logistics.deliveries
   */
  _cleanupAssignments: function (assignments, deliveries) {
    for (const key in assignments) {
      const record = assignments[key];
      const roomDeliveries = deliveries[record.roomName];
      if (!roomDeliveries) {
        delete assignments[key];
        continue;
      }
      const delivery = roomDeliveries[record.deliveryIndex];
      if (
        !delivery ||
        delivery.status === DELIVERY_STATUS.COMPLETED ||
        delivery.status === DELIVERY_STATUS.CANCELLED
      ) {
        delete assignments[key];
      }
    }
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────

  /**
   * Получить текущее назначение крипа.
   * Используется DeliveryWorker для чтения своей задачи.
   *
   * @param {string} creepName
   * @returns {Object|null} { roomName, deliveryIndex } или null
   */
  getAssignment: function (creepName) {
    const creep = Game.creeps[creepName];
    if (!creep) return null;
    return creep.memory.deliveryAssignment || null;
  },

  /**
   * Проверить есть ли у крипа назначение.
   *
   * @param {string} creepName
   * @returns {boolean}
   */
  hasAssignment: function (creepName) {
    return this.getAssignment(creepName) !== null;
  },

  /**
   * Получить все текущие назначения.
   *
   * @returns {Object} Memory.empire.dispatcher.assignments
   */
  getAssignments: function () {
    return (
      (Memory.empire &&
        Memory.empire.dispatcher &&
        Memory.empire.dispatcher.assignments) ||
      {}
    );
  },

  /**
   * Получить метаданные последнего запуска.
   *
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.dispatcherMeta) || {};
  },
};

module.exports = taskDispatcher;
