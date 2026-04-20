const marketManager = {
  run: function (room) {
    if (!room.terminal) return;

    const ENERGY_THRESHOLD = 150000;
    const CRITICAL_THRESHOLD = 200000; // Порог для перезапуска ордера
    const terminalEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY);

    if (Game.time % 10 === 0) {
      console.log(
        `[MARKET-DEBUG] ${room.name}: ${terminalEnergy} / ${ENERGY_THRESHOLD}`,
      );
    }

    // 1. Поиск существующего ордера
    const existingOrder = _.find(
      Object.values(Game.market.orders),
      o =>
        o.roomName === room.name &&
        o.resourceType === RESOURCE_ENERGY &&
        o.type === ORDER_SELL,
    );

    // ЛОГИКА ПРИ ПЕРЕПОЛНЕНИИ (>= 200 000)
    if (terminalEnergy >= CRITICAL_THRESHOLD) {
      if (existingOrder) {
        // Если энергии много, а старый ордер всё еще висит — сносим его
        console.log(
          `[MARKET] ${room.name}: Критический избыток (>=200k). Отмена старого ордера.`,
        );
        Game.market.cancelOrder(existingOrder.id);
        return; // Одно действие за раз: в этом тике только отмена
      }

      // Если старого ордера уже нет (снесли в прошлом шаге) — ставим новый на 100к
      const price = this.getSmartPrice(RESOURCE_ENERGY);
      const result = Game.market.createOrder({
        type: ORDER_SELL,
        resourceType: RESOURCE_ENERGY,
        price: price,
        totalAmount: 100000, // 50 старых + 50 новых
        roomName: room.name,
      });

      if (result === OK)
        console.log(`[MARKET] ${room.name}: Создан ордер на 100к`);
      return;
    }

    // ЛОГИКА ПРИ СТАНДАРТНОМ НАКОПЛЕНИИ (150 000)
    if (terminalEnergy >= ENERGY_THRESHOLD) {
      if (existingOrder) {
        // Если ордер висит — просто ждем (ваша логика)
        return;
      }

      const price = this.getSmartPrice(RESOURCE_ENERGY);
      const result = Game.market.createOrder({
        type: ORDER_SELL,
        resourceType: RESOURCE_ENERGY,
        price: price,
        totalAmount: 50000,
        roomName: room.name,
      });

      if (result === OK)
        console.log(`[MARKET] ${room.name}: Создан ордер на 50к`);
    }
  },

  getSmartPrice: function (resourceType) {
    const buyOrders = Game.market.getAllOrders({
      type: ORDER_BUY,
      resourceType: resourceType,
    });
    if (buyOrders && buyOrders.length > 0) {
      const bestBuyOrder = _.max(buyOrders, o => o.price);
      return parseFloat((bestBuyOrder.price + 0.001).toFixed(3));
    }
    return 0.1;
  },
};

module.exports = marketManager;
