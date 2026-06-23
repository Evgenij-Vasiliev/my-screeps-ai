/**
 * МЕНЕДЖЕР РЫНКА (Market Manager)
 * Только исполнение чужих buy orders — никогда не создаём свои ордера.
 * Запускается раз в UPDATE_INTERVAL тиков из первой комнаты.
 *
 * Логика:
 * 1. Смотрим излишки ресурсов по всей империи
 * 2. Находим лучший buy order на рынке
 * 3. Исполняем через terminal.deal()
 */

const UPDATE_INTERVAL = 100;

// Минимальный излишек для продажи энергии
const ENERGY_SELL_SURPLUS = 100000;
// Минимальный излишек для продажи минералов
const MINERAL_SELL_SURPLUS = 50000;
// Минимум энергии в терминале для транзакции
const TERMINAL_ENERGY_MIN = 20000;
// Максимум за одну сделку
const MAX_DEAL_AMOUNT = 10000;

// Ресурсы разрешённые к продаже
const SELLABLE = new Set([
  RESOURCE_ENERGY,
  RESOURCE_BATTERY,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_OXYGEN,
  RESOURCE_HYDROGEN,
  RESOURCE_CATALYST,
  RESOURCE_GHODIUM,
  RESOURCE_UTRIUM_HYDRIDE,
  RESOURCE_UTRIUM_OXIDE,
  RESOURCE_KEANIUM_HYDRIDE,
  RESOURCE_KEANIUM_OXIDE,
  RESOURCE_LEMERGIUM_HYDRIDE,
  RESOURCE_LEMERGIUM_OXIDE,
  RESOURCE_ZYNTHIUM_HYDRIDE,
  RESOURCE_ZYNTHIUM_OXIDE,
  RESOURCE_GHODIUM_HYDRIDE,
  RESOURCE_ZYNTHIUM_KEANITE,
  RESOURCE_UTRIUM_LEMERGITE,
  RESOURCE_KEANIUM_ACID,
  RESOURCE_LEMERGIUM_ALKALIDE,
  RESOURCE_UTRIUM_ALKALIDE,
  RESOURCE_ZYNTHIUM_ALKALIDE,
]);

module.exports = {
  run: function () {
    if (Game.time % UPDATE_INTERVAL !== 0) return;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    for (const room of ourRooms) {
      this._trySell(room);
    }
  },

  _trySell: function (room) {
    const terminal = room.terminal;
    if (!terminal || terminal.cooldown > 0) return;

    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (terminalEnergy < TERMINAL_ENERGY_MIN) return;

    // Перебираем продаваемые ресурсы — энергия первой
    const resources = [RESOURCE_ENERGY, ...SELLABLE].filter(
      r => r !== RESOURCE_ENERGY,
    );
    resources.unshift(RESOURCE_ENERGY);

    for (const resource of resources) {
      const inTerminal = terminal.store[resource] || 0;
      const inStorage = room.storage ? room.storage.store[resource] || 0 : 0;
      const total = inTerminal + inStorage;

      const minSurplus =
        resource === RESOURCE_ENERGY
          ? ENERGY_SELL_SURPLUS
          : MINERAL_SELL_SURPLUS;

      if (total < minSurplus) continue;

      // Сколько можем продать из терминала
      const available = Math.min(inTerminal, MAX_DEAL_AMOUNT);
      if (available <= 0) continue;

      // Ищем лучший buy order
      const order = this._findBestOrder(resource, available, room.name);
      if (!order) continue;

      const amount = Math.min(available, order.amount);
      const txCost = Game.market.calcTransactionCost(
        amount,
        room.name,
        order.roomName,
      );

      if (txCost > terminalEnergy - TERMINAL_ENERGY_MIN) {
        console.log(
          `[Market] ⚡ ${room.name}: мало энергии для сделки` +
            ` ${resource} (нужно: ${txCost}, есть: ${terminalEnergy})`,
        );
        continue;
      }

      const result = Game.market.deal(order.id, amount, room.name);
      if (result === OK) {
        console.log(
          `[Market] ✅ ${room.name}: продано ${amount} ${resource}` +
            ` по ${order.price} = ${Math.floor(amount * order.price)} кредитов`,
        );
      } else {
        console.log(`[Market] ❌ Ошибка сделки ${resource}: ${result}`);
      }

      // Один ресурс за тик с одного терминала
      return;
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
