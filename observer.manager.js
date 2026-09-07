"use strict";

const ROOMS = ["E36S37", "E35S38"];

module.exports = {
  run: function () {
    const observers = Object.values(Game.structures).filter(
      s => s.structureType === STRUCTURE_OBSERVER,
    );

    if (observers.length === 0) return;

    const observer = observers[0];
    const roomName = ROOMS[Game.time % ROOMS.length];

    observer.observeRoom(roomName);
  },
};
