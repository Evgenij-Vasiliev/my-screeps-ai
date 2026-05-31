const roomManager = require("./roomManager");
const roles = require("./roleRegistry");
const cpuMonitor = require("./cpuMonitor");
const cmd = require("./console");
const empireResourceRegistry = require("./empireResourceRegistry");
const economyManager = require("./economyManager");
const factoryDirector = require("./factoryDirector");
const logisticsDirector = require("./logisticsDirector");
const taskDispatcher = require("./taskDispatcher"); // ← НОВЫЙ МОДУЛЬ
const labDirector = require("./labDirector");
const labController = require("./labController");
const marketManager = require("./marketManager");
const marketExecutor = require("./marketExecutor");
const marketDirector = require("./marketDirector");
const diagnostics = require("./diagnostics");

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

  // Реестр ресурсов империи (offset 0, каждые 20 тиков)
  const firstRoom = Object.keys(Game.rooms)
    .filter(n => Game.rooms[n].controller && Game.rooms[n].controller.my)
    .sort()[0];
  if (firstRoom) empireResourceRegistry.run();

  // Экономический менеджер (offset 1, каждые 20 тиков)
  economyManager.run();

  // Директор завода (offset 2, каждые 20 тиков)
  factoryDirector.run();

  // Логистический директор (offset 3, каждые 20 тиков)
  logisticsDirector.run();

  // Диспетчер задач (каждые 5 тиков)
  // Читает queued deliveries → назначает воркерам
  // Должен запускаться ПОСЛЕ logisticsDirector
  taskDispatcher.run();

  // Лаб Директор
  labDirector.run();

  // Лаб Контроллер
  labController.run();
  //
  // marketManager

  marketManager.run();

  marketExecutor.run();

  marketDirector.run();

  diagnostics.run();

  /**
   * 2. АВТОПОПОЛНЕНИЕ РЕАГЕНТОВ — раз в 1000 тиков
   * Покупает Z и O если меньше 10000 в любой комнате
   */
  if (Game.time % 1000 === 0) {
    autoRefill();
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
