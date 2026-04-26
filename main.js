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
   */
  cpuMonitor.trackRole("roomManager", () => {
    const rooms = Object.values(Game.rooms);

    for (const room of rooms) {
      if (room.controller && room.controller.my) {
        roomManager.run(room);
      }
    }
  });

  /**
   * 3. ЛОГИКА КРИПОВ
   */
  const creeps = Object.values(Game.creeps);

  for (const creep of creeps) {
    const roleName = creep.memory.role;
    const roleModule = roles[roleName];

    if (!roleModule) continue; // защита от ошибок

    cpuMonitor.trackRole(roleName, () => {
      roleModule.run(creep);
    });
  }

  cpuMonitor.endTick();
};
