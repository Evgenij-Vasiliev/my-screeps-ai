/**
 * ===================================================
 * ECONOMYMANAGER.JS — Стратегический экономический анализ империи
 * ===================================================
 * VERSION: 1.0
 * Strategic Economic Intelligence Layer.
 *
 * НАЗНАЧЕНИЕ:
 * - Анализирует состояние экономики империи
 * - Определяет дефициты и избытки ресурсов
 * - Вычисляет отклонения от стратегических резервов
 * - Публикует economic state для других managers
 *
 * СИСТЕМА НЕ:
 * - управляет market
 * - запускает factories
 * - управляет logistics
 * - создаёт terminal transfers
 * - принимает tactical room decisions
 * - мутирует ResourceRegistry
 * - пишет в чужие managers
 *
 * INPUTS:
 * empireResourceRegistry.getResources()
 * empireResourceRegistry.getTotal()
 *
 * OUTPUTS:
 * Memory.empire.economy
 *
 * OWNERSHIP (DATA_OWNERSHIP.md):
 * EconomyManager владеет:
 * - global economy state
 * - resource priorities
 * - strategic reserves
 * - deficit analysis
 * - surplus analysis
 * - production goals
 * - strategic resource values
 * ===================================================
 */

const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал пересчёта в тиках.
 * Привязан к UPDATE_INTERVAL Registry (20 тиков) —
 * нет смысла считать чаще чем обновляются данные.
 * Считаем каждые 20 тиков — сразу после обновления Registry.
 */
const UPDATE_INTERVAL = 20;

/**
 * Версия формата данных.
 * Увеличивать при изменении структуры Memory.empire.economy.
 */
const ECONOMY_VERSION = 1;

/**
 * Стратегические резервы — целевые запасы ресурсов по всей империи.
 *
 * Логика порогов:
 * critical : total < 25% reserve target
 * low      : total < reserve target
 * stable   : total >= reserve target AND total < 2x reserve target
 * surplus  : total >= 2x reserve target
 *
 * Сейчас статические — dynamic AI будет позже.
 * Настраивать здесь без изменения архитектуры.
 */
const RESERVE_TARGETS = {
  // ── CORE RESOURCES ──────────────────────────────────────────────────────
  [RESOURCE_ENERGY]: 1000000, // энергия — критически важна
  [RESOURCE_BATTERY]: 200000, // батареи — буфер для power economy

  // ── BASE MINERALS ────────────────────────────────────────────────────────
  // Добываются в комнатах — умеренные резервы
  [RESOURCE_HYDROGEN]: 20000,
  [RESOURCE_OXYGEN]: 20000,
  [RESOURCE_UTRIUM]: 20000,
  [RESOURCE_LEMERGIUM]: 20000,
  [RESOURCE_KEANIUM]: 20000,
  [RESOURCE_ZYNTHIUM]: 20000,
  [RESOURCE_CATALYST]: 20000,
  [RESOURCE_GHODIUM]: 10000, // редкий — нужен для Nuker и T3 бустов

  // ── TIER 1 COMPOUNDS ────────────────────────────────────────────────────
  [RESOURCE_UTRIUM_HYDRIDE]: 5000, // UH
  [RESOURCE_UTRIUM_OXIDE]: 5000, // UO
  [RESOURCE_KEANIUM_HYDRIDE]: 5000, // KH
  [RESOURCE_KEANIUM_OXIDE]: 5000, // KO
  [RESOURCE_LEMERGIUM_HYDRIDE]: 5000, // LH
  [RESOURCE_LEMERGIUM_OXIDE]: 5000, // LO
  [RESOURCE_ZYNTHIUM_HYDRIDE]: 5000, // ZH
  [RESOURCE_ZYNTHIUM_OXIDE]: 5000, // ZO
  [RESOURCE_GHODIUM_HYDRIDE]: 5000, // GH
  [RESOURCE_GHODIUM_OXIDE]: 5000, // GO

  // ── TIER 2 COMPOUNDS ────────────────────────────────────────────────────
  [RESOURCE_UTRIUM_ACID]: 5000, // UH2O
  [RESOURCE_UTRIUM_ALKALIDE]: 5000, // UHO2
  [RESOURCE_KEANIUM_ACID]: 5000, // KH2O
  [RESOURCE_KEANIUM_ALKALIDE]: 5000, // KHO2
  [RESOURCE_LEMERGIUM_ACID]: 5000, // LH2O
  [RESOURCE_LEMERGIUM_ALKALIDE]: 5000, // LHO2
  [RESOURCE_ZYNTHIUM_ACID]: 5000, // ZH2O
  [RESOURCE_ZYNTHIUM_ALKALIDE]: 5000, // ZHO2
  [RESOURCE_GHODIUM_ACID]: 5000, // GH2O
  [RESOURCE_GHODIUM_ALKALIDE]: 5000, // GHO2

  // ── TIER 3 COMPOUNDS (бусты) ─────────────────────────────────────────────
  [RESOURCE_CATALYZED_UTRIUM_ACID]: 10000, // XUH2O
  [RESOURCE_CATALYZED_UTRIUM_ALKALIDE]: 10000, // XUHO2
  [RESOURCE_CATALYZED_KEANIUM_ACID]: 10000, // XKH2O
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: 10000, // XKHO2
  [RESOURCE_CATALYZED_LEMERGIUM_ACID]: 10000, // XLH2O
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 10000, // XLHO2
  [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: 10000, // XZH2O
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: 10000, // XZHO2
  [RESOURCE_CATALYZED_GHODIUM_ACID]: 10000, // XGH2O
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: 10000, // XGHO2
};

/**
 * Пороги для определения economic state.
 * Множители от reserve target.
 */
const THRESHOLDS = {
  CRITICAL: 0.25, // < 25% reserve → critical
  LOW: 1.0, // < 100% reserve → low
  STABLE: 2.0, // < 200% reserve → stable, иначе surplus
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const economyManager = {
  /**
   * Главная точка входа.
   * Вызывать ОДИН РАЗ за тик из main.js после empireResourceRegistry.run().
   *
   * CPU стратегия:
   * - Читает только из Registry snapshot (не сканирует комнаты сам)
   * - Пересчёт раз в UPDATE_INTERVAL тиков
   * - Lightweight математика без expensive searches
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};

    // Обновляем только по расписанию
    // +1 к offset чтобы запускаться ПОСЛЕ Registry (который на % 20 === 0)
    if (Game.time % UPDATE_INTERVAL !== 1) return;

    this.analyze();
  },

  /**
   * Анализирует все ресурсы из Registry snapshot.
   * Вычисляет state, surplus, deficit для каждого ресурса.
   * Публикует в Memory.empire.economy.
   */
  analyze: function () {
    const startCpu = Game.cpu.getUsed();

    const resources = empireResourceRegistry.getResources();
    const economy = {};
    let criticalCount = 0;

    // ── АНАЛИЗ РЕСУРСОВ С RESERVE TARGETS ───────────────────────────────
    // Анализируем только ресурсы для которых заданы резервы.
    // Остальные ресурсы (редкие compounds) попадут в секцию ниже.
    for (const resourceType in RESERVE_TARGETS) {
      const reserveTarget = RESERVE_TARGETS[resourceType];
      const total = resources[resourceType] ? resources[resourceType].total : 0;

      const state = this._calcState(total, reserveTarget);
      const surplus = Math.max(0, total - reserveTarget);
      const deficit = Math.max(0, reserveTarget - total);

      economy[resourceType] = {
        state,
        total,
        reserveTarget,
        surplus,
        deficit,
      };

      if (state === "critical") criticalCount++;
    }

    // ── АНАЛИЗ РЕСУРСОВ БЕЗ RESERVE TARGETS ─────────────────────────────
    // Ресурсы которые есть в империи но не в RESERVE_TARGETS —
    // помечаем как surplus (есть запасы, но резерв не задан).
    // Это важно чтобы не терять данные из Registry.
    for (const resourceType in resources) {
      if (economy[resourceType]) continue; // уже обработан выше

      const total = resources[resourceType].total;
      economy[resourceType] = {
        state: "surplus", // резерв не задан → всё что есть — surplus
        total,
        reserveTarget: 0,
        surplus: total,
        deficit: 0,
      };
    }

    // ── ПУБЛИКАЦИЯ ───────────────────────────────────────────────────────
    const analyzeDuration = Game.cpu.getUsed() - startCpu;

    Memory.empire.economy = economy;
    Memory.empire.economyMeta = {
      version: ECONOMY_VERSION,
      generatedAt: Game.time,
      resourceCount: Object.keys(economy).length,
      criticalCount,
      analyzeDuration: Math.round(analyzeDuration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков
    if (Game.time % 100 <= 1) {
      const criticalList = Object.entries(economy)
        .filter(([, v]) => v.state === "critical")
        .map(([k]) => k);

      console.log(
        `[EconomyManager] 📈 Анализ завершён: ${
          Object.keys(economy).length
        } ресурсов` +
          ` | Critical: ${criticalCount}` +
          ` | CPU: ${analyzeDuration.toFixed(3)}ms`,
      );

      if (criticalCount > 0) {
        console.log(
          `[EconomyManager] 🚨 КРИТИЧЕСКИЕ РЕСУРСЫ: ${criticalList.join(", ")}`,
        );
      }
    }
  },

  /**
   * Вычисляет economic state ресурса по его количеству и reserve target.
   *
   * @param {number} total — сколько есть
   * @param {number} reserveTarget — сколько должно быть
   * @returns {string} 'critical' | 'low' | 'stable' | 'surplus'
   */
  _calcState: function (total, reserveTarget) {
    // Если резерв не задан — не можем анализировать
    if (reserveTarget === 0) return "surplus";

    const ratio = total / reserveTarget;

    if (ratio < THRESHOLDS.CRITICAL) return "critical";
    if (ratio < THRESHOLDS.LOW) return "low";
    if (ratio < THRESHOLDS.STABLE) return "stable";
    return "surplus";
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────
  // Методы для чтения данных другими системами.
  // Только чтение — EconomyManager владеет своими данными.

  /**
   * Получить полный economic state ресурса.
   *
   * @param {string} resourceType
   * @returns {Object|null} { state, total, reserveTarget, surplus, deficit }
   */
  getState: function (resourceType) {
    const economy = Memory.empire && Memory.empire.economy;
    if (!economy) return null;
    return economy[resourceType] || null;
  },

  /**
   * Получить дефицит ресурса.
   * 0 если дефицита нет.
   *
   * @param {string} resourceType
   * @returns {number}
   */
  getDeficit: function (resourceType) {
    const state = this.getState(resourceType);
    return state ? state.deficit : 0;
  },

  /**
   * Получить избыток ресурса.
   * 0 если избытка нет.
   *
   * @param {string} resourceType
   * @returns {number}
   */
  getSurplus: function (resourceType) {
    const state = this.getState(resourceType);
    return state ? state.surplus : 0;
  },

  /**
   * Проверить находится ли ресурс в критическом состоянии.
   *
   * @param {string} resourceType
   * @returns {boolean}
   */
  isCritical: function (resourceType) {
    const state = this.getState(resourceType);
    return state ? state.state === "critical" : false;
  },

  /**
   * Получить метаданные последнего анализа.
   * Используется для debugging и мониторинга.
   *
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.economyMeta) || {};
  },
};

module.exports = economyManager;
