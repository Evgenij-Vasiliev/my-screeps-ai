/**
 * ===================================================
 * LOGISTICSDIRECTOR.JS — Логистический оркестратор империи
 * ===================================================
 * VERSION: 1.0
 * Logistics Orchestration Layer.
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
 * INPUTS:
 * factoryDirector.getAllTasks()
 * Memory.empire.factory.rooms[roomName].status
 * empireResourceRegistry.getInRoom()
 * economyManager.getState()
 *
 * OUTPUTS:
 * Memory.empire.logistics
 *
 * DELIVERY LIFECYCLE:
 * queued → assigned → delivering → completed
 *                   → cancelled
 *
 * OWNERSHIP (DATA_OWNERSHIP.md):
 * LogisticsDirector владеет:
 * - resource routing
 * - delivery priorities
 * - transfer scheduling
 * - balancing operations
 * ===================================================
 */

const factoryDirector = require("./factoryDirector");
const empireResourceRegistry = require("./empireResourceRegistry");
const economyManager = require("./economyManager");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал пересчёта в тиках.
 * Offset +3 — после Registry(+0), EconomyManager(+1), FactoryDirector(+2).
 */
const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 3;

/**
 * Версия формата данных.
 */
const LOGISTICS_VERSION = 1;

/**
 * Статусы delivery task — lifecycle.
 */
const DELIVERY_STATUS = {
  QUEUED: "queued", // создана, ждёт исполнителя
  ASSIGNED: "assigned", // назначена worker'у
  DELIVERING: "delivering", // worker в процессе доставки
  COMPLETED: "completed", // доставка завершена
  CANCELLED: "cancelled", // отменена (задача исчезла или ресурс доставлен)
};

/**
 * Приоритеты delivery.
 */
const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
};

/**
 * Карта: что нужно как сырьё для производства ресурса.
 * v1 поддерживает только ENERGY → FACTORY.
 * Расширяется в следующих версиях.
 */
const FACTORY_INPUT_MAP = {
  [RESOURCE_BATTERY]: RESOURCE_ENERGY,
  [RESOURCE_ENERGY]: RESOURCE_BATTERY,
};

/**
 * Количество энергии которое запрашиваем за один delivery task.
 */
const DELIVERY_AMOUNT = 2000;

/**
 * Сколько тиков держим completed/cancelled delivery перед очисткой.
 * Нужно чтобы worker мог прочитать финальный статус.
 */
const CLEANUP_AFTER_TICKS = 50;

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const logisticsDirector = {
  /**
   * Главная точка входа.
   * Вызывать из main.js после factoryDirector.run().
   *
   * CPU стратегия:
   * - Работает по интервалу UPDATE_INTERVAL
   * - Читает только из существующих data layers
   * - Не делает heavy scans каждый тик
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};

    // Offset +3: после всех предыдущих layers
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;

    this.plan();
  },

  /**
   * Планирует delivery tasks.
   *
   * Алгоритм:
   * 1. Читаем все factory tasks из FactoryDirector
   * 2. Находим фабрики со статусом waiting_input
   * 3. Для каждой создаём delivery task (с защитой от дублей)
   * 4. Очищаем завершённые/отменённые tasks
   * 5. Публикуем в Memory.empire.logistics
   */
  plan: function () {
    const startCpu = Game.cpu.getUsed();

    // Инициализируем структуру если нет
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

    // ── ШАГ 1: CLEANUP ────────────────────────────────────────────────────
    // Удаляем завершённые и отменённые deliveries старше CLEANUP_AFTER_TICKS
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

    // ── ШАГ 2: АНАЛИЗ BOTTLENECKS ─────────────────────────────────────────
    // Читаем все активные factory tasks из FactoryDirector
    const activeTasks = factoryDirector.getAllTasks();

    for (const roomName in factoryRooms) {
      const roomData = factoryRooms[roomName];

      // Нас интересуют только фабрики в состоянии waiting_input
      if (roomData.status !== "waiting_input") continue;
      if (!roomData.task) continue;

      waitingCount++;

      const task = roomData.task;

      // Определяем какое сырьё нужно фабрике
      // v1: только RESOURCE_ENERGY → FACTORY
      const inputResource = FACTORY_INPUT_MAP[task.resource];
      if (!inputResource) continue;

      // v1 scope: обрабатываем только доставку ENERGY
      if (inputResource !== RESOURCE_ENERGY) continue;

      // ── DUPLICATE PROTECTION ─────────────────────────────────────────
      // Не создаём новый task если уже есть активный для этой комнаты
      // и этого ресурса в статусе queued/assigned/delivering
      if (!deliveries[roomName]) deliveries[roomName] = [];

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

      // ── PRIORITY ─────────────────────────────────────────────────────
      // Спрашиваем EconomyManager — не анализируем сами
      const priority = economyManager.isCritical(task.resource)
        ? PRIORITY.HIGH
        : PRIORITY.NORMAL;

      // ── CREATE DELIVERY TASK ──────────────────────────────────────────
      const delivery = {
        resource: inputResource,
        target: "factory",
        amount: DELIVERY_AMOUNT,
        priority,
        status: DELIVERY_STATUS.QUEUED,
        createdAt: Game.time,
        updatedAt: Game.time,
      };

      deliveries[roomName].push(delivery);
      createdCount++;

      console.log(
        `[LogisticsDirector] 📦 ${roomName}: создана доставка` +
          ` ${inputResource} x${DELIVERY_AMOUNT}` +
          ` → factory [${priority}]`,
      );
    }

    // ── ШАГ 3: ПУБЛИКАЦИЯ ─────────────────────────────────────────────────
    const planDuration = Game.cpu.getUsed() - startCpu;

    // Считаем итоговую статистику
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
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков
    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[LogisticsDirector] 🚚 Планирование: waiting_input=${waitingCount}` +
          ` | active deliveries=${activeCount}` +
          ` | created=${createdCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );
    }
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────

  /**
   * Получить все delivery tasks для комнаты.
   *
   * @param {string} roomName
   * @returns {Array} массив delivery tasks или []
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
   * Получить все активные deliveries по всем комнатам.
   *
   * @returns {Object} { roomName: [delivery, ...] }
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
   * Обновить статус delivery task.
   * Вызывается будущим worker/task system.
   *
   * @param {string} roomName
   * @param {string} resource
   * @param {string} newStatus — один из DELIVERY_STATUS.*
   */
  updateStatus: function (roomName, resource, newStatus) {
    const deliveries = this.getDeliveries(roomName);
    const delivery = deliveries.find(
      d => d.resource === resource && d.target === "factory",
    );
    if (!delivery) return;
    delivery.status = newStatus;
    delivery.updatedAt = Game.time;
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
