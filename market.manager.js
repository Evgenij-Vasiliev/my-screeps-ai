/**
 * МЕНЕДЖЕР РЫНКА (Market Manager)
 * Чистый исполнитель чужих buy orders — никогда не принимает решений сам.
 */

const empire = require("empire");

module.exports = {
  // Исполнительный контур: просто выполняет сделку по указке Империи
  executeDeal: function (room, resource, amount) {
    const terminal = room.terminal;
    if (!terminal || terminal.cooldown > 0) return;

    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    const terminalEnergyMin = empire.getTerminalEnergyReserve();
    if (terminalEnergy < terminalEnergyMin) return;

    // Проверяем, сколько реально доступно физически в терминале
    const inTerminal = terminal.store[resource] || 0;
    const available = Math.min(inTerminal, amount, empire.market.maxDealAmount);
    if (available <= 0) return;

    // Ищем лучший buy order под этот ресурс
    const order = this._findBestOrder(resource, available, room.name);
    if (!order) return;

    const finalAmount = Math.min(available, order.amount);
    const txCost = Game.market.calcTransactionCost(
      finalAmount,
      room.name,
      order.roomName,
    );

    // Проверяем цену доставки
    if (txCost > terminalEnergy - terminalEnergyMin) {
      console.log(
        `[Market] ⚡ ${room.name}: мало энергии для сделки` +
          ` ${resource} (нужно: ${txCost}, есть: ${terminalEnergy})`,
      );
      return;
    }

    // Проводим сделку
    const result = Game.market.deal(order.id, finalAmount, room.name);
    if (result === OK) {
      console.log(
        `[Market] ✅ ${room.name}: продано ${finalAmount} ${resource}` +
          ` по ${order.price} = ${Math.floor(
            finalAmount * order.price,
          )} кредитов`,
      );
    } else {
      console.log(`[Market] ❌ Ошибка сделки ${resource}: ${result}`);
    }
  },

  _findBestOrder: function (resource, amount, roomName) {
    const orders = Game.market.getAllOrders({
      type: ORDER_BUY,
      resourceType: resource,
    });

    if (!orders || orders.length === 0) return null;

    // Сортируем по цене — берём лучшую
    return (
      orders.filter(o => o.amount > 0).sort((a, b) => b.price - a.price)[0] ||
      null
    );
  },
};
