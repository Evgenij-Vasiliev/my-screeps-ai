/**
 * ===================================================
 * MARKETMANAGER.JS — Market Intelligence Layer
 * ===================================================
 * VERSION: 1.2 — EXPANDED SELL LIST
 *
 * ИЗМЕНЕНИЯ v1.2:
 * - Расширен SELLABLE_RESOURCES:
 *   + K  (Keanium)          — сырьё в большом избытке
 *   + ZK (Zynthium Keanite) — T1 compound
 *   + KO (Keanium Oxide)    — T1 compound
 *   + KH2O                  — T2 compound
 *   + UHO2                  — T2 compound
 *   + LHO2                  — T2 compound
 *   + ZHO2                  — T2 compound
 * - MIN_SELL_SURPLUS снижен до 10,000 для compounds
 *   (у T2 surplus меньше чем у raw minerals)
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Добавлен BUYABLE_RESOURCES whitelist
 * - Buy intent только для raw minerals + energy
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 100;
const MARKET_VERSION = 1.2;

/**
 * WHITELIST — только эти ресурсы разрешены к ПОКУПКЕ.
 * Только raw minerals + energy.
 */
const BUYABLE_RESOURCES = new Set([
  // RESOURCE_ENERGY,
  RESOURCE_BATTERY,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_OXYGEN,
  RESOURCE_HYDROGEN,
  RESOURCE_CATALYST,
  RESOURCE_GHODIUM,
]);

/**
 * WHITELIST — только эти ресурсы разрешены к ПРОДАЖЕ.
 *
 * v1.2: добавлены compounds которые производим в избытке.
 * НЕ продаём: OH, X, O, Z (сами закупаем).
 */
const SELLABLE_RESOURCES = new Set([
  RESOURCE_ENERGY,
  // Energy economy
  RESOURCE_BATTERY,

  // Raw minerals в избытке
  RESOURCE_KEANIUM, // K  — 289,130 в империи

  // T1 compounds
  RESOURCE_ZYNTHIUM_KEANITE, // ZK  — 83,705
  RESOURCE_KEANIUM_OXIDE, // KO  — 89,070

  // T2 compounds
  RESOURCE_KEANIUM_ACID, // KH2O — 34,240
  RESOURCE_UTRIUM_ALKALIDE, // UHO2 — 31,050
  RESOURCE_LEMERGIUM_ALKALIDE, // LHO2 — 144,400
  RESOURCE_ZYNTHIUM_ALKALIDE, // ZHO2 — 20,460
]);

/**
 * Минимальный surplus для RAW minerals и energy.
 */
const MIN_SELL_SURPLUS = 50000;

/**
 * Минимальный surplus для compounds (T1/T2).
 * Меньше порог — compounds производятся в меньших количествах.
 */
const MIN_SELL_SURPLUS_COMPOUND = 10000;

/**
 * Ресурсы которые считаются compounds (не raw).
 * Для них используем пониженный порог продажи.
 */
const COMPOUND_RESOURCES = new Set([
  RESOURCE_ZYNTHIUM_KEANITE,
  RESOURCE_KEANIUM_OXIDE,
  RESOURCE_KEANIUM_ACID,
  RESOURCE_UTRIUM_ALKALIDE,
  RESOURCE_LEMERGIUM_ALKALIDE,
  RESOURCE_ZYNTHIUM_ALKALIDE,
]);

const PRIORITY = {
  HIGH: "high",
  NORMAL: "normal",
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const marketManager = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== 0) return;
    this.analyze();
  },

  analyze: function () {
    const startCpu = Game.cpu.getUsed();

    const buyIntents = [];
    const sellIntents = [];
    const blockedBoosts = [];

    const economy = Memory.empire && Memory.empire.economy;
    if (!economy) return;

    // ── BUY ANALYSIS ──────────────────────────────────────────────────────
    for (const resource in economy) {
      if (!economyManager.isCritical(resource)) continue;

      const deficit = economyManager.getDeficit(resource);
      if (deficit <= 0) continue;

      if (buyIntents.find(i => i.resource === resource)) continue;

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
    for (const resource of SELLABLE_RESOURCES) {
      if (economyManager.isCritical(resource)) continue;

      const surplus = economyManager.getSurplus(resource);

      // Используем пониженный порог для compounds
      const minSurplus = COMPOUND_RESOURCES.has(resource)
        ? MIN_SELL_SURPLUS_COMPOUND
        : MIN_SELL_SURPLUS;

      if (surplus < minSurplus) continue;

      if (sellIntents.find(i => i.resource === resource)) continue;

      const priority =
        surplus > minSurplus * 3 ? PRIORITY.HIGH : PRIORITY.NORMAL;

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
      blockedBoostCount: blockedBoosts.length,
      analyzeDuration: Math.round(duration * 1000) / 1000,
    };

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

    if (blockedBoosts.length > 0 && Game.time % 500 === 0) {
      console.log(
        `[MarketManager] 🚫 Заблокированы (лабы): ` + blockedBoosts.join(", "),
      );
    }
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  getBuyIntents: function () {
    const market = Memory.empire && Memory.empire.market;
    return market ? market.buy : [];
  },

  getSellIntents: function () {
    const market = Memory.empire && Memory.empire.market;
    return market ? market.sell : [];
  },

  hasBuyIntent: function (resource) {
    return this.getBuyIntents().some(i => i.resource === resource);
  },

  hasSellIntent: function (resource) {
    return this.getSellIntents().some(i => i.resource === resource);
  },

  getMeta: function () {
    return (Memory.empire && Memory.empire.marketMeta) || {};
  },
};

module.exports = marketManager;
