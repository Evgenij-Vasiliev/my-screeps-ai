/**
 * ===================================================
 * EMPIRE.JS
 * ===================================================
 */

module.exports = {
  energy: {
    // базовые пороги баланса
    poorThreshold: 20000,
    richThreshold: 100000,

    // терминальная логика
    sendAmount: 20000,
    terminalMin: 100000,
    terminalMax: 150000,

    // циклы
    balanceInterval: 100,

    // экономика
    factoryReserve: 10000,
    sellSurplus: 100000,

    // продажа / подготовка
    sellPrepThreshold: 500000,
  },

  minerals: {
    sellSurplus: 50000,
  },

  run() {
    const myRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my,
    );

    Memory.empire = {
      rooms: myRooms.length,
    };
  },
};
