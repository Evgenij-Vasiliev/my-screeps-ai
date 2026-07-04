const factory = require("creep.factory");
const empire = require("empire");

// Квоты крипов на комнату
const QUOTA = {
  worker: 2,
  miner: 2,
  towerSupplier: 1,
  linkWorker: 1,
  terminalUnloader: 1,
  attacker: 1,
  mineralMiner: 1,
  factoryWorker: 1,

  // harvester: 1,
  // upgrader: 0,
  builder: 0,
  // repairer: 1,
  // transporter: 2,
};

module.exports = {
  run: function (room) {
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

    // ИСПРАВЛЕНИЕ (ТЗ №26, Блок 4): empire.remoteMining.enabled и
    // .reserveEnabled были декоративными. Значения по умолчанию (true)
    // сохраняют прежнее поведение без изменений.
    if (room.name === "E35S37" && empire.remoteMining.enabled) {
      const remoteRooms = ["E35S38", "E36S37"];
      const globalRoles = [
        {
          role: "reserver",
          count: 2,
          enabled: empire.remoteMining.reserveEnabled,
        },
        { role: "remoteMiner", count: 2, enabled: true },
        { role: "remoteHauler", count: 2, enabled: true },
      ];
      for (const { role, count, enabled } of globalRoles) {
        if (!enabled) continue;
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
