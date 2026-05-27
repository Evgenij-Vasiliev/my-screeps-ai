/**
 * ===================================================
 * MARKETDIRECTOR.JS — Empire Economic Intelligence Layer
 * ===================================================
 * VERSION: 2.2
 *
 * ИЗМЕНЕНИЯ v2.2:
 * - Добавлен BOOST_SELL_THRESHOLD = 10,000 для compounds.
 *   DEFAULT_SELL_THRESHOLD (100,000) был слишком высок —
 *   ZK, KO, KH2O, UHO2, ZHO2 никогда не попадали в sell.
 *
 * ИЗМЕНЕНИЯ v2.1:
 * - BOOST_CHAIN → mode='produce' если critical
 * - NOT_FOR_SALE — O, X, Z, G не продаём
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");
const labDirector = require("./labDirector");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 100;
const DIRECTOR_VERSION = 2.2;

const ENERGY_SELL_THRESHOLD = 500000;
const DEFAULT_SELL_THRESHOLD = 100000;

/**
 * Порог продажи для compounds (T1/T2).
 * Снижен до 10,000 — compounds производятся в меньших объёмах
 * чем raw minerals.
 */
const BOOST_SELL_THRESHOLD = 10000;

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

const STRATEGIC_RESERVES = new Set([RESOURCE_BATTERY, RESOURCE_GHODIUM]);

/**
 * Минералы которые НИКОГДА не продаём.
 */
const NOT_FOR_SALE = new Set([
  RESOURCE_OXYGEN,
  RESOURCE_CATALYST,
  RESOURCE_ZYNTHIUM,
  RESOURCE_GHODIUM,
]);

/**
 * Все boost chain продукты tier1/tier2/tier3.
 * Производятся лабами.
 */
const BOOST_CHAIN = new Set([
  // Tier 1
  RESOURCE_UTRIUM_HYDRIDE,
  RESOURCE_UTRIUM_OXIDE,
  RESOURCE_KEANIUM_HYDRIDE,
  RESOURCE_KEANIUM_OXIDE,
  RESOURCE_LEMERGIUM_HYDRIDE,
  RESOURCE_LEMERGIUM_OXIDE,
  RESOURCE_ZYNTHIUM_HYDRIDE,
  RESOURCE_ZYNTHIUM_OXIDE,
  RESOURCE_GHODIUM_HYDRIDE,
  RESOURCE_GHODIUM_OXIDE,
  RESOURCE_HYDROXIDE,
  RESOURCE_ZYNTHIUM_KEANITE,
  // Tier 2
  RESOURCE_UTRIUM_ACID,
  RESOURCE_UTRIUM_ALKALIDE,
  RESOURCE_KEANIUM_ACID,
  RESOURCE_KEANIUM_ALKALIDE,
  RESOURCE_LEMERGIUM_ACID,
  RESOURCE_LEMERGIUM_ALKALIDE,
  RESOURCE_ZYNTHIUM_ACID,
  RESOURCE_ZYNTHIUM_ALKALIDE,
  RESOURCE_GHODIUM_ACID,
  RESOURCE_GHODIUM_ALKALIDE,
  // Tier 3
  RESOURCE_CATALYZED_UTRIUM_ACID,
  RESOURCE_CATALYZED_UTRIUM_ALKALIDE,
  RESOURCE_CATALYZED_KEANIUM_ACID,
  RESOURCE_CATALYZED_KEANIUM_ALKALIDE,
  RESOURCE_CATALYZED_LEMERGIUM_ACID,
  RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE,
  RESOURCE_CATALYZED_ZYNTHIUM_ACID,
  RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE,
  RESOURCE_CATALYZED_GHODIUM_ACID,
  RESOURCE_CATALYZED_GHODIUM_ALKALIDE,
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
          reason = "energy_reserve";
        }

        // ── СТРАТЕГИЧЕСКИЕ РЕЗЕРВЫ ─────────────────────────────────────────
      } else if (STRATEGIC_RESERVES.has(resource)) {
        if (critical) {
          mode = "buy";
          priority = "high";
          reason = "critical_strategic";
        } else {
          mode = "stockpile";
          reason = "strategic_reserve";
        }

        // ── BOOST CHAIN ────────────────────────────────────────────────────
      } else if (BOOST_CHAIN.has(resource)) {
        if (critical) {
          mode = "produce";
          priority = "high";
          reason = "critical_boost";
        } else if (
          surplus > BOOST_SELL_THRESHOLD &&
          !NOT_FOR_SALE.has(resource)
        ) {
          // v2.2: используем BOOST_SELL_THRESHOLD (10K) вместо DEFAULT (100K)
          mode = "sell";
          reason = "boost_surplus";
        } else {
          mode = "stockpile";
          reason = "boost_reserve";
        }

        // ── RAW MINERALS ────────────────────────────────────────────────────
      } else if (RAW_MINERALS.has(resource)) {
        if (NOT_FOR_SALE.has(resource)) {
          if (critical) {
            mode = "buy";
            priority = "high";
            reason = "critical_raw";
          } else {
            mode = "stockpile";
            reason = "protected_raw";
          }
        } else {
          if (critical) {
            mode = "buy";
            priority = "high";
            reason = "critical_raw";
          } else if (surplus > DEFAULT_SELL_THRESHOLD) {
            mode = "sell";
            reason = "raw_surplus";
          } else {
            mode = "stockpile";
            reason = "raw_reserve";
          }
        }

        // ── ОСТАЛЬНЫЕ РЕСУРСЫ ───────────────────────────────────────────────
      } else {
        if (surplus > DEFAULT_SELL_THRESHOLD && !NOT_FOR_SALE.has(resource)) {
          mode = "sell";
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

    console.log(
      `[MarketDirector] 🎯 Директивы:` +
        ` produce=${produceCount} buy=${buyCount}` +
        ` sell=${sellCount} stockpile=${stockpileCount}` +
        ` | CPU: ${duration.toFixed(3)}ms`,
    );

    for (const [resource, d] of Object.entries(directives)) {
      if (d.critical && d.mode === "produce" && !labProducts.has(resource)) {
        if (Game.time % 500 === 0) {
          console.log(
            `[MarketDirector] ⚠️ ${resource}: critical` +
              ` но не производится в лабах — настройте lab config`,
          );
        }
      }
    }
  },

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
