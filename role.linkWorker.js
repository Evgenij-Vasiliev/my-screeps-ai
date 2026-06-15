/**
 * ===================================================
 * ROLE.LINKWORKER.JS — Рабочий линка
 * ===================================================
 * VERSION: 1.0
 *
 * Одна задача: линк у storage → storage
 * Стоит между линком и storage, перекладывает энергию.
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep.room.storage) return;

    const storage = creep.room.storage;
    const config = (Memory.rooms[creep.room.name] || {}).links;
    const storageLink =
      config && config.storage ? Game.getObjectById(config.storage) : null;

    if (!storageLink) return;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      if (storageLink.store[RESOURCE_ENERGY] === 0) return;
      if (creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storageLink, { reusePath: 5 });
      }
      return;
    }

    if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 5 });
    }
  },
};
