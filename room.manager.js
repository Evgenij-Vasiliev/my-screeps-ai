const spawnManager = require("spawn.manager");
const creepRunner = require("creep.runner");
const towerManager = require("tower.manager");
const linkManager = require("link.manager");
const terminalManager = require("terminal.manager");
const cpuMonitor = require("cpuMonitor");

module.exports = {
  run: function (room) {
    this._initMemory(room);

    cpuMonitor.trackRole("towerManager", () => towerManager.run(room));
    cpuMonitor.trackRole("linkManager", () => linkManager.run(room));
    cpuMonitor.trackRole("terminalManager", () => terminalManager.run(room));
    cpuMonitor.trackRole("spawnManager", () => spawnManager.run(room));
    creepRunner.run(room);

    this._drawStats(room);
  },

  _initMemory: function (room) {
    if (!Memory.rooms) Memory.rooms = {};
    if (!Memory.rooms[room.name]) {
      Memory.rooms[room.name] = { wallThreshold: 1000 };
      console.log(`[room.manager] Инициализирована память для ${room.name}`);
    }
  },

  _drawStats: function (room) {
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
