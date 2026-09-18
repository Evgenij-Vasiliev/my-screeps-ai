const creepFactory = require("creep.factory");
const {
  SPAWN_QUOTA,
  ROOM_SPAWN_QUOTA_OVERRIDES,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  PRESPAWN_THRESHOLD,
} = require("./constants");

function countRole(creeps, role, roomName) {
  return creeps.filter(c => {
    if (c.memory.role !== role) return false;

    // Для reserver/remoteMiner считаем по "родной" комнате,
    // а не по физическому нахождению — крип может быть далеко.
    if (
      role === "reserver" ||
      role === "remoteMiner" ||
      role === "remoteHauler"
    ) {
      return c.memory.homeRoom === roomName;
    }

    const threshold = PRESPAWN_THRESHOLD[role];
    if (
      role !== "reserver" &&
      threshold !== undefined &&
      c.ticksToLive !== undefined &&
      c.ticksToLive < threshold
    ) {
      return false;
    }
    return true;
  }).length;
}

function run(roomState) {
  const spawn = roomState.spawns.find(s => !s.spawning);
  if (!spawn) return;
  const creeps = roomState.creeps;

  for (const role in SPAWN_QUOTA) {
    if (role === "reserver" && roomState.roomName !== "E35S37") continue;
    if (role === "remoteMiner" && roomState.roomName !== "E35S37") continue;
    if (role === "remoteHauler" && roomState.roomName !== "E35S37") continue;
    if (role === "attacker" && roomState.roomName === "E35S37") continue;

    if (role === "mineralMiner") {
      if (!roomState.mineral || !roomState.mineral.extractorId) continue;
      const mineralObj = Game.getObjectById(roomState.mineral.id);
      if (!mineralObj || mineralObj.mineralAmount < MINERAL_MIN_AMOUNT_TO_SPAWN)
        continue;
    }

    const override = ROOM_SPAWN_QUOTA_OVERRIDES[roomState.roomName];
    const quota =
      override && override[role] !== undefined
        ? override[role]
        : SPAWN_QUOTA[role];

    if (countRole(creeps, role, roomState.roomName) < quota) {
      const result = creepFactory.run(
        spawn,
        role,
        roomState.roomName,
        PRESPAWN_THRESHOLD[role],
      );
      if (result === OK) return;
    }
  }
}

module.exports.run = run;
