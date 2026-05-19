/**
 * ===================================================
 * FACTORYDIRECTOR.JS — Промышленный оркестратор империи
 * ===================================================
 * VERSION: 1.0
 * Industrial Execution Layer.
 *
 * НАЗНАЧЕНИЕ:
 * - Управляет factory production
 * - Строит production queues
 * - Назначает задачи фабрикам
 * - Поддерживает strategic reserves через производство
 *
 * СИСТЕМА НЕ:
 * - управляет market
 * - управляет logistics
 * - принимает room-level tactical decisions
 * - сканирует ресурсы напрямую
 * - анализирует economy самостоятельно
 * - напрямую вызывает factory.produce() в creep logic
 * - хранит hidden state
 *
 * INPUTS:
 * economyManager.getState()
 * economyManager.getDeficit()
 * economyManager.isCritical()
 * empireResourceRegistry.getResources()
 * empireResourceRegistry.getInRoom()
 *
 * OUTPUTS:
 * Memory.empire.factory
 *
 * OWNERSHIP (DATA_OWNERSHIP.md):
 * FactoryDirector владеет:
 * - production queues
 * - factory assignments
 * - production execution
 * - factory status
 *
 * FactoryDirector НЕ имеет права:
 * - менять strategic priorities
 * - менять global economy state
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал пересчёта в тиках.
 * Offset +2 — запускается после Registry (% 20 === 0)
 * и после EconomyManager (% 20 === 1).
 * Данные всегда свежие из обоих слоёв.
 */
const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 2;

/**
 * Версия формата данных.
 */
const FACTORY_VERSION = 1;

/**
 * Приоритеты производства.
 * Определяются на основе economic state из EconomyManager.
 */
const PRIORITY = {
  HIGH: "high", // isCritical() → немедленно производить
  NORMAL: "normal", // state === 'low' → производить в плановом порядке
  NONE: "none", // state === 'stable' || 'surplus' → не нужно
};

/**
 * Производственный каталог v1.
 *
 * Поддерживаемые ресурсы:
 * - RESOURCE_BATTERY: конвертация энергии в батареи
 * - RESOURCE_ENERGY:  конвертация батарей в энергию (аварийный режим)
 *
 * Структура каждой записи:
 * resource    — что производим
 * amount      — сколько за один production run
 * inputCheck  — какой ресурс проверяем как сырьё (для валидации)
 */
const PRODUCTION_CATALOG = [
  {
    resource: RESOURCE_BATTERY,
    amount: 5000,
    // Для производства battery нужна energy в комнате
    // Factory конвертирует: 10 energy → 1 battery
    inputCheck: RESOURCE_ENERGY,
  },
  {
    resource: RESOURCE_ENERGY,
    amount: 5000,
    // Для производства energy нужны battery в комнате
    // Factory конвертирует: 1 battery → 10 energy
    inputCheck: RESOURCE_BATTERY,
  },
];

/**
 * Минимальное количество сырья в комнате для запуска производства.
 * Нет смысла назначать задачу если сырья нет.
 */
const MIN_INPUT_AMOUNT = 1000;

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const factoryDirector = {
  /**
   * Главная точка входа.
   * Вызывать из main.js после economyManager.run().
   *
   * CPU стратегия:
   * - Работает по интервалу UPDATE_INTERVAL
   * - Читает только из существующих data layers
   * - Не выполняет expensive searches
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};

    // Offset +2: после Registry (+0) и EconomyManager (+1)
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;

    this.plan();
  },

  /**
   * Планирует производство для всех фабрик империи.
   *
   * Алгоритм:
   * 1. Собираем все комнаты с фабриками из Registry
   * 2. Для каждой комнаты определяем приоритетную задачу
   * 3. Публикуем в Memory.empire.factory
   *
   * ОДИН task на комнату — запрещено несколько одновременных задач.
   */
  plan: function () {
    const startCpu = Game.cpu.getUsed();

    // Читаем данные из существующих layers — не сканируем сами
    const resources = empireResourceRegistry.getResources();

    // Собираем комнаты у которых есть фабрика
    // Определяем через Game.rooms — Factory это структура, не ресурс
    // Это единственное обращение к Game.rooms — только для списка комнат
    const factoryRooms = Object.values(Game.rooms).filter(
      r =>
        r.controller &&
        r.controller.my &&
        r.find(FIND_MY_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_FACTORY,
        }).length > 0,
    );

    const roomTasks = {};
    let activeCount = 0;

    for (const room of factoryRooms) {
      const task = this._planRoomTask(room.name, resources);

      if (task) {
        roomTasks[room.name] = {
          task,
          status: "queued",
          assignedAt: Game.time,
        };
        activeCount++;
      } else {
        // Нет задачи — фабрика простаивает
        roomTasks[room.name] = {
          task: null,
          status: "idle",
          assignedAt: Game.time,
        };
      }
    }

    // ── ПУБЛИКАЦИЯ ───────────────────────────────────────────────────────
    const planDuration = Game.cpu.getUsed() - startCpu;

    Memory.empire.factory = {
      rooms: roomTasks,
    };

    Memory.empire.factoryMeta = {
      version: FACTORY_VERSION,
      generatedAt: Game.time,
      factoryCount: factoryRooms.length,
      activeCount,
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков
    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[FactoryDirector] 🏭 Планирование: ${factoryRooms.length} фабрик` +
          ` | Активных задач: ${activeCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );

      // Выводим активные задачи
      for (const [roomName, data] of Object.entries(roomTasks)) {
        if (data.task) {
          console.log(
            `[FactoryDirector] ${roomName}: ${data.task.resource}` +
              ` x${data.task.amount} [${data.task.priority}]`,
          );
        }
      }
    }
  },

  /**
   * Планирует задачу для одной комнаты.
   *
   * Алгоритм:
   * 1. Перебираем PRODUCTION_CATALOG
   * 2. Для каждого ресурса спрашиваем EconomyManager о состоянии
   * 3. Определяем приоритет
   * 4. Проверяем наличие сырья в комнате
   * 5. Возвращаем первую подходящую задачу (наивысший приоритет)
   *
   * @param {string} roomName
   * @param {Object} resources — snapshot из Registry
   * @returns {Object|null} task или null если нечего производить
   */
  _planRoomTask: function (roomName, resources) {
    // Кандидаты на производство с их приоритетами
    const candidates = [];

    for (const entry of PRODUCTION_CATALOG) {
      const { resource, amount, inputCheck } = entry;

      // Спрашиваем EconomyManager — не анализируем сами
      const priority = this._getPriority(resource);

      // NONE — этот ресурс не нужен сейчас
      if (priority === PRIORITY.NONE) continue;

      // Проверяем наличие сырья в этой комнате
      const inputInRoom = empireResourceRegistry.getInRoom(
        inputCheck,
        roomName,
      );

      if (inputInRoom < MIN_INPUT_AMOUNT) continue;

      candidates.push({ resource, amount, priority, inputInRoom });
    }

    if (candidates.length === 0) return null;

    // Сортируем: HIGH приоритет первым
    candidates.sort((a, b) => {
      if (a.priority === PRIORITY.HIGH && b.priority !== PRIORITY.HIGH)
        return -1;
      if (b.priority === PRIORITY.HIGH && a.priority !== PRIORITY.HIGH)
        return 1;
      return 0;
    });

    // Возвращаем задачу с наивысшим приоритетом
    const best = candidates[0];
    return {
      resource: best.resource,
      amount: best.amount,
      priority: best.priority,
    };
  },

  /**
   * Определяет приоритет производства ресурса
   * на основе данных EconomyManager.
   *
   * EconomyManager — единственный источник истины об экономике.
   * FactoryDirector не анализирует ресурсы самостоятельно.
   *
   * @param {string} resource
   * @returns {string} PRIORITY.HIGH | PRIORITY.NORMAL | PRIORITY.NONE
   */
  _getPriority: function (resource) {
    // Critical → HIGH priority
    if (economyManager.isCritical(resource)) return PRIORITY.HIGH;

    // Low → NORMAL priority
    const state = economyManager.getState(resource);
    if (state && state.state === "low") return PRIORITY.NORMAL;

    // Stable или surplus → не производим
    return PRIORITY.NONE;
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────
  // Методы для чтения данных другими системами.

  /**
   * Получить текущую задачу для комнаты.
   * Возвращает null если задачи нет или фабрики нет.
   *
   * Использование (будущий FactoryController в комнате):
   * const task = factoryDirector.getTask(room.name);
   * if (task) factory.produce(task.resource, task.amount);
   *
   * @param {string} roomName
   * @returns {Object|null} { resource, amount, priority }
   */
  getTask: function (roomName) {
    const factory = Memory.empire && Memory.empire.factory;
    if (!factory || !factory.rooms) return null;
    const roomData = factory.rooms[roomName];
    if (!roomData) return null;
    return roomData.task || null;
  },

  /**
   * Проверить есть ли активная задача для комнаты.
   *
   * @param {string} roomName
   * @returns {boolean}
   */
  hasTask: function (roomName) {
    return this.getTask(roomName) !== null;
  },

  /**
   * Получить все активные задачи по всем комнатам.
   * Возвращает только комнаты с задачами (status !== idle).
   *
   * @returns {Object} { roomName: { task, status, assignedAt } }
   */
  getAllTasks: function () {
    const factory = Memory.empire && Memory.empire.factory;
    if (!factory || !factory.rooms) return {};

    const result = {};
    for (const [roomName, data] of Object.entries(factory.rooms)) {
      if (data.task) result[roomName] = data;
    }
    return result;
  },

  /**
   * Получить метаданные последнего планирования.
   *
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.factoryMeta) || {};
  },
};

module.exports = factoryDirector;
