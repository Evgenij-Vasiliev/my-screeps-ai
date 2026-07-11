/**
 * ЛОГИКА АПГРЕЙДЕРА (Upgrader Role)
 *
 * ТЗ №2: прямая добыча из источников и контейнеров убрана.
 * Основной источник — Storage. Линк у контроллера (если есть) сохранён как
 * приоритетный путь — это не Source и не контейнер, ТЗ №2 его не запрещает
 * и не упоминает; оставлен как уже работавшая оптимизация.
 */
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // Переключение режимов
    if (creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
    }
    if (creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    // Режим сбора энергии
    if (!creep.memory.working) {
      // 1. Линк у контроллера — если есть энергия, самый быстрый путь
      const controllerLink = creep.room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_LINK &&
          s.pos.inRangeTo(creep.room.controller, 3) &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];

      if (controllerLink) {
        if (
          creep.withdraw(controllerLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(controllerLink, { reusePath: 10 });
        }
        return;
      }

      // 2. Storage — основной источник энергии (ТЗ №2)
      energySource.withdrawFromStorage(creep);
      // Источники и контейнеры больше не используются.
    }
    // Режим улучшения
    else {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { reusePath: 10 });
      }
    }
  },
};
