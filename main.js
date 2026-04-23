const roomManager = require("./roomManager");
const roles = require("./roleRegistry");
const cpuMonitor = require("./cpuMonitor"); // 1. Подключаем модуль

module.exports.loop = function () {
  // 2. Инициализируем замер в самом начале тика
  cpuMonitor.startTick();

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
  // Оборачиваем менеджер комнат, чтобы видеть его нагрузку
  cpuMonitor.trackRole("roomManager", () => {
    for (let roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (room.controller && room.controller.my) {
        roomManager.run(room);
      }
    }
  });

  /**
   * 3. ЛОГИКА КРИПОВ
   */
  for (let name in Game.creeps) {
    const creep = Game.creeps[name];
    const roleName = creep.memory.role; // Сохраняем имя роли
    const roleModule = roles[roleName];

    if (roleModule) {
      // 3. Оборачиваем выполнение роли в трекер
      cpuMonitor.trackRole(roleName, () => {
        roleModule.run(creep);
      });
    }
  }

  // 4. Завершаем замер и выводим статистику в консоль
  cpuMonitor.endTick();
};
