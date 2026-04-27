// Задаем объем энергии для терминала
Game.rooms["E35S37"].memory.terminalEnergyTarget = 20000;

// Изменить источник
Game.creeps["ИМЯ_КРИПА"].memory.sourceIndex = 1;

// RESOURCE_KEANIUM_HYDRIDE: "KH", RESOURCE_KEANIUM: "K", RESOURCE_HYDROGEN: "H", RESOURCE_LEMERGIUM: "L", RESOURCE_UTRIUM: "U",
// RESOURCE_ENERGY - энергия
// Продажа ресурсов

Game.market.createOrder({
  type: ORDER_SELL,
  resourceType: RESOURCE_ENERGY,
  price: 7.0,
  totalAmount: 200000,
  roomName: "E37S38",
});
