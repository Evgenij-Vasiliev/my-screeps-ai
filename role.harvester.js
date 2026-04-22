/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Собирает энергию с источников (приоритет: подобранная с земли → контейнер → источник)
 * Доставляет энергию в приоритетном порядке: extensions → spawn → terminal → storage
 */
module.exports = {
  run: function (creep) {
    // ========== 1. УПРАВЛЕНИЕ СОСТОЯНИЕМ ==========
    // working = false → собираем энергию
    // working = true  → разносим энергию
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    // Переключаем на доставку, если инвентарь заполнен
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }
    // Переключаем на сбор, если энергия кончилась
    else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false;
    }

    // ========== 2. РЕЖИМ СБОРА (HARVEST MODE) ==========
    if (!creep.memory.working) {
      // Находим источник, привязанный к крипу (sourceIndex задаётся при спавне)
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];
      if (!mySource) return;

      // Приоритет 1: подобрать энергию, упавшую рядом с источником (в радиусе 2 клеток)
      const droppedEnergy = mySource.pos.findInRange(
        FIND_DROPPED_RESOURCES,
        2,
        {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
        },
      )[0];

      if (droppedEnergy) {
        if (creep.pickup(droppedEnergy) === ERR_NOT_IN_RANGE) {
          creep.moveTo(droppedEnergy, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // Приоритет 2: взять энергию из контейнера, стоящего рядом с источником
      const container = mySource.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];

      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // Приоритет 3: копать самому
      if (creep.harvest(mySource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(mySource, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    }
    // ========== 3. РЕЖИМ ДОСТАВКИ (DELIVERY MODE) ==========
    else {
      let target = null;

      // Приоритет 1: наполнить extensions
      target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_EXTENSION &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      // Приоритет 2: наполнить spawn
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_SPAWN &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // Приоритет 3: наполнить терминал (если есть и есть свободное место)
      if (!target && creep.room.terminal) {
        if (creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          target = creep.room.terminal;
        }
      }

      // Приоритет 4: наполнить хранилище (storage)
      if (!target && creep.room.storage) {
        if (creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          target = creep.room.storage;
        }
      }

      // Если цель найдена — двигаемся и передаём энергию
      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
    }
  },
};
