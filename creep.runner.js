const roles = {
  worker: require("role.worker"),
  // harvester: require("role.harvester"),
  // upgrader: require("role.upgrader"),
  // builder: require("role.builder"),
  // repairer: require("role.repairer"),
  miner: require("role.miner"),
  transporter: require("role.transporter"),
  towerSupplier: require("role.towerSupplier"),
  linkWorker: require("role.linkWorker"),
  terminalUnloader: require("role.terminalUnloader"),
  mineralMiner: require("role.mineralMiner"),
  factoryWorker: require("role.factoryWorker"),
  attacker: require("role.attacker"),
  reserver: require("role.reserver"),
  remoteMiner: require("role.remoteMiner"),
  remoteHauler: require("role.remoteHauler"),
};

const cpuMonitor = require("cpuMonitor");

module.exports = {
  run: function (room) {
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    for (const creep of creeps) {
      if (creep.spawning) continue;

      const role = roles[creep.memory.role];
      if (role) {
        cpuMonitor.trackRole(creep.memory.role, () => role.run(creep));
      }
    }
  },
};
