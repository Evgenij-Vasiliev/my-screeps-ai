const factory = require("creep.factory");

// Квоты крипов на комнату
const QUOTA = {
  miner: 2,
  worker: 2,
  towerSupplier: 2,
  terminalUnloader: 1,
  attacker: 1,
  mineralMiner: 1,
  factoryWorker: 1,

  // harvester: 1,
  // upgrader: 0,
  // builder: 1,
  // repairer: 1,
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
    if (room.name === "E35S37") {
      const remoteRooms = ["E35S38", "E36S37"];
      const globalRoles = [
        { role: "reserver", count: 2 },
        { role: "remoteMiner", count: 2 },
        { role: "remoteHauler", count: 2 },
      ];
      for (const { role, count } of globalRoles) {
        const current = _.filter(
          Game.creeps,
          c => c.memory.role === role,
        ).length;
        if (current < count) {
          const targetRoom =
            remoteRooms.find(
              r =>
                !_.some(
                  Game.creeps,
                  c =>
                    c.memory.role === role &&
                    (c.memory.targetRoom === r || c.memory.target === r),
                ),
            ) || remoteRooms[0];
          factory.run(spawn, role, room.name, { targetRoom });
          return;
        }
      }
    }
  },
};
