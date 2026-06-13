/**
 * ===================================================
 * OBSERVER.MANAGER.JS — Наблюдение за удалёнными комнатами
 * ===================================================
 * VERSION: 1.0
 *
 * Чередует наблюдение за комнатами дальней добычи
 * чтобы сканер атак в room.remote.js их видел.
 * ===================================================
 */

const OBSERVE_ROOMS = ["E36S37", "E35S38"];

module.exports = {
  run: function (room) {
    const observer = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_OBSERVER,
    })[0];

    if (!observer) return;

    const index = Game.time % OBSERVE_ROOMS.length;
    observer.observeRoom(OBSERVE_ROOMS[index]);
  },
};
