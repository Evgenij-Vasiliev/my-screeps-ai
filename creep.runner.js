const roles = {
  worker: require("role.worker"),
  builder: require("role.builder"),
  miner: require("role.miner"),
  transporter: require("role.transporter"),
  towerSupplier: require("role.towerSupplier"),
  terminalUnloader: require("role.terminalUnloader"),
  mineralMiner: require("role.mineralMiner"),
  factoryWorker: require("role.factoryWorker"),
  linkWorker: require("role.linkWorker"),
  attacker: require("role.attacker"),
  reserver: require("role.reserver"),
  remoteMiner: require("role.remoteMiner"),
  remoteHauler: require("role.remoteHauler"),
};

const cpuMonitor = require("cpuMonitor");

function runOverride(creep, ov) {
  // минимальный универсальный диспетчер override
  if (!ov || !ov.type) return;

  switch (ov.type) {
    case "move":
      creep.moveTo(
        new RoomPosition(
          ov.target.x,
          ov.target.y,
          ov.target.room || creep.room.name,
        ),
      );
      break;

    case "transfer":
      if (creep.store.getUsedCapacity(ov.resource) > 0) {
        creep.transfer(
          Game.getObjectById(ov.target),
          ov.resource,
          Math.min(
            ov.amount || 10000,
            creep.store.getUsedCapacity(ov.resource),
          ),
        );
      }
      break;

    case "attack":
      creep.attack(Game.getObjectById(ov.target));
      break;

    case "heal":
      creep.heal(Game.getObjectById(ov.target));
      break;

    default:
      // неизвестная команда — игнор
      break;
  }

  // авто-завершение одноразовой команды
  if (ov.once !== false) {
    // можно расширить проверкой “достиг цели”
    creep.memory.override = null;
  }
}

module.exports = {
  run: function (room) {
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    for (const creep of creeps) {
      if (creep.spawning) continue;

      // 1. OVERRIDE LAYER (высший приоритет)
      const ov = creep.memory.override;

      if (ov) {
        cpuMonitor.trackRole("override", () => runOverride(creep, ov));
        continue;
      }

      // 2. AUTO LAYER (старые роли)
      const role = roles[creep.memory.role];

      if (role) {
        cpuMonitor.trackRole(creep.memory.role, () => role.run(creep));
      }
    }
  },
};
