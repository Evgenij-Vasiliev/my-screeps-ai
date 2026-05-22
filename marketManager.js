/**
 * ===================================================
 * MARKETMANAGER.JS — Market Intelligence Layer
 * ===================================================
 * VERSION: 1.0
 *
 * НАЗНАЧЕНИЕ:
 * - Анализирует surplus/deficit по EconomyManager
 * - Определяет что покупать (critical resources)
 * - Определяет что продавать (surplus resources)
 * - Публикует market intents в Memory.empire.market
 *
 * СИСТЕМА НЕ:
 * - не вызывает Game.market.deal()
 * - не отправляет ресурсы
 * - не управляет терминалами
 * - не двигает ресурсы между комнатами
 * - не сканирует рынок каждый тик
 *
 * INPUTS:
 * economyManager.getState(resource)
 * economyManager.getSurplus(resource)
 * economyManager.getDeficit(resource)
 * economyManager.isCritical(resource)
 * empireResourceRegistry.getTotal(resource)
 *
 * OUTPUTS:
 * Memory.empire.market
 *
 * БУДУЩИЙ PIPELINE:
 * MarketManager (intelligence) → MarketExecutor (execution)
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал пересчёта — 100 тиков.
 * Market analysis не нужен каждый тик.
 */
const UPDATE_INTERVAL = 100;

const MARKET_VERSION = 1;

/**
 * Только эти ресурсы разрешены к продаже в v1.
 * Защита от случайной продажи редких бустов.
 */
const SELLABLE_RESOURCES = new Set([RESOURCE_ENERGY, RESOURCE_BATTERY]);

/**
 * Минимальный surplus для создания sell intent.
 * Не продаём если surplus слишком мал.
 */
const MIN_SELL_SURPLUS = 50000;

/**
 * Приоритеты.
 */
const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const marketManager = {
  /**
   * Главная точка входа.
   * Вызывать из main.js.
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== 0) return;
    this.analyze();
  },

  /**
   * Анализирует economy state и публикует market intents.
   */
  analyze: function () {
    const startCpu = Game.cpu.getUsed();

    const buyIntents = [];
    const sellIntents = [];

    const economy = Memory.empire && Memory.empire.economy;
    if (!economy) return;

    // ── BUY ANALYSIS ──────────────────────────────────────────────────────
    // Покупаем critical resources
    for (const resource in economy) {
      const state = economy[resource];

      if (!economyManager.isCritical(resource)) continue;

      const deficit = economyManager.getDeficit(resource);
      if (deficit <= 0) continue;

      // Не создаём дубликаты
      if (buyIntents.find(i => i.resource === resource)) continue;

      buyIntents.push({
        resource,
        amount: deficit,
        priority: PRIORITY.HIGH,
        reason: "critical",
      });
    }

    // ── SELL ANALYSIS ─────────────────────────────────────────────────────
    // Продаём только разрешённые ресурсы с surplus
    for (const resource of SELLABLE_RESOURCES) {
      // Не продаём critical
      if (economyManager.isCritical(resource)) continue;

      const surplus = economyManager.getSurplus(resource);
      if (surplus < MIN_SELL_SURPLUS) continue;

      // Не создаём дубликаты
      if (sellIntents.find(i => i.resource === resource)) continue;

      const priority =
        surplus > MIN_SELL_SURPLUS * 3 ? PRIORITY.HIGH : PRIORITY.NORMAL;

      sellIntents.push({
        resource,
        amount: surplus,
        priority,
        reason: "surplus",
      });
    }

    // ── ПУБЛИКАЦИЯ ────────────────────────────────────────────────────────
    const duration = Game.cpu.getUsed() - startCpu;

    Memory.empire.market = {
      buy: buyIntents,
      sell: sellIntents,
      generatedAt: Game.time,
    };

    Memory.empire.marketMeta = {
      version: MARKET_VERSION,
      generatedAt: Game.time,
      buyCount: buyIntents.length,
      sellCount: sellIntents.length,
      criticalBuyCount: buyIntents.filter(i => i.priority === PRIORITY.HIGH)
        .length,
      surplusSellCount: sellIntents.length,
      analyzeDuration: Math.round(duration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков (каждый запуск)
    console.log(
      `[MarketManager] 📊 Анализ: buy=${buyIntents.length}` +
        ` sell=${sellIntents.length}` +
        ` | CPU: ${duration.toFixed(3)}ms`,
    );

    if (buyIntents.length > 0) {
      console.log(
        `[MarketManager] 🛒 BUY: ` +
          buyIntents
            .map(i => `${i.resource} x${i.amount} [${i.priority}]`)
            .join(", "),
      );
    }

    if (sellIntents.length > 0) {
      console.log(
        `[MarketManager] 💰 SELL: ` +
          sellIntents
            .map(i => `${i.resource} x${i.amount} [${i.priority}]`)
            .join(", "),
      );
    }
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  /**
   * Получить все buy intents.
   * @returns {Array}
   */
  getBuyIntents: function () {
    const market = Memory.empire && Memory.empire.market;
    return market ? market.buy : [];
  },

  /**
   * Получить все sell intents.
   * @returns {Array}
   */
  getSellIntents: function () {
    const market = Memory.empire && Memory.empire.market;
    return market ? market.sell : [];
  },

  /**
   * Проверить есть ли buy intent для ресурса.
   * @param {string} resource
   * @returns {boolean}
   */
  hasBuyIntent: function (resource) {
    return this.getBuyIntents().some(i => i.resource === resource);
  },

  /**
   * Проверить есть ли sell intent для ресурса.
   * @param {string} resource
   * @returns {boolean}
   */
  hasSellIntent: function (resource) {
    return this.getSellIntents().some(i => i.resource === resource);
  },

  /**
   * Метаданные последнего анализа.
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.marketMeta) || {};
  },
};

module.exports = marketManager;
