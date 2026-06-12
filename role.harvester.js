/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Аварийный крип — восстанавливает колонию после коллапса.
 * Энергия: Storage → если пусто → Source напрямую.
 * Доставка: Extensions → Spawn → Storage.
 */
module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (!creep.memory.working) {
      this._collect(creep);
    } else {
      this._deliver(creep);
    }
  },

  _collect: function (creep) {
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 10 });
      }
      return;
    }
    // Storage пуст — добываем напрямую
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { reusePath: 10 });
    }
  },

  _deliver: function (creep) {
    // Extensions → Spawn → Storage
    let target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_EXTENSION ||
          s.structureType === STRUCTURE_SPAWN) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    if (
      !target &&
      creep.room.storage &&
      creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      target = creep.room.storage;
    }

    if (
      target &&
      creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
    ) {
      creep.moveTo(target, { reusePath: 10 });
    }
  },
};
