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

      const result = creep.withdraw(storageLink, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storageLink, { reusePath: 5 });
      } else if (result !== OK) {
        console.log(
          `[LinkWorker] ${creep.room.name} : withdraw() вернул ошибку ${result}`,
        );
      }
      return;
    }

    const result = creep.transfer(storage, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 5 });
    } else if (result !== OK) {
      console.log(
        `[LinkWorker] ${creep.room.name} : transfer() вернул ошибку ${result}`,
      );
    }
  },
};
