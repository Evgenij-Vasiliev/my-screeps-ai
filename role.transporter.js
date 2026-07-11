/**
 * ЛОГИКА ЗАПРАВЩИКА БАШЕН (TowerSupplier Role)
 *
 * ТЗ №2: закрепляет экстренный механизм, введённый во время ТЗ №1.
 * Storage становится штатным (приоритетным) источником энергии.
 * Контейнер — только резервный путь, если где-то ещё остался, не основной.
 * Прежняя модель (контейнер как основной источник) не возвращается.
 */
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
    // Если энергия закончилась, начинаем собирать
    if (creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
    }

    // Если энергия полная, начинаем передавать
    if (_.sum(creep.store) === creep.store.getCapacity()) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // ШТАТНЫЙ ИСТОЧНИК (ТЗ №2): Storage
      if (energySource.withdrawFromStorage(creep)) return;

      // РЕЗЕРВНЫЙ ПУТЬ: контейнер, если где-то ещё остался (не основной источник)
      const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container, { reusePath: 15 });
        }
      }
    } else {
      // Передаём энергию в башню
      const tower = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_TOWER &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      if (tower) {
        if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(tower, { reusePath: 15 });
        }
      }
    }
  },
};
