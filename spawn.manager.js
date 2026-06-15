const factory = require("creep.factory");

// Квоты крипов на комнату
const QUOTA = {
  worker: 2,
  miner: 2,
  towerSupplier: 1,
  linkWorker: 1,
  terminalUnloader: 1,
  attacker: 1,
  mineralMiner: 1,
  factoryWorker: 0,

  // harvester: 1,
  // upgrader: 0,
  // builder: 1,
  // repairer: 1,
  // transporter: 2,
};

module.exports = {
  run: function (room) {
    if (room.name === "E36S38") console.log("[spawn] вызван для E36S38");
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn || spawn.spawning) return;

    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    if (creeps.length === 0) {
      factory.run(spawn, "harvester", room.name);
      return;
    }

    for (const [role, quota] of Object.entries(QUOTA)) {
      const count = _.filter(creeps, c => c.memory.role === role).length;
      if (count < quota) {
        // Не спавним mineralMiner если минерал пуст
        if (role === "mineralMiner") {
          const mineral = room.find(FIND_MINERALS)[0];
          if (!mineral || mineral.mineralAmount === 0) continue;
        }

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
