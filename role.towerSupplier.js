/**
 * ЛОГИКА ЗАПРАВЩИКА БАШЕН (TowerSupplier Role)
 *
 * Одна задача: Storage → башни. Ремонтная версия (по образцу из прошлой
 * Империи): выбирает башню с НАИМЕНЬШИМ текущим запасом энергии, а не
 * ближайшую — иначе крип обслуживает одну и ту же башню, пока остальные
 * стоят пустыми.
 */
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
    if (!creep.room.storage) return;

    // Пусто — идём за энергией в Storage
    if (creep.store[RESOURCE_ENERGY] === 0) {
      energySource.withdrawFromStorage(creep);
      return;
    }

    // Есть энергия — ищем самую "голодную" башню (минимум текущей энергии)
    const towers = creep.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });

    const tower = towers
      .filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
      .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY])[0];

    if (tower) {
      if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(tower, { reusePath: 5 });
      }
      return;
    }

    // Все башни полные — возвращаем остаток в Storage
    if (creep.store[RESOURCE_ENERGY] > 0) {
      if (
        creep.transfer(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(creep.room.storage, { reusePath: 5 });
      }
    }
  },
};
