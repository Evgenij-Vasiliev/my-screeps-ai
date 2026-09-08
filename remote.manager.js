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

module.exports = {
  run: function () {
    const reservers = Object.values(Game.creeps).filter(
      creep => creep.memory.role === "reserver",
    );

    for (const creep of reservers) {
      if (!creep.memory.targetRoom) {
        const usedRooms = reservers
          .map(c => c.memory.targetRoom)
          .filter(Boolean);

        const targetRoom = REMOTE_ROOMS.find(room => !usedRooms.includes(room));

        if (targetRoom) {
          creep.memory.targetRoom = targetRoom;
        }
      }

      roleReserver.run(creep);
    }

    const remoteMiners = Object.values(Game.creeps).filter(
      creep => creep.memory.role === "remoteMiner",
    );

    for (const creep of remoteMiners) {
      if (!creep.memory.targetRoom) {
        const usedRooms = remoteMiners
          .map(c => c.memory.targetRoom)
          .filter(Boolean);

        const targetRoom = REMOTE_ROOMS.find(room => !usedRooms.includes(room));

        if (targetRoom) {
          creep.memory.targetRoom = targetRoom;
        }
      }

      roleRemoteMiner.run(creep);
    }

    const remoteHaulers = Object.values(Game.creeps).filter(
      creep => creep.memory.role === "remoteHauler",
    );

    for (const creep of remoteHaulers) {
      if (!creep.memory.targetRoom) {
        const usedRooms = remoteHaulers
          .map(c => c.memory.targetRoom)
          .filter(Boolean);

        const targetRoom = REMOTE_ROOMS.find(room => !usedRooms.includes(room));

        if (targetRoom) {
          creep.memory.targetRoom = targetRoom;
        }
      }

      roleRemoteHauler.run(creep);
    }
  },
};
