/**
 * ===================================================
 * FACTORYDIRECTOR.JS — Промышленный оркестратор империи
 * ===================================================
 * VERSION: 1.1
 *
 * ИСПРАВЛЕНИЯ v1.1:
 * - КРИТИЧЕСКИЙ БАГ: _getPriority возвращал NONE при state='stable'
 *   и state='surplus' для battery. В результате фабрика никогда
 *   не работала — battery.total=200400 при reserveTarget=200000
 *   даёт state='stable' → task=null → вся цепочка стоит.
 *
 *   РЕШЕНИЕ: для RESOURCE_BATTERY производим при stable тоже (NORMAL).
 *   Останавливаем только при surplus (total > 2x reserveTarget = 400000).
 *   Фабрика работает непрерывно конвертируя избыток энергии в батарейки
 *   пока их меньше 400000.
 *
 * НАЗНАЧЕНИЕ:
 * - Управляет factory production planning
 * - Строит production queues
 * - Назначает задачи фабрикам
 *
 * СИСТЕМА НЕ:
 * - не управляет market
 * - не управляет logistics
 * - не вызывает factory.produce() напрямую
 * - не хранит hidden state
 *
 * INPUTS:
 *   economyManager.getState()
 *   economyManager.isCritical()
 *   empireResourceRegistry.getResources()
 *   empireResourceRegistry.getInRoom()
 *
 * OUTPUTS:
 *   Memory.empire.factory
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 2; // После Registry (0) и EconomyManager (1)

const FACTORY_VERSION = 1;

const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
  NONE: "none",
};

/**
 * Производственный каталог.
 *
 * resource   — что производим
 * amount     — сколько за один production run
 * inputCheck — ресурс-сырьё (проверяем наличие в комнате)
 */
const PRODUCTION_CATALOG = [
  {
    resource: RESOURCE_BATTERY,
    amount: 5000,
    inputCheck: RESOURCE_ENERGY,
  },
  {
    resource: RESOURCE_ENERGY,
    amount: 5000,
    inputCheck: RESOURCE_BATTERY,
  },
];

/**
 * Минимальное количество сырья в комнате для назначения задачи.
 */
const MIN_INPUT_AMOUNT = 1000;

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const factoryDirector = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.plan();
  },

  plan: function () {
    const startCpu = Game.cpu.getUsed();

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
      const task = this._planRoomTask(room.name);

      if (task) {
        roomTasks[room.name] = {
          task,
          status: "queued",
          assignedAt: Game.time,
          updatedAt: Game.time,
        };
        activeCount++;
      } else {
        roomTasks[room.name] = {
          task: null,
          status: "idle",
          assignedAt: Game.time,
          updatedAt: Game.time,
        };
      }
    }

    const planDuration = Game.cpu.getUsed() - startCpu;

    Memory.empire.factory = { rooms: roomTasks };

    Memory.empire.factoryMeta = {
      version: FACTORY_VERSION,
      generatedAt: Game.time,
      factoryCount: factoryRooms.length,
      activeCount,
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[FactoryDirector] 🏭 Планирование: ${factoryRooms.length} фабрик` +
          ` | Активных: ${activeCount}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );
      for (const [roomName, data] of Object.entries(roomTasks)) {
        if (data.task) {
          console.log(
            `[FactoryDirector]   ${roomName}: ${data.task.resource}` +
              ` x${data.task.amount} [${data.task.priority}]`,
          );
        }
      }
    }
  },

  _planRoomTask: function (roomName) {
    const candidates = [];

    for (const entry of PRODUCTION_CATALOG) {
      const { resource, amount, inputCheck } = entry;

      const priority = this._getPriority(resource);
      if (priority === PRIORITY.NONE) continue;

      const inputInRoom = empireResourceRegistry.getInRoom(
        inputCheck,
        roomName,
      );
      if (inputInRoom < MIN_INPUT_AMOUNT) continue;

      candidates.push({ resource, amount, priority });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (a.priority === PRIORITY.HIGH && b.priority !== PRIORITY.HIGH)
        return -1;
      if (b.priority === PRIORITY.HIGH && a.priority !== PRIORITY.HIGH)
        return 1;
      return 0;
    });

    const best = candidates[0];
    return {
      resource: best.resource,
      amount: best.amount,
      priority: best.priority,
    };
  },

  /**
   * Определяет приоритет производства ресурса.
   *
   * ИСПРАВЛЕНО v1.1:
   * Для RESOURCE_BATTERY производим при stable тоже.
   * Останавливаем только при surplus (total > 2x reserveTarget).
   *
   * Логика:
   * - critical → HIGH  (срочно нужно)
   * - low      → HIGH  (нужно)
   * - stable   → NORMAL для battery, NONE для остальных
   * - surplus  → NONE  (достаточно)
   *
   * @param {string} resource
   * @returns {string} PRIORITY.HIGH | PRIORITY.NORMAL | PRIORITY.NONE
   */
  _getPriority: function (resource) {
    const state = economyManager.getState(resource);

    // EconomyManager ещё не инициализирован
    if (!state) return PRIORITY.NORMAL;

    if (state.state === "critical") return PRIORITY.HIGH;
    if (state.state === "low") return PRIORITY.HIGH;

    // ИСПРАВЛЕНИЕ: battery производим и при stable
    // Фабрика должна работать непрерывно конвертируя энергию
    if (resource === RESOURCE_BATTERY && state.state === "stable") {
      return PRIORITY.NORMAL;
    }

    // RESOURCE_ENERGY из battery — только если energy critical или low
    // При stable/surplus энергии достаточно, не конвертируем батарейки обратно
    if (state.state === "stable" || state.state === "surplus") {
      return PRIORITY.NONE;
    }

    return PRIORITY.NONE;
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────

  getTask: function (roomName) {
    const factory = Memory.empire && Memory.empire.factory;
    if (!factory || !factory.rooms) return null;
    const roomData = factory.rooms[roomName];
    if (!roomData) return null;
    return roomData.task || null;
  },

  hasTask: function (roomName) {
    return this.getTask(roomName) !== null;
  },

  getAllTasks: function () {
    const factory = Memory.empire && Memory.empire.factory;
    if (!factory || !factory.rooms) return {};
    const result = {};
    for (const [roomName, data] of Object.entries(factory.rooms)) {
      if (data.task) result[roomName] = data;
    }
    return result;
  },

  getMeta: function () {
    return (Memory.empire && Memory.empire.factoryMeta) || {};
  },
};

module.exports = factoryDirector;
