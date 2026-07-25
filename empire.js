/**
 * EMPIRE KERNEL (Ядро Империи)
 * Уровень империи: очистка памяти, делегирование всей комнатной
 * логики Room Manager'у, запуск глобального рынка.
 */
const roomManager = require("room.manager");
const marketManager = require("market.manager");

module.exports.run = function () {
  // 1. Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. Уровень комнат — вся комнатная логика внутри roomManager
  roomManager.run();

  // 3. Рынок империального уровня
  marketManager.run();
};
