const roomManager = require("room.manager");

module.exports.loop = function () {
  // Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  // Запускаем менеджер для каждой нашей комнаты
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];

    // Пропускаем комнаты без контроллера (хайвеи) и чужие
    if (!room.controller || !room.controller.my) continue;

    try {
      roomManager.run(room);
    } catch (e) {
      console.log(`[main] Ошибка в комнате ${roomName}: ${e.message}`);
    }
  }
};
