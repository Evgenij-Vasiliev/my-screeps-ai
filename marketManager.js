/**
 * ===================================================
 * MARKETMANAGER.JS — Market Intelligence Layer
 * ===================================================
 * VERSION: 1.1 — BUY POLICY WHITELIST
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Добавлен BUYABLE_RESOURCES whitelist (Set для O(1) lookup)
 * - Buy intent создаётся ТОЛЬКО для ресурсов из whitelist
 * - Бусты и lab products больше не попадают в buy intents
 * - SELL_MINERALS не изменён
 *
 * НАЗНАЧЕНИЕ:
 * - Анализирует surplus/deficit по EconomyManager
 * - Определяет что покупать (только raw minerals + energy)
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

const MARKET_VERSION = 1.1;

/**
 * WHITELIST — только эти ресурсы разрешены к ПОКУПКЕ.
 *
 * Используем Set для O(1) lookup.
 *
 * РАЗРЕШЕНО: raw minerals + energy economy.
 * ЗАПРЕЩЕНО: tier1/tier2/tier3 бусты — их производят лабы.
 *
 * ПОЧЕМУ:
 * Market должен закрывать сырьевые bottlenecks,
 * а НЕ заменять lab production pipeline.
 */
const BUYABLE_RESOURCES = new Set([
  RESOURCE_ENERGY, // энергия
  RESOURCE_BATTERY, // батарейки

  RESOURCE_UTRIUM, // U  — сырьё
  RESOURCE_LEMERGIUM, // L  — сырьё
  RESOURCE_KEANIUM, // K  — сырьё
  RESOURCE_ZYNTHIUM, // Z  — сырьё
  RESOURCE_OXYGEN, // O  — сырьё
  RESOURCE_HYDROGEN, // H  — сырьё
  RESOURCE_CATALYST, // X  — сырьё
  RESOURCE_GHODIUM, // G  — сырьё (нужен для nukes/boosts)
]);

/**
 * Только эти ресурсы разрешены к ПРОДАЖЕ в v1.
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
    const blockedBoosts = []; // для отладки — что заблокировано

    const economy = Memory.empire && Memory.empire.economy;
    if (!economy) return;

    // ── BUY ANALYSIS ──────────────────────────────────────────────────────
    // Покупаем ТОЛЬКО critical resources из BUYABLE_RESOURCES whitelist.
    // Бусты и lab products — НЕ покупаем, их производят лабы.
    for (const resource in economy) {
      if (!economyManager.isCritical(resource)) continue;

      const deficit = economyManager.getDeficit(resource);
      if (deficit <= 0) continue;

      // Не создаём дубликаты
      if (buyIntents.find(i => i.resource === resource)) continue;

      // ── WHITELIST CHECK (v1.1) ────────────────────────────────────────
      // Если ресурс не в whitelist — блокируем, лабы сами произведут.
      if (!BUYABLE_RESOURCES.has(resource)) {
        blockedBoosts.push(resource);
        continue;
      }

      buyIntents.push({
        resource,
        amount: deficit,
        priority: PRIORITY.HIGH,
        reason: "critical",
      });
    }

    // ── SELL ANALYSIS ─────────────────────────────────────────────────────
    // Продаём только разрешённые ресурсы с surplus.
    // SELL логика не изменена в v1.1.
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
      blockedBoostCount: blockedBoosts.length, // v1.1 — сколько бустов заблокировано
      analyzeDuration: Math.round(duration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков (каждый запуск)
    console.log(
      `[MarketManager] 📊 Анализ: buy=${buyIntents.length}` +
        ` sell=${sellIntents.length}` +
        ` blocked=${blockedBoosts.length}` +
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

    // v1.1 — логируем заблокированные бусты раз в 500 тиков
    if (blockedBoosts.length > 0 && Game.time % 500 === 0) {
      console.log(
        `[MarketManager] 🚫 Заблокированы (производятся лабами): ` +
          blockedBoosts.join(", "),
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
