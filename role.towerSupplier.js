/**
 * ЛОГИКА СНАБЖЕНЦА БАШЕН (TowerSupplier Role)
 *
 * Приоритеты сбора энергии:
 *   1. Линк у storage (основной источник при линковой логистике)
 *   2. Dropped energy (подбираем по пути — не пропадать же)
 *   3. Контейнер (fallback если линка нет)
 *
 * Доставка:
 *   1. Башни — до полного заряда
 *   2. Storage — если башни полные
 *
 * Временно также перекладывает энергию из storage-линка в storage.
 */
module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (!creep.memory.working) {
      this._collect(creep);
    } else {
      this._supply(creep);
    }
  },

  _collect: function (creep) {
    // 1. Линк у storage — основной источник
    const config = (Memory.rooms[creep.room.name] || {}).links;
    if (config && config.storage) {
      const storageLink = Game.getObjectById(config.storage);
      if (storageLink && storageLink.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(storageLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storageLink, { reusePath: 10 });
        }
        return;
      }
    }

    // 2. Dropped energy
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped, { reusePath: 5 });
      }
      return;
    }

    // 3. Контейнер (fallback)
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container, { reusePath: 15 });
      }
    }
  },

  _supply: function (creep) {
    // 1. Башни — до полного
    const tower = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_TOWER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (tower) {
      if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(tower, { reusePath: 15 });
      }
      return;
    }

    // 2. Storage — если башни полные (заодно разгружаем storage-линк)
    if (
      creep.room.storage &&
      creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      if (
        creep.transfer(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(creep.room.storage, { reusePath: 10 });
      }
    }
  },
};
