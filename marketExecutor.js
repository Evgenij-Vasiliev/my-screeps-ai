/**
 * ===================================================
 * MARKETEXECUTOR.JS — Safe Trading Execution Layer
 * ===================================================
 * VERSION: 1.3
 *
 * ИЗМЕНЕНИЯ v1.3:
 * - ИСПРАВЛЕН главный баг: execute() теперь продаёт
 *   ВСЕ готовые ресурсы за один запуск (один deal на терминал).
 *   Раньше: один deal на весь запуск → продавался только K.
 *   Теперь: один deal на терминал → продаются все готовые ресурсы.
 *
 * - _executeSell() принимает Set usedRooms чтобы не использовать
 *   один терминал дважды за один запуск.
 *
 * ИЗМЕНЕНИЯ v1.2:
 * - Перебор всех sell intents вместо первого.
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Execution lock, partial sell, credits safety.
 * ===================================================
 */

const marketManager = require("./marketManager");
const economyManager = require("./economyManager");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 100;
const MIN_CREDITS = 100000;
const MIN_SELL_AMOUNT = 10000;
const TERMINAL_ENERGY_MIN = 20000;
const MAX_HISTORY = 20;

const EXECUTOR_VERSION = 1.3;

const MAX_BUY_PRICE = {
  [RESOURCE_ENERGY]: 0.25,
  [RESOURCE_BATTERY]: 8.0,
  [RESOURCE_OXYGEN]: 100.0,
  [RESOURCE_HYDROGEN]: 150.0,
  [RESOURCE_UTRIUM]: 100.0,
  [RESOURCE_LEMERGIUM]: 100.0,
  [RESOURCE_KEANIUM]: 100.0,
  [RESOURCE_ZYNTHIUM]: 50.0,
  [RESOURCE_CATALYST]: 350.0,
  [RESOURCE_GHODIUM]: 200.0,
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const marketExecutor = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== 0) return;

    const meta = Memory.empire.marketMeta || {};
    if (meta.lastExecutedAt === Game.time) return;

    this.execute();
  },

  execute: function () {
    const startCpu = Game.cpu.getUsed();

    if (Memory.tradeEnabled === false) {
      this._saveMeta(0, 0, 0, 0, 0, 0, "disabled");
      return;
    }

    let executedDeals = 0;
    let skippedDeals = 0;
    let failedDeals = 0;
    let creditsSpent = 0;
    let creditsEarned = 0;

    // ── SELL: один deal на терминал ───────────────────────────────────────
    // Перебираем все sell intents.
    // Каждый терминал используем максимум один раз за запуск.
    const usedRooms = new Set();
    const sellIntents = marketManager.getSellIntents();

    for (const intent of sellIntents) {
      if (economyManager.isCritical(intent.resource)) continue;

      const r = this._executeSellIntent(intent, usedRooms);
      executedDeals += r.executed;
      skippedDeals += r.skipped;
      failedDeals += r.failed;
      creditsEarned += r.creditsEarned;

      // Если нашли и использовали терминал — он уже в usedRooms
      // Продолжаем для следующего ресурса
    }

    // ── BUY: один deal если кредиты позволяют ────────────────────────────
    const r = this._executeBuy(usedRooms);
    executedDeals += r.executed;
    skippedDeals += r.skipped;
    failedDeals += r.failed;
    creditsSpent += r.creditsSpent;

    const duration = Game.cpu.getUsed() - startCpu;
    this._saveMeta(
      executedDeals,
      skippedDeals,
      failedDeals,
      creditsSpent,
      creditsEarned,
      duration,
      "ok",
    );

    if (executedDeals > 0 || failedDeals > 0 || Game.time % 500 === 0) {
      console.log(
        `[MarketExecutor] 💹 executed=${executedDeals}` +
          ` skipped=${skippedDeals} failed=${failedDeals}` +
          ` earned=${creditsEarned.toFixed(0)} spent=${creditsSpent.toFixed(
            0,
          )}` +
          ` | CPU: ${duration.toFixed(3)}ms`,
      );
    }
  },

  /**
   * Продаёт один ресурс из лучшего доступного терминала.
   * Терминал добавляется в usedRooms после сделки.
   *
   * @param {Object} intent    — sell intent из marketManager
   * @param {Set}    usedRooms — уже использованные терминалы за этот запуск
   */
  _executeSellIntent: function (intent, usedRooms) {
    const result = { executed: 0, skipped: 0, failed: 0, creditsEarned: 0 };

    const resource = intent.resource;

    // Ищем лучший терминал с этим ресурсом (не использованный)
    const room = this._findSellRoom(resource, usedRooms);
    if (!room) {
      result.skipped++;
      return result;
    }

    const terminal = room.terminal;
    const inTerminal = terminal.store[resource] || 0;

    if (inTerminal < MIN_SELL_AMOUNT) {
      result.skipped++;
      return result;
    }

    // Лучший buy ордер
    const orders = Game.market
      .getAllOrders({
        type: ORDER_BUY,
        resourceType: resource,
      })
      .filter(o => o.remainingAmount >= 100)
      .sort((a, b) => b.price - a.price);

    if (orders.length === 0) {
      result.skipped++;
      return result;
    }

    const order = orders[0];
    const dealAmount = Math.min(
      inTerminal,
      order.remainingAmount,
      intent.amount,
    );

    // Transaction cost
    const txCost = Game.market.calcTransactionCost(
      dealAmount,
      room.name,
      order.roomName,
    );
    const termEnergy = terminal.store[RESOURCE_ENERGY] || 0;

    if (txCost > termEnergy - TERMINAL_ENERGY_MIN) {
      console.log(
        `[MarketExecutor] SKIP_LOW_ENERGY ${room.name}:` +
          ` нужно ${txCost} energy для продажи ${resource}`,
      );
      result.skipped++;
      return result;
    }

    const res = Game.market.deal(order.id, dealAmount, room.name);

    if (res === OK) {
      const earned = dealAmount * order.price;
      result.executed++;
      result.creditsEarned += earned;

      intent.amount = Math.max(0, intent.amount - dealAmount);

      // Помечаем терминал как использованный
      usedRooms.add(room.name);

      console.log(
        `[MarketExecutor] ✅ SELL ${dealAmount} ${resource}` +
          ` @ ${order.price} → ${order.roomName}` +
          ` (+${earned.toFixed(0)} credits)`,
      );

      this._addHistory({
        tick: Game.time,
        type: "sell",
        resource,
        amount: dealAmount,
        price: order.price,
        roomName: room.name,
        orderId: order.id,
      });
    } else {
      console.log(`[MarketExecutor] ❌ SELL ${resource} failed: ${res}`);
      result.failed++;
    }

    return result;
  },

  _executeBuy: function (usedRooms) {
    const result = { executed: 0, skipped: 0, failed: 0, creditsSpent: 0 };

    if (Game.market.credits < MIN_CREDITS) {
      result.skipped++;
      return result;
    }

    const buyIntents = marketManager.getBuyIntents();
    if (buyIntents.length === 0) return result;

    const intent = buyIntents[0];
    const resource = intent.resource;

    // Ищем свободный терминал (не использованный при продаже)
    const room = this._findBuyRoom(usedRooms);
    if (!room) {
      result.skipped++;
      return result;
    }

    const terminal = room.terminal;
    const maxPrice = MAX_BUY_PRICE[resource] || 999;

    const orders = Game.market
      .getAllOrders({
        type: ORDER_SELL,
        resourceType: resource,
      })
      .filter(o => o.remainingAmount >= 100 && o.price <= maxPrice)
      .sort((a, b) => a.price - b.price);

    if (orders.length === 0) {
      result.skipped++;
      return result;
    }

    const order = orders[0];
    const dealAmount = Math.min(intent.amount, order.remainingAmount, 10000);

    const txCost = Game.market.calcTransactionCost(
      dealAmount,
      room.name,
      order.roomName,
    );
    const termEnergy = terminal.store[RESOURCE_ENERGY] || 0;

    if (txCost > termEnergy - TERMINAL_ENERGY_MIN) {
      result.skipped++;
      return result;
    }

    const dealCost = dealAmount * order.price;
    if (Game.market.credits - dealCost < MIN_CREDITS) {
      result.skipped++;
      return result;
    }

    const res = Game.market.deal(order.id, dealAmount, room.name);

    if (res === OK) {
      result.executed++;
      result.creditsSpent += dealCost;
      intent.amount = Math.max(0, intent.amount - dealAmount);

      console.log(
        `[MarketExecutor] ✅ BUY ${dealAmount} ${resource}` +
          ` @ ${order.price} from ${order.roomName}` +
          ` (-${dealCost.toFixed(0)} credits)`,
      );

      this._addHistory({
        tick: Game.time,
        type: "buy",
        resource,
        amount: dealAmount,
        price: order.price,
        roomName: room.name,
        orderId: order.id,
      });
    } else {
      console.log(`[MarketExecutor] ❌ BUY ${resource} failed: ${res}`);
      result.failed++;
    }

    return result;
  },

  /**
   * Ищет терминал с наибольшим запасом ресурса.
   * Пропускает уже использованные терминалы.
   *
   * @param {string} resource
   * @param {Set}    usedRooms
   */
  _findSellRoom: function (resource, usedRooms) {
    let best = null;
    let bestAmount = 0;

    for (const roomName in Game.rooms) {
      if (usedRooms && usedRooms.has(roomName)) continue;

      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      if (room.terminal.cooldown > 0) continue;

      const inTerminal = room.terminal.store[resource] || 0;
      if (inTerminal > bestAmount) {
        bestAmount = inTerminal;
        best = room;
      }
    }

    return best;
  },

  /**
   * Ищет терминал с достаточной энергией для покупки.
   * Пропускает уже использованные терминалы.
   *
   * @param {Set} usedRooms
   */
  _findBuyRoom: function (usedRooms) {
    for (const roomName in Game.rooms) {
      if (usedRooms && usedRooms.has(roomName)) continue;

      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      if (room.terminal.cooldown > 0) continue;

      const termEnergy = room.terminal.store[RESOURCE_ENERGY] || 0;
      if (termEnergy >= TERMINAL_ENERGY_MIN * 2) return room;
    }
    return null;
  },

  _addHistory: function (entry) {
    if (!Memory.empire.marketHistory) Memory.empire.marketHistory = [];
    Memory.empire.marketHistory.unshift(entry);
    if (Memory.empire.marketHistory.length > MAX_HISTORY) {
      Memory.empire.marketHistory.length = MAX_HISTORY;
    }
  },

  _saveMeta: function (
    executed,
    skipped,
    failed,
    spent,
    earned,
    duration,
    status,
  ) {
    Memory.empire.marketMeta = {
      version: EXECUTOR_VERSION,
      lastExecutedAt: Game.time,
      status,
      executedDeals: executed,
      skippedDeals: skipped,
      failedDeals: failed,
      creditsSpent: Math.round(spent),
      creditsEarned: Math.round(earned),
      executionDuration: Math.round(duration * 1000) / 1000,
    };
  },

  getLastDeals: function () {
    return Memory.empire.marketHistory || [];
  },
  getMeta: function () {
    return Memory.empire.marketMeta || {};
  },
};

module.exports = marketExecutor;
