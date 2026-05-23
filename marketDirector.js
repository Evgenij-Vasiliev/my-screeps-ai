/**
 * ===================================================
 * MARKETDIRECTOR.JS — Empire Economic Intelligence Layer
 * ===================================================
 * VERSION: 2.1
 *
 * ИЗМЕНЕНИЯ v2.1:
 * - Добавлен BOOST_CHAIN — все tier1/tier2/tier3 бусты
 *   получают mode='produce' а не 'buy'
 * - Исправлены пороги продажи O и X — не продаём
 *   стратегические минералы
 * - NOT_FOR_SALE — минералы которые не продаём никогда
 *
 * DIRECTIVE MODES:
 * produce  — производить внутри империи (лабы)
 * buy      — покупать на рынке (сырьё)
 * sell     — продавать surplus
 * stockpile — стратегический резерв
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");
const labDirector = require("./labDirector");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 100;
const DIRECTOR_VERSION = 2.1;

const ENERGY_SELL_THRESHOLD = 500000;
const DEFAULT_SELL_THRESHOLD = 100000;

/**
 * Сырьевые минералы — если critical → buy.
 */
const RAW_MINERALS = new Set([
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
 * Стратегические резервы — stockpile даже при surplus.
 */
const STRATEGIC_RESERVES = new Set([RESOURCE_BATTERY, RESOURCE_GHODIUM]);

/**
 * Минералы которые НИКОГДА не продаём.
 * O и X — закупаем сами, X нужен для tier3 бустов.
 * Z — накопился исторически, не продаём автоматически.
 */
const NOT_FOR_SALE = new Set([
  RESOURCE_OXYGEN,
  RESOURCE_CATALYST,
  RESOURCE_ZYNTHIUM,
  RESOURCE_GHODIUM,
]);

/**
 * Все boost chain продукты tier1/tier2/tier3.
 * Производятся лабами — НЕ покупаем на рынке.
 * mode = 'produce' если critical, иначе 'stockpile'.
 */
const BOOST_CHAIN = new Set([
  // Tier 1
  RESOURCE_UTRIUM_HYDRIDE, // UH
  RESOURCE_UTRIUM_OXIDE, // UO
  RESOURCE_KEANIUM_HYDRIDE, // KH
  RESOURCE_KEANIUM_OXIDE, // KO
  RESOURCE_LEMERGIUM_HYDRIDE, // LH
  RESOURCE_LEMERGIUM_OXIDE, // LO
  RESOURCE_ZYNTHIUM_HYDRIDE, // ZH
  RESOURCE_ZYNTHIUM_OXIDE, // ZO
  RESOURCE_GHODIUM_HYDRIDE, // GH
  RESOURCE_GHODIUM_OXIDE, // GO
  RESOURCE_HYDROXIDE, // OH
  RESOURCE_ZYNTHIUM_KEANITE, // ZK
  // Tier 2
  RESOURCE_UTRIUM_ACID, // UH2O
  RESOURCE_UTRIUM_ALKALIDE, // UHO2
  RESOURCE_KEANIUM_ACID, // KH2O
  RESOURCE_KEANIUM_ALKALIDE, // KHO2
  RESOURCE_LEMERGIUM_ACID, // LH2O
  RESOURCE_LEMERGIUM_ALKALIDE, // LHO2
  RESOURCE_ZYNTHIUM_ACID, // ZH2O
  RESOURCE_ZYNTHIUM_ALKALIDE, // ZHO2
  RESOURCE_GHODIUM_ACID, // GH2O
  RESOURCE_GHODIUM_ALKALIDE, // GHO2
  // Tier 3
  RESOURCE_CATALYZED_UTRIUM_ACID, // XUH2O
  RESOURCE_CATALYZED_UTRIUM_ALKALIDE, // XUHO2
  RESOURCE_CATALYZED_KEANIUM_ACID, // XKH2O
  RESOURCE_CATALYZED_KEANIUM_ALKALIDE, // XKHO2
  RESOURCE_CATALYZED_LEMERGIUM_ACID, // XLH2O
  RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, // XLHO2
  RESOURCE_CATALYZED_ZYNTHIUM_ACID, // XZH2O
  RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE, // XZHO2
  RESOURCE_CATALYZED_GHODIUM_ACID, // XGH2O
  RESOURCE_CATALYZED_GHODIUM_ALKALIDE, // XGHO2
]);

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const marketDirector = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== 0) return;
    this.analyze();
  },

  analyze: function () {
    const startCpu = Game.cpu.getUsed();

    const directives = {};
    let produceCount = 0;
    let buyCount = 0;
    let sellCount = 0;
    let stockpileCount = 0;

    // Продукты лаб — активно производятся прямо сейчас
    const labProducts = this._getLabProducts();

    const economy = Memory.empire && Memory.empire.economy;
    if (!economy) return;

    for (const resource in economy) {
      const state = economyManager.getState(resource);
      if (!state) continue;

      const surplus = economyManager.getSurplus(resource);
      const deficit = economyManager.getDeficit(resource);
      const critical = economyManager.isCritical(resource);

      let mode = null;
      let priority = "normal";
      let reason = "";

      // ── ENERGY ──────────────────────────────────────────────────────────
      if (resource === RESOURCE_ENERGY) {
        if (surplus > ENERGY_SELL_THRESHOLD) {
          mode = "sell";
          priority = "high";
          reason = "massive_surplus";
        } else if (critical) {
          mode = "buy";
          priority = "high";
          reason = "critical";
        } else {
          mode = "stockpile";
          priority = "normal";
          reason = "energy_reserve";
        }

        // ── СТРАТЕГИЧЕСКИЕ РЕЗЕРВЫ ───────────────────────────────────────
      } else if (STRATEGIC_RESERVES.has(resource)) {
        if (critical) {
          mode = "buy";
          priority = "high";
          reason = "critical_strategic";
        } else {
          mode = "stockpile";
          priority = "normal";
          reason = "strategic_reserve";
        }

        // ── BOOST CHAIN — всегда produce, никогда buy ────────────────────
      } else if (BOOST_CHAIN.has(resource)) {
        if (critical) {
          // Производим в лабах — не покупаем
          mode = "produce";
          priority = "high";
          reason = "critical_boost";
        } else if (
          surplus > DEFAULT_SELL_THRESHOLD &&
          !NOT_FOR_SALE.has(resource)
        ) {
          mode = "sell";
          priority = "normal";
          reason = "boost_surplus";
        } else {
          mode = "stockpile";
          priority = "normal";
          reason = "boost_reserve";
        }

        // ── RAW MINERALS ─────────────────────────────────────────────────
      } else if (RAW_MINERALS.has(resource)) {
        if (NOT_FOR_SALE.has(resource)) {
          // O, X, Z, G — не продаём никогда
          if (critical) {
            mode = "buy";
            priority = "high";
            reason = "critical_raw";
          } else {
            mode = "stockpile";
            priority = "normal";
            reason = "protected_raw";
          }
        } else {
          // H, K, L, U — продаём если surplus
          if (critical) {
            mode = "buy";
            priority = "high";
            reason = "critical_raw";
          } else if (surplus > DEFAULT_SELL_THRESHOLD) {
            mode = "sell";
            priority = "normal";
            reason = "raw_surplus";
          } else {
            mode = "stockpile";
            priority = "normal";
            reason = "raw_reserve";
          }
        }

        // ── ОСТАЛЬНЫЕ РЕСУРСЫ ────────────────────────────────────────────
      } else {
        if (surplus > DEFAULT_SELL_THRESHOLD && !NOT_FOR_SALE.has(resource)) {
          mode = "sell";
          priority = "normal";
          reason = "surplus";
        } else {
          mode = "stockpile";
          priority = "low";
          reason = "default";
        }
      }

      if (!mode) continue;

      directives[resource] = {
        mode,
        priority,
        reason,
        total: state.total,
        surplus,
        deficit,
        critical,
        generatedAt: Game.time,
      };

      if (mode === "produce") produceCount++;
      else if (mode === "buy") buyCount++;
      else if (mode === "sell") sellCount++;
      else stockpileCount++;
    }

    // ── ПУБЛИКАЦИЯ ────────────────────────────────────────────────────────
    const duration = Game.cpu.getUsed() - startCpu;

    Memory.empire.marketDirectives = directives;

    Memory.empire.marketDirectivesMeta = {
      version: DIRECTOR_VERSION,
      generatedAt: Game.time,
      produceCount,
      buyCount,
      sellCount,
      stockpileCount,
      labProductCount: labProducts.size,
      credits: Math.round(Game.market.credits),
      analyzeDuration: Math.round(duration * 1000) / 1000,
    };

    // Throttled logging
    console.log(
      `[MarketDirector] 🎯 Директивы:` +
        ` produce=${produceCount} buy=${buyCount}` +
        ` sell=${sellCount} stockpile=${stockpileCount}` +
        ` | CPU: ${duration.toFixed(3)}ms`,
    );

    // Предупреждения — critical boost без лаб
    for (const [resource, d] of Object.entries(directives)) {
      if (d.critical && d.mode === "produce" && !labProducts.has(resource)) {
        if (Game.time % 500 === 0) {
          console.log(
            `[MarketDirector] ⚠️ ${resource}: critical boost` +
              ` но не производится в лабах — настройте lab config`,
          );
        }
      }
    }
  },

  /**
   * Собирает все продукты лаб по всем комнатам.
   * @returns {Set<string>}
   */
  _getLabProducts: function () {
    const products = new Set();
    const allReactions = labDirector.getAllReactions();

    for (const roomName in allReactions) {
      const data = allReactions[roomName];
      if (!data || !data.reactions) continue;
      for (const r of data.reactions) {
        if (r.product) products.add(r.product);
      }
    }

    return products;
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  getDirective: function (resource) {
    const d = Memory.empire && Memory.empire.marketDirectives;
    return d ? d[resource] || null : null;
  },

  getAllDirectives: function () {
    return (Memory.empire && Memory.empire.marketDirectives) || {};
  },

  shouldBuy: function (resource) {
    const d = this.getDirective(resource);
    return d ? d.mode === "buy" : false;
  },

  shouldSell: function (resource) {
    const d = this.getDirective(resource);
    return d ? d.mode === "sell" : false;
  },

  shouldProduce: function (resource) {
    const d = this.getDirective(resource);
    return d ? d.mode === "produce" : false;
  },

  getMeta: function () {
    return (Memory.empire && Memory.empire.marketDirectivesMeta) || {};
  },
};

module.exports = marketDirector;
