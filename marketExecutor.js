/**
 * ===================================================
 * MARKETEXECUTOR.JS — Safe Trading Execution Layer
 * ===================================================
 * VERSION: 1.1 — VALIDATION & SAFETY
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Добавлен execution lock (lastExecutedAt) — защита от дублей
 * - Добавлен partial sell handling — remaining amount обновляется
 * - Intent completion — amount уменьшается после сделки
 * - History структура исправлена согласно ТЗ
 * - Credits safety подтверждён runtime validation
 * - Transaction cost validation усилен
 *
 * OWNERSHIP:
 * MarketExecutor  → Game.market.deal()
 * terminalManager → terminal.send()
 * ===================================================
 */

const marketManager = require("./marketManager");
const economyManager = require("./economyManager");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

const UPDATE_INTERVAL = 100;
const MAX_DEALS_PER_RUN = 1;
const MIN_CREDITS = 100000;
const MIN_SELL_AMOUNT = 10000;
const TERMINAL_ENERGY_MIN = 20000;
const MAX_HISTORY = 20;

const EXECUTOR_VERSION = 1.1;

/**
 * Максимальная цена покупки.
 * Защита от market spikes.
 */
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

    // ── EXECUTION LOCK ────────────────────────────────────────────────────
    // Защита от дублей — один запуск за UPDATE_INTERVAL тиков.
    // Если уже выполняли в этом цикле — пропускаем.
    const meta = Memory.empire.marketMeta || {};
    if (meta.lastExecutedAt === Game.time) {
      console.log(
        `[MarketExecutor] ⚠️ Execution lock — уже выполнен в тик ${Game.time}`,
      );
      return;
    }

    this.execute();
  },

  execute: function () {
    const startCpu = Game.cpu.getUsed();

    // Торговля отключена
    if (Memory.tradeEnabled === false) {
      this._saveMeta(0, 0, 0, 0, 0, 0, "disabled");
      return;
    }

    let executedDeals = 0;
    let skippedDeals = 0;
    let failedDeals = 0;
    let creditsSpent = 0;
    let creditsEarned = 0;

    // ── SELL ──────────────────────────────────────────────────────────────
    if (executedDeals < MAX_DEALS_PER_RUN) {
      const r = this._executeSell();
      executedDeals += r.executed;
      skippedDeals += r.skipped;
      failedDeals += r.failed;
      creditsEarned += r.creditsEarned;
    }

    // ── BUY ───────────────────────────────────────────────────────────────
    if (executedDeals < MAX_DEALS_PER_RUN) {
      const r = this._executeBuy();
      executedDeals += r.executed;
      skippedDeals += r.skipped;
      failedDeals += r.failed;
      creditsSpent += r.creditsSpent;
    }

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

    // Throttled logging
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

  _executeSell: function () {
    const result = { executed: 0, skipped: 0, failed: 0, creditsEarned: 0 };

    const sellIntents = marketManager.getSellIntents();
    if (sellIntents.length === 0) return result;

    const intent = sellIntents[0];
    const resource = intent.resource;

    // Проверяем что ресурс не стал critical
    if (economyManager.isCritical(resource)) {
      console.log(
        `[MarketExecutor] SKIP_CRITICAL ${resource} стал critical — не продаём`,
      );
      result.skipped++;
      return result;
    }

    // Ищем комнату с наибольшим запасом в терминале
    const room = this._findSellRoom(resource);
    if (!room) {
      console.log(
        `[MarketExecutor] SKIP_NO_ROOM нет комнаты для продажи ${resource}`,
      );
      result.skipped++;
      return result;
    }

    const terminal = room.terminal;
    const inTerminal = terminal.store[resource] || 0;

    if (inTerminal < MIN_SELL_AMOUNT) {
      console.log(
        `[MarketExecutor] SKIP_LOW_AMOUNT ${resource} в терминале: ${inTerminal} < ${MIN_SELL_AMOUNT}`,
      );
      result.skipped++;
      return result;
    }

    // Ищем лучший buy ордер (highest price)
    const orders = Game.market
      .getAllOrders({
        type: ORDER_BUY,
        resourceType: resource,
      })
      .filter(o => o.remainingAmount >= 100)
      .sort((a, b) => b.price - a.price);

    if (orders.length === 0) {
      console.log(
        `[MarketExecutor] SKIP_NO_ORDERS нет покупателей для ${resource}`,
      );
      result.skipped++;
      return result;
    }

    const order = orders[0];

    // ── PARTIAL SELL ──────────────────────────────────────────────────────
    // intent.amount может быть больше order.remainingAmount.
    // Продаём сколько можем — остаток остаётся в intent для следующего цикла.
    let dealAmount = Math.min(inTerminal, order.remainingAmount, intent.amount);

    // Transaction cost validation
    const txCost = Game.market.calcTransactionCost(
      dealAmount,
      room.name,
      order.roomName,
    );
    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;

    if (txCost > terminalEnergy - TERMINAL_ENERGY_MIN) {
      console.log(
        `[MarketExecutor] SKIP_LOW_ENERGY ${room.name}: нужно ${txCost} energy,` +
          ` есть ${terminalEnergy} для продажи ${resource}`,
      );
      result.skipped++;
      return result;
    }

    // Выполняем сделку
    const res = Game.market.deal(order.id, dealAmount, room.name);

    if (res === OK) {
      const earned = dealAmount * order.price;
      result.executed++;
      result.creditsEarned += earned;

      // ── INTENT COMPLETION ─────────────────────────────────────────────
      // Уменьшаем remaining amount в intent.
      // MarketManager пересчитает в следующем цикле (каждые 100 тиков).
      intent.amount = Math.max(0, intent.amount - dealAmount);

      console.log(
        `[MarketExecutor] ✅ SELL ${dealAmount} ${resource}` +
          ` @ ${order.price} → ${order.roomName}` +
          ` (+${earned.toFixed(0)} credits)` +
          ` remaining=${intent.amount}`,
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

  _executeBuy: function () {
    const result = { executed: 0, skipped: 0, failed: 0, creditsSpent: 0 };

    // ── CREDITS SAFETY ────────────────────────────────────────────────────
    // TEST B: credits < MIN_CREDITS → сделки НЕ выполняются
    if (Game.market.credits < MIN_CREDITS) {
      console.log(
        `[MarketExecutor] SKIP_LOW_CREDITS` +
          ` credits=${Game.market.credits.toFixed(0)} < ${MIN_CREDITS}`,
      );
      result.skipped++;
      return result;
    }

    const buyIntents = marketManager.getBuyIntents();
    if (buyIntents.length === 0) return result;

    const intent = buyIntents[0];
    const resource = intent.resource;

    const room = this._findBuyRoom();
    if (!room) {
      console.log(
        `[MarketExecutor] SKIP_NO_ROOM нет комнаты для покупки ${resource}`,
      );
      result.skipped++;
      return result;
    }

    const terminal = room.terminal;

    // Ищем лучший sell ордер (lowest price) в рамках MAX_BUY_PRICE
    const maxPrice = MAX_BUY_PRICE[resource] || 999;
    const orders = Game.market
      .getAllOrders({
        type: ORDER_SELL,
        resourceType: resource,
      })
      .filter(o => o.remainingAmount >= 100 && o.price <= maxPrice)
      .sort((a, b) => a.price - b.price);

    if (orders.length === 0) {
      console.log(
        `[MarketExecutor] SKIP_NO_ORDERS нет продавцов для ${resource} (maxPrice=${maxPrice})`,
      );
      result.skipped++;
      return result;
    }

    const order = orders[0];

    // ── PARTIAL BUY ───────────────────────────────────────────────────────
    const dealAmount = Math.min(intent.amount, order.remainingAmount, 10000);

    // Transaction cost validation
    const txCost = Game.market.calcTransactionCost(
      dealAmount,
      room.name,
      order.roomName,
    );
    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;

    if (txCost > terminalEnergy - TERMINAL_ENERGY_MIN) {
      console.log(
        `[MarketExecutor] SKIP_LOW_ENERGY ${room.name}: нужно ${txCost} energy` +
          ` для покупки ${resource}`,
      );
      result.skipped++;
      return result;
    }

    // Credits на сделку
    const dealCost = dealAmount * order.price;
    if (Game.market.credits - dealCost < MIN_CREDITS) {
      console.log(
        `[MarketExecutor] SKIP_LOW_CREDITS после сделки останется мало credits` +
          ` (нужно: ${dealCost.toFixed(0)})`,
      );
      result.skipped++;
      return result;
    }

    const res = Game.market.deal(order.id, dealAmount, room.name);

    if (res === OK) {
      result.executed++;
      result.creditsSpent += dealCost;

      // Intent completion — уменьшаем remaining
      intent.amount = Math.max(0, intent.amount - dealAmount);

      console.log(
        `[MarketExecutor] ✅ BUY ${dealAmount} ${resource}` +
          ` @ ${order.price} from ${order.roomName}` +
          ` (-${dealCost.toFixed(0)} credits)` +
          ` remaining=${intent.amount}`,
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
   * Ищет комнату с наибольшим запасом ресурса в терминале.
   */
  _findSellRoom: function (resource) {
    let best = null;
    let bestAmount = 0;

    for (const roomName in Game.rooms) {
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
   * Ищет комнату с терминалом и достаточной энергией для покупки.
   */
  _findBuyRoom: function () {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      if (!room.terminal) continue;
      if (room.terminal.cooldown > 0) continue;

      const terminalEnergy = room.terminal.store[RESOURCE_ENERGY] || 0;
      if (terminalEnergy >= TERMINAL_ENERGY_MIN * 2) return room;
    }
    return null;
  },

  /**
   * Добавляет запись в историю сделок.
   * Хранит последние MAX_HISTORY записей.
   */
  _addHistory: function (entry) {
    if (!Memory.empire.marketHistory) {
      Memory.empire.marketHistory = [];
    }
    Memory.empire.marketHistory.unshift(entry);
    if (Memory.empire.marketHistory.length > MAX_HISTORY) {
      Memory.empire.marketHistory.length = MAX_HISTORY;
    }
  },

  /**
   * Сохраняет метаданные запуска.
   * lastExecutedAt — основа execution lock.
   */
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
      lastExecutedAt: Game.time, // execution lock
      status,
      executedDeals: executed,
      skippedDeals: skipped,
      failedDeals: failed,
      creditsSpent: Math.round(spent),
      creditsEarned: Math.round(earned),
      executionDuration: Math.round(duration * 1000) / 1000,
    };
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  getLastDeals: function () {
    return Memory.empire.marketHistory || [];
  },

  getMeta: function () {
    return Memory.empire.marketMeta || {};
  },
};

module.exports = marketExecutor;
