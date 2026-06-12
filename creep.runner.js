const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleRepairer = require("role.repairer");
const roleMiner = require("role.miner");
const roleTransporter = require("role.transporter");
const roleTowerSupplier = require("role.towerSupplier");
const roleTerminalUnloader = require("role.terminalUnloader");
const cpuMonitor = require("cpuMonitor");

module.exports = {
  run: function (room) {
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    for (const creep of creeps) {
      if (creep.spawning) continue;

      try {
        cpuMonitor.trackRole(creep.memory.role, () => this._runRole(creep));
      } catch (e) {
        console.log(`[creep.runner] Ошибка крипа ${creep.name}: ${e.message}`);
      }
    }
  },

  _runRole: function (creep) {
    switch (creep.memory.role) {
      case "harvester":
        roleHarvester.run(creep);
        break;
      case "upgrader":
        roleUpgrader.run(creep);
        break;
      case "builder":
        roleBuilder.run(creep);
        break;
      case "repairer":
        roleRepairer.run(creep);
        break;
      case "miner":
        roleMiner.run(creep);
        break;
      case "transporter":
        roleTransporter.run(creep);
        break;
      case "towerSupplier":
        roleTowerSupplier.run(creep);
        break;
      case "terminalUnloader":
        roleTerminalUnloader.run(creep);
        break;
      default:
        console.log(
          `[creep.runner] Неизвестная роль: ${creep.memory.role} у ${creep.name}`,
        );
    }
  },
};
