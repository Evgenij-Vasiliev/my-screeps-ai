/**
 * ===================================================
 * MANAGER.REMOTE.JS — Менеджер дальней добычи
 * ===================================================
 * Резервер, дальний майнер и дальний хайлер
 * распределяются по комнатам и запускают свою
 * ролевую логику.
 * ===================================================
 */

const roleReserver = require("remote.reserver");
const roleRemoteMiner = require("remote.miner");
const roleRemoteHauler = require("remote.hauler");

const REMOTE_ROOMS = ["E35S38", "E36S37"];

function assignTargetRoom(creeps) {
  const usedRooms = {};
  for (const creep of creeps) {
    if (creep.memory.targetRoom) usedRooms[creep.memory.targetRoom] = true;
  }

  for (const creep of creeps) {
    if (!creep.memory.targetRoom) {
      const targetRoom = REMOTE_ROOMS.find(room => !usedRooms[room]);
      if (targetRoom) {
        creep.memory.targetRoom = targetRoom;
        usedRooms[targetRoom] = true;
      }
    }
  }
}

module.exports = {
  run: function () {
    const REMOTE_CACHE_MAX_AGE = 50; // тиков — максимум устаревания кэша

    const creepNames = Object.keys(Game.creeps);

    if (
      !Memory.remoteRoleCache ||
      Memory.remoteRoleCacheCount !== creepNames.length ||
      Game.time - (Memory.remoteRoleCacheUpdatedAt || 0) > REMOTE_CACHE_MAX_AGE
    ) {
      const reservers = [];
      const remoteMiners = [];
      const remoteHaulers = [];

      for (const name of creepNames) {
        const role = Game.creeps[name].memory.role;
        if (role === "reserver") reservers.push(name);
        else if (role === "remoteMiner") remoteMiners.push(name);
        else if (role === "remoteHauler") remoteHaulers.push(name);
      }

      Memory.remoteRoleCache = { reservers, remoteMiners, remoteHaulers };
      Memory.remoteRoleCacheCount = creepNames.length;
      Memory.remoteRoleCacheUpdatedAt = Game.time;
    }
    const cache = Memory.remoteRoleCache;

    const reservers = cache.reservers
      .map(name => Game.creeps[name])
      .filter(Boolean);
    const remoteMiners = cache.remoteMiners
      .map(name => Game.creeps[name])
      .filter(Boolean);
    const remoteHaulers = cache.remoteHaulers
      .map(name => Game.creeps[name])
      .filter(Boolean);

    assignTargetRoom(reservers);
    for (const creep of reservers) roleReserver.run(creep);

    assignTargetRoom(remoteMiners);
    for (const creep of remoteMiners) roleRemoteMiner.run(creep);

    assignTargetRoom(remoteHaulers);
    for (const creep of remoteHaulers) roleRemoteHauler.run(creep);
  },
};
