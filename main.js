const roomManager = require("./roomManager");
const roles = require("./roleRegistry");
const cpuMonitor = require("./cpuMonitor");
const cmd = require("./console");
const empireResourceRegistry = require("./empireResourceRegistry");
const economyManager = require("./economyManager");
const factoryDirector = require("./factoryDirector");
const logisticsDirector = require("./logisticsDirector");
const labDirector = require("./labDirector");
const labController = require("./labController");
const marketManager = require("./marketManager");

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

  // Реестр ресурсов империи

  const firstRoom = Object.keys(Game.rooms)
    .filter(n => Game.rooms[n].controller && Game.rooms[n].controller.my)
    .sort()[0];
  if (firstRoom) empireResourceRegistry.run();

  // Запуск Экономического менеджера

  economyManager.run();

  // Директор завода

  factoryDirector.run();

  // Логистика

  logisticsDirector.run();

  // Лаб Директор

  labDirector.run();

  // Лаб Контроллер

  labController.run();

  // marketManager

  marketManager.run();

  /**
   * 2. АВТОПОПОЛНЕНИЕ РЕАГЕНТОВ — раз в 1000 тиков
   * Покупает Z и O если меньше 10000 в любой комнате
   */
  if (Game.time % 1000 === 0) {
    cmd.autoRefill();
  }

  /**
   * 3. ЛОГИКА КОМНАТ
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
   * 4. ЛОГИКА КРИПОВ
   */
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const roleModule = roles[creep.memory.role];
    if (!roleModule) continue;
    cpuMonitor.trackRole(creep.memory.role, () => {
      roleModule.run(creep);
    });
  }

  cpuMonitor.endTick();
};
