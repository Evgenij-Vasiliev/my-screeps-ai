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
    // Конфиг линков может отсутствовать/быть битым — тогда роль просто ждёт.
    const roomMemory = (Memory.rooms && Memory.rooms[creep.room.name]) || {};
    const config = roomMemory.links;
    const storageLink =
      config && typeof config.storage === "string"
        ? Game.getObjectById(config.storage)
        : null;
    if (!storageLink) return;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      if (storageLink.store[RESOURCE_ENERGY] === 0) return;

      const result = creep.withdraw(storageLink, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.travelTo(storageLink);
      } else if (result !== OK) {
        console.log(
          `[LinkWorker] ${creep.room.name} : withdraw() вернул ошибку ${result}`,
        );
      }
      return;
    }

    const result = creep.transfer(storage, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(storage);
    } else if (result !== OK) {
      console.log(
        `[LinkWorker] ${creep.room.name} : transfer() вернул ошибку ${result}`,
      );
    }
  },
};
