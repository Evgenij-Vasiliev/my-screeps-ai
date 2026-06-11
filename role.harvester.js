/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Задача: сбор энергии и заправка ключевых зданий комнаты.
 * Используется как запасной крип пока майнеры/транспортёры не готовы.
 */
module.exports = {
  run: function (creep) {
    // Тумблер
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false;
    }
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (!creep.memory.working) {
      // Сбор: по индексу из памяти или ближайший
      const sources = creep.room.find(FIND_SOURCES);
      const target =
        creep.memory.sourceIndex !== undefined
          ? sources[creep.memory.sourceIndex]
          : creep.pos.findClosestByRange(FIND_SOURCES);

      if (target && creep.harvest(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          visualizePathStyle: { stroke: "#ffaa00" },
          reusePath: 10,
        });
      }
    } else {
      // Доставка: Extensions → Spawn → Terminal → Storage
      let target = null;

      target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_EXTENSION &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: s =>
            s.structureType === STRUCTURE_SPAWN &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.terminal;
      }

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
        creep.moveTo(target, {
          visualizePathStyle: { stroke: "#ffffff" },
          reusePath: 10,
        });
      }
    }
  },
};
