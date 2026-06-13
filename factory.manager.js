/**
 * ===================================================
 * FACTORY.MANAGER.JS — Менеджер фабрики
 * ===================================================
 * VERSION: 1.0
 *
 * Производит батарейки если в storage достаточно энергии.
 * Запускает производство каждый тик если фабрика свободна.
 * ===================================================
 */

const ENERGY_RESERVE = 10000;

module.exports = {
  run: function (room) {
    const factory = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY,
    })[0];

    if (!factory) return;
    if (factory.cooldown > 0) return;

    const storage = room.storage;
    if (!storage) return;

    if (storage.store[RESOURCE_ENERGY] < ENERGY_RESERVE) return;

    // Производим батарейки если есть энергия на фабрике
    if (factory.store[RESOURCE_ENERGY] >= 600) {
      factory.produce(RESOURCE_BATTERY);
    }
  },
};
