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

const Empire = require("empire");

module.exports = {
  run: function (room) {
    // ИСПРАВЛЕНИЕ (ТЗ №26, Блок 2): флаг был декоративным —
    // empire.factory.enabled ни на что не влиял. Теперь при false
    // производство не запускается вообще (return до любых проверок
    // structures/cooldown/energy), при true поведение полностью
    // совпадает с прежним.
    if (!Empire.factory.enabled) return;

    const factory = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY,
    })[0];

    if (!factory) return;
    if (factory.cooldown > 0) return;

    const storage = room.storage;
    if (!storage) return;

    if (storage.store[RESOURCE_ENERGY] < Empire.energy.factoryReserve) return;

    // Производим батарейки если есть энергия на фабрике
    if (factory.store[RESOURCE_ENERGY] >= 600) {
      factory.produce(RESOURCE_BATTERY);
    }
  },
};
