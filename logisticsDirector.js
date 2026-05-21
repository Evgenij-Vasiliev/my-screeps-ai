/**
 * ===================================================
 * LOGISTICSDIRECTOR.JS — Логистический оркестратор империи
 * ===================================================
 * VERSION: 1.3
 * Logistics Orchestration Layer.
 *
 * ИЗМЕНЕНИЯ v1.3:
 * - DELIVERY_AMOUNT увеличен с 2000 до 5000.
 *   Причина: 2000 создавало слишком частые delivery cycles.
 *   5000 уменьшает logistics churn и factory starvation.
 *
 * ИЗМЕНЕНИЯ v1.2:
 * - Добавлен STALE CHECK: если воркер (assignedTo) мёртв
 *   или delivery не обновлялась более STALE_TIMEOUT тиков —
 *   статус сбрасывается обратно в queued.
 *   Это исправляет баг: delivery зависала навсегда при смерти воркера.
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Добавлен метод getQueuedDelivery(roomName)
 *   для интеграции с Worker System (Этап 6)
 * - Добавлено поле assignedTo в структуру delivery
 *
 * НАЗНАЧЕНИЕ:
 * - Анализирует logistics bottlenecks
 * - Определяет потребности фабрик
 * - Создаёт delivery tasks
 * - Orchestrates resource movement
 *
 * СИСТЕМА НЕ:
 * - двигает ресурсы напрямую
 * - управляет worker behavior
 * - вызывает transfer()
 * - управляет market
 * - принимает economic decisions
 * - строит production queues
 * - изменяет creep.memory напрямую
 *
 * DATA OWNERSHIP:
 * deliveries[]        — LogisticsDirector (создаёт, очищает)
 * delivery.status     — Worker System (обновляет)
 * delivery.assignedTo — Worker System (обновляет)
 * creep.memory        — Worker System (владеет)
 * ===================================================
 */

const factoryDirector = require("./factoryDirector");
const empireResourceRegistry = require("./empireResourceRegistry");
const economyManager = require("./economyManager");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 3; // после Registry(+0), EconomyManager(+1), FactoryDirector(+2)

const LOGISTICS_VERSION = 3;

/**
 * Статусы delivery task — lifecycle.
 * queued → assigned → delivering → completed
 *                   → cancelled
 */
const DELIVERY_STATUS = {
  QUEUED: "queued",
  ASSIGNED: "assigned",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
};

/**
 * Карта: что нужно как сырьё для производства ресурса.
 * v1: только ENERGY → FACTORY.
 */
const FACTORY_INPUT_MAP = {
  [RESOURCE_BATTERY]: RESOURCE_ENERGY,
  [RESOURCE_ENERGY]: RESOURCE_BATTERY,
};

/**
 * Количество ресурса за один delivery task.
 * ИЗМЕНЕНО v1.3: 2000 → 5000.
 * 5000 уменьшает количество рейсов и factory starvation.
 */
const DELIVERY_AMOUNT = 5000;

/**
 * Сколько тиков держим completed/cancelled delivery перед очисткой.
 * Worker должен успеть прочитать финальный статус.
 */
const CLEANUP_AFTER_TICKS = 50;

/**
 * Сколько тиков delivery может не обновляться прежде чем
 * считается зависшей (воркер умер или завис).
 *
 * Почему 100?
 * - Воркер обновляет updatedAt каждый тик пока активен.
 * - 100 тиков без обновления = воркер точно мёртв.
 * - Меньше 50 нельзя — воркер может просто идти к цели.
 */
const STALE_TIMEOUT = 100;

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const logisticsDirector = {
  /**
   * Главная точка входа.
   * Вызывать из main.js после factoryDirector.run().
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.plan();
  },

  /**
   * Планирует delivery tasks.
   * Находит фабрики в waiting_input → создаёт queued deliveries.
   */
  plan: function () {
    const startCpu = Game.cpu.getUsed();

    if (!Memory.empire.logistics) {
      Memory.empire.logistics = { deliveries: {} };
    }

    const deliveries = Memory.empire.logistics.deliveries;
    const factoryRooms = Memory.empire.factory
      ? Memory.empire.factory.rooms
      : {};

    let waitingCount = 0;
    let activeCount = 0;
    let createdCount = 0;
    let recoveredCount = 0; // сколько зависших deliveries восстановлено

    // ── CLEANUP: удаляем завершённые/отменённые старше 50 тиков ──────────
    for (const roomName in deliveries) {
      deliveries[roomName] = deliveries[roomName].filter(d => {
        const isDone =
          d.status === DELIVERY_STATUS.COMPLETED ||
          d.status === DELIVERY_STATUS.CANCELLED;
        const isOld =
          Game.time - (d.updatedAt || d.createdAt) > CLEANUP_AFTER_TICKS;
        return !(isDone && isOld);
      });
    }

    // ── STALE CHECK: сбрасываем зависшие deliveries ───────────────────────
    //
    // Проблема: воркер умирает в процессе доставки.
    // Delivery остаётся в статусе assigned/delivering навсегда.
    // LogisticsDirector видит "активную" delivery и не создаёт новую.
    // Фабрика голодает.
    //
    // Решение: проверяем каждую активную delivery:
    // 1. Если assignedTo — мёртвый крип → сбрасываем в queued немедленно.
    // 2. Если updatedAt не менялся более STALE_TIMEOUT тиков → сбрасываем.
    //
    // CPU: Game.creeps — это уже загруженный объект, обращение бесплатное.
    for (const roomName in deliveries) {
      for (const d of deliveries[roomName]) {
        // Проверяем только активные deliveries (не завершённые)
        if (
          d.status !== DELIVERY_STATUS.ASSIGNED &&
          d.status !== DELIVERY_STATUS.DELIVERING
        ) {
          continue;
        }

        // Проверка 1: воркер мёртв?
        const workerDead = d.assignedTo && !Game.creeps[d.assignedTo];

        // Проверка 2: delivery не обновлялась слишком долго?
        const lastUpdate = d.updatedAt || d.createdAt;
        const isStale = Game.time - lastUpdate > STALE_TIMEOUT;

        if (workerDead || isStale) {
          // Сбрасываем обратно в очередь — другой воркер подхватит
          const reason = workerDead ? "воркер мёртв" : "timeout";
          console.log(
            `[LogisticsDirector] ♻️  ${roomName}: delivery восстановлена` +
              ` (${reason}, был: ${d.assignedTo}, статус был: ${d.status})`,
          );

          d.status = DELIVERY_STATUS.QUEUED;
          d.assignedTo = null;
          d.updatedAt = Game.time;
          recoveredCount++;
        }
      }
    }

    // ── АНАЛИЗ BOTTLENECKS ────────────────────────────────────────────────
    for (const roomName in factoryRooms) {
      const roomData = factoryRooms[roomName];

      if (roomData.status !== "waiting_input") continue;
      if (!roomData.task) continue;

      waitingCount++;

      const inputResource = FACTORY_INPUT_MAP[roomData.task.resource];
      if (!inputResource) continue;
      if (inputResource !== RESOURCE_ENERGY) continue; // v1: только ENERGY

      if (!deliveries[roomName]) deliveries[roomName] = [];

      // DUPLICATE PROTECTION: не создаём если уже есть активный
      const alreadyActive = deliveries[roomName].some(
        d =>
          d.resource === inputResource &&
          d.target === "factory" &&
          (d.status === DELIVERY_STATUS.QUEUED ||
            d.status === DELIVERY_STATUS.ASSIGNED ||
            d.status === DELIVERY_STATUS.DELIVERING),
      );

      if (alreadyActive) {
        activeCount++;
        continue;
      }

      const priority = economyManager.isCritical(roomData.task.resource)
        ? PRIORITY.HIGH
        : PRIORITY.NORMAL;

      deliveries[roomName].push({
        resource: inputResource,
        target: "factory",
        amount: DELIVERY_AMOUNT,
        priority,
        status: DELIVERY_STATUS.QUEUED,
        createdAt: Game.time,
        updatedAt: Game.time,
        assignedTo: null, // заполняет Worker System
      });

      createdCount++;
      console.log(
        `[LogisticsDirector] 📦 ${roomName}: создана доставка` +
          ` ${inputResource} x${DELIVERY_AMOUNT} → factory [${priority}]`,
      );
    }

    // ── ПУБЛИКАЦИЯ ────────────────────────────────────────────────────────
    const planDuration = Game.cpu.getUsed() - startCpu;

    for (const roomName in deliveries) {
      activeCount += deliveries[roomName].filter(
        d =>
          d.status === DELIVERY_STATUS.QUEUED ||
          d.status === DELIVERY_STATUS.ASSIGNED ||
          d.status === DELIVERY_STATUS.DELIVERING,
      ).length;
    }

    Memory.empire.logistics.deliveries = deliveries;
    Memory.empire.logisticsMeta = {
      version: LOGISTICS_VERSION,
      generatedAt: Game.time,
      waitingCount,
      activeCount,
      createdCount,
      recoveredCount, // новое поле — для мониторинга
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[LogisticsDirector] 🚚 Планирование: waiting_input=${waitingCount}` +
          ` | active=${activeCount} | created=${createdCount}` +
          ` | recovered=${recoveredCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );
    }
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────

  /**
   * Получить первый queued delivery для комнаты.
   * Используется Worker System для взятия задачи.
   *
   * Возвращает объект delivery из Memory — по ссылке.
   * Worker обновляет status/assignedTo напрямую в этом объекте.
   *
   * @param {string} roomName
   * @returns {Object|null} delivery или null
   */
  getQueuedDelivery: function (roomName) {
    if (
      !Memory.empire ||
      !Memory.empire.logistics ||
      !Memory.empire.logistics.deliveries
    )
      return null;

    const list = Memory.empire.logistics.deliveries[roomName];
    if (!list) return null;

    return list.find(d => d.status === DELIVERY_STATUS.QUEUED) || null;
  },

  /**
   * Получить все delivery tasks для комнаты.
   *
   * @param {string} roomName
   * @returns {Array}
   */
  getDeliveries: function (roomName) {
    if (
      !Memory.empire ||
      !Memory.empire.logistics ||
      !Memory.empire.logistics.deliveries
    )
      return [];
    return Memory.empire.logistics.deliveries[roomName] || [];
  },

  /**
   * Проверить есть ли активные deliveries для комнаты.
   *
   * @param {string} roomName
   * @returns {boolean}
   */
  hasDeliveries: function (roomName) {
    return this.getDeliveries(roomName).some(
      d =>
        d.status === DELIVERY_STATUS.QUEUED ||
        d.status === DELIVERY_STATUS.ASSIGNED ||
        d.status === DELIVERY_STATUS.DELIVERING,
    );
  },

  /**
   * Получить все deliveries по всем комнатам.
   *
   * @returns {Object}
   */
  getAllDeliveries: function () {
    if (
      !Memory.empire ||
      !Memory.empire.logistics ||
      !Memory.empire.logistics.deliveries
    )
      return {};
    return Memory.empire.logistics.deliveries;
  },

  /**
   * Метаданные последнего планирования.
   *
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.logisticsMeta) || {};
  },
};

module.exports = logisticsDirector;
