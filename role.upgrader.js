/**
 * ЛОГИКА АПГРЕЙДЕРА (Upgrader Role)
 *
 * ТЗ №2: прямая добыча из источников и контейнеров убрана.
 * Основной источник — Storage.
 */
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // Переключение режимов. Запись в Memory — только при смене режима:
    // значение живёт в памяти крипа тиками и меняется редко.
    if (creep.store[RESOURCE_ENERGY] === 0) {
      if (creep.memory.working !== false) creep.memory.working = false;
    }
    if (creep.store.getFreeCapacity() === 0) {
      if (creep.memory.working !== true) creep.memory.working = true;
    }

    // Режим сбора энергии
    if (!creep.memory.working) {
      energySource.withdrawFromStorage(creep);
    }
    // Режим улучшения
    else {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { reusePath: 10 });
      }
    }
  },
};
