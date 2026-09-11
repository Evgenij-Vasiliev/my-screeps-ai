/**
 * ===================================================
 * MARKET.MANAGER.JS — Менеджер рынка
 * ===================================================
 * Исполнитель сделок купли/продажи по спискам ресурсов
 * из constants.js (MARKET.BUY_RESOURCES / MARKET.SELL_RESOURCES).
 * Ничего не решает сверх этих списков — просто продаёт/покупает
 * весь доступный/лучший объём по лучшей цене на рынке.
 * ===================================================
 */

const { MARKET } = require("./constants");

/**
 * Возвращает терминалы всех собственных комнат.
 */
function getEmpireTerminals() {
  const terminals = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (!room.terminal) continue;
    terminals.push(room.terminal);
  }
  return terminals;
}

/**
 * Ищет лучший ORDER_BUY (покупателя) для продажи ресурса.
 * Берём заказ с самой высокой ценой.
 */
function findBestBuyOrder(resourceType) {
  const orders = Game.market.getAllOrders({
    type: ORDER_BUY,
    resourceType,
  });
  if (!orders || orders.length === 0) return null;

  return orders.reduce(
    (best, o) => (o.price > best.price ? o : best),
    orders[0],
  );
}

/**
 * Ищет лучший ORDER_SELL (продавца) для закупки ресурса.
 * Берём заказ с самой низкой ценой.
 */
function findBestSellOrder(resourceType) {
  const orders = Game.market.getAllOrders({
    type: ORDER_SELL,
    resourceType,
  });
  if (!orders || orders.length === 0) return null;

  return orders.reduce(
    (best, o) => (o.price < best.price ? o : best),
    orders[0],
  );
}

/**
 * Продаёт весь доступный в терминале объём ресурса
 * лучшему покупателю на рынке (одна сделка).
 */
function trySellResource(terminal, resourceType) {
  if (terminal.cooldown > 0) return false;

  const available = terminal.store[resourceType] || 0;
  if (available <= 0) return false;

  const order = findBestBuyOrder(resourceType);
  if (!order) return false;

  const amount = Math.min(available, order.amount);
  const txCost = Game.market.calcTransactionCost(
    amount,
    terminal.room.name,
    order.roomName,
  );

  if (terminal.store[RESOURCE_ENERGY] < txCost) {
    console.log(
      `[Market] ⚡ ${terminal.room.name}: мало энергии для продажи ${resourceType}` +
        ` (нужно: ${txCost}, есть: ${terminal.store[RESOURCE_ENERGY]})`,
    );
    return false;
  }

  const result = Game.market.deal(order.id, amount, terminal.room.name);

  if (result === OK) {
    console.log(
      `[Market] ✅ ${terminal.room.name}: продано ${amount} ${resourceType}` +
        ` по ${order.price} = ${Math.floor(amount * order.price)} кредитов`,
    );
    return true;
  }

  console.log(`[Market] ❌ Ошибка продажи ${resourceType}: ${result}`);
  return false;
}

/**
 * Покупает весь объём лучшего предложения ресурса на рынке
 * в терминал переданной комнаты (одна сделка).
 */
function tryBuyResource(terminal, resourceType) {
  if (terminal.cooldown > 0) return false;

  const order = findBestSellOrder(resourceType);
  if (!order) return false;

  const amount = order.amount;
  const txCost = Game.market.calcTransactionCost(
    amount,
    terminal.room.name,
    order.roomName,
  );

  if (terminal.store[RESOURCE_ENERGY] < txCost) {
    console.log(
      `[Market] ⚡ ${terminal.room.name}: мало энергии для закупки ${resourceType}` +
        ` (нужно: ${txCost}, есть: ${terminal.store[RESOURCE_ENERGY]})`,
    );
    return false;
  }

  const result = Game.market.deal(order.id, amount, terminal.room.name);

  if (result === OK) {
    console.log(
      `[Market] ✅ ${terminal.room.name}: куплено ${amount} ${resourceType}` +
        ` по ${order.price} = ${Math.floor(amount * order.price)} кредитов`,
    );
    return true;
  }

  console.log(`[Market] ❌ Ошибка закупки ${resourceType}: ${result}`);
  return false;
}

/**
 * Точка входа. Вызывается один раз за тик из room.manager.js/empire-уровня.
 */
function run() {
  if (!Game.market) return;

  const terminals = getEmpireTerminals();
  if (terminals.length === 0) return;

  let dealsCount = 0;

  for (const resourceType of MARKET.SELL_RESOURCES) {
    if (dealsCount >= MARKET.MAX_DEALS_PER_TICK) break;

    for (const terminal of terminals) {
      if (dealsCount >= MARKET.MAX_DEALS_PER_TICK) break;

      if (trySellResource(terminal, resourceType)) {
        dealsCount++;
      }
    }
  }

  for (const resourceType of MARKET.BUY_RESOURCES) {
    if (dealsCount >= MARKET.MAX_DEALS_PER_TICK) break;

    for (const terminal of terminals) {
      if (dealsCount >= MARKET.MAX_DEALS_PER_TICK) break;

      if (tryBuyResource(terminal, resourceType)) {
        dealsCount++;
      }
    }
  }
}

module.exports = { run };
