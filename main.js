const empire = require("empire");
const roomManager = require("room.manager");
const cpuMonitor = require("cpuMonitor");

module.exports.loop = function () {
  cpuMonitor.startTick();

  empire.run();

  // Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  // Запускаем менеджер для каждой нашей комнаты
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    try {
      roomManager.run(room);
    } catch (e) {
      console.log(`[main] Ошибка в комнате ${roomName}: ${e.message}`);
    }
  }

  cpuMonitor.endTick();
};
