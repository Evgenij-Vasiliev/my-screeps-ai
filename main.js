const roomManager = require("./roomManager");
const roles = require("./roleRegistry");
const cpuMonitor = require("./cpuMonitor");

module.exports.loop = function () {
  cpuMonitor.startTick();

  /**
   * 1. ОЧИСТКА ПАМЯТИ
   */
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  /**
   * 2. ЛОГИКА КОМНАТ
   * for...in быстрее Object.values() — не создаёт лишний массив
   */
  cpuMonitor.trackRole("roomManager", () => {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (room.controller && room.controller.my) {
        roomManager.run(room);
      }
    }
  });

  /**
   * 3. ЛОГИКА КРИПОВ
   * for...in быстрее Object.values() — не создаёт лишний массив
   */
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const roleModule = roles[creep.memory.role];

    if (!roleModule) continue; // защита от ошибок

    cpuMonitor.trackRole(creep.memory.role, () => {
      roleModule.run(creep);
    });
  }

  cpuMonitor.endTick();
};
