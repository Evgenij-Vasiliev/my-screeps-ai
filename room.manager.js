const spawnManager = require("spawn.manager");
const creepRunner = require("creep.runner");
const towerManager = require("tower.manager");

module.exports = {
  run: function (room) {
    // 1. Инициализация памяти комнаты при первом запуске
    this._initMemory(room);

    // 2. Управление башнями (высокий приоритет — защита)
    towerManager.run(room);

    // 3. Спавн крипов
    spawnManager.run(room);

    // 4. Запуск логики каждого крипа этой комнаты
    creepRunner.run(room);

    // 5. Визуализация статистики (удобно при отладке)
    this._drawStats(room);
  },

  _initMemory: function (room) {
    if (!Memory.rooms) Memory.rooms = {};
    if (!Memory.rooms[room.name]) {
      Memory.rooms[room.name] = {
        wallThreshold: 1000,
      };
      console.log(`[room.manager] Инициализирована память для ${room.name}`);
    }
  },

  _drawStats: function (room) {
    // Показываем количество крипов по ролям прямо в игре
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);
    const byRole = _.countBy(creeps, c => c.memory.role);
    const lines = Object.entries(byRole)
      .map(([role, count]) => `${role}: ${count}`)
      .join(" | ");
    if (lines) {
      room.visual.text(`[${room.name}] ${lines}`, 1, 1, {
        align: "left",
        opacity: 0.6,
        fontSize: 0.6,
      });
    }
  },
};
