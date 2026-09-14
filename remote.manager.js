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

    // Инициализация глобального кэша (самопосборка после Global Reset)
    if (!global._remoteRoleCache) {
      global._remoteRoleCache = { reservers: [], remoteMiners: [], remoteHaulers: [] };
      global._remoteRoleCacheCount = 0;
      global._remoteRoleCacheUpdatedAt = 0;
    }

    const creepNames = Object.keys(Game.creeps);

    if (
      !global._remoteRoleCache ||
      global._remoteRoleCacheCount !== creepNames.length ||
      Game.time - (global._remoteRoleCacheUpdatedAt || 0) > REMOTE_CACHE_MAX_AGE
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

      global._remoteRoleCache = { reservers, remoteMiners, remoteHaulers };
      global._remoteRoleCacheCount = creepNames.length;
      global._remoteRoleCacheUpdatedAt = Game.time;
    }
    const cache = global._remoteRoleCache;

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
