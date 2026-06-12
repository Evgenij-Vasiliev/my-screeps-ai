const factory = require("creep.factory");

// Квоты крипов на комнату
const QUOTA = {
  miner: 2,
  towerSupplier: 2,
  terminalUnloader: 1,
  harvester: 1,
  upgrader: 1,
  builder: 1,
  repairer: 1,
  // transporter: 2, // не нужен при линковой логистике
};

module.exports = {
  run: function (room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) return;

    // Все крипы этой комнаты
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    // Режим выживания
    if (creeps.length === 0) {
      factory.run(spawn, "harvester", room.name);
      return;
    }

    // Ищем первую роль, у которой count < квоты
    for (const [role, quota] of Object.entries(QUOTA)) {
      const count = _.filter(creeps, c => c.memory.role === role).length;
      if (count < quota) {
        factory.run(spawn, role, room.name);
        return;
      }
    }
  },
};
