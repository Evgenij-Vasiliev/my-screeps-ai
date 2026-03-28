/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Основная задача: сбор энергии и заправка ключевых зданий комнаты.
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. СОСТОЯНИЕ (State Management)
     * Инициализируем переменную в памяти, если её еще нет.
     */
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    /**
     * 2. ТУМБЛЕР (Logic Switch)
     * Переключаем режимы: "Сбор" (false) и "Доставка" (true).
     * Переключение происходит только при полном рюкзаке или полной разгрузке.
     */
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true; // Рюкзак полон -> везем энергию
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Энергия кончилась -> идем добывать
    }

    /**
     * 3. РЕЖИМ СБОРА (Harvesting Mode)
     * Если working === false, ищем ближайший источник энергии.
     */
    if (!creep.memory.working) {
      const source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    } else {
    /**
     * 4. РЕЖИМ ПЕРЕДАЧИ (Delivery Mode)
     * Если working === true, развозим энергию согласно строгим приоритетам.
     */
      let target = null;

      // ПРИОРИТЕТ 1: Расширения (Extensions) - важны для лимита энергии комнаты
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // ПРИОРИТЕТ 2: Спавн (Spawn) - заправляем, только если расширения полные
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_SPAWN &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // ПРИОРИТЕТ 3: Хранилище (Storage) - везем излишки в большой "сундук"
      if (!target && creep.room.storage) {
        target = creep.room.storage;
      }

      // ВЫПОЛНЕНИЕ ДОСТАВКИ
      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
    }
  },
};
