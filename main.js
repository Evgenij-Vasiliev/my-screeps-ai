const roomManager = require("./roomManager");
const roles = require("./roleRegistry");

module.exports.loop = function () {
  /**
   * 1. ОЧИСТКА ПАМЯТИ
   */
  for (let name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  /**
   * 2. ЛОГИКА КОМНАТ
   */
  for (let roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller && room.controller.my) {
      roomManager.run(room);
    }
  }

  /**
   * 3. ЛОГИКА КРИПОВ
   */
  for (let name in Game.creeps) {
    const creep = Game.creeps[name];
    const roleModule = roles[creep.memory.role];
    if (roleModule) {
      roleModule.run(creep);
    }
  }
};
