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
     * Используем Slot Booking: идем к источнику по индексу из памяти.
     */
    if (!creep.memory.working) {
      // Получаем все источники в текущей комнате
      const sources = creep.room.find(FIND_SOURCES);

      // Если в памяти есть индекс (0 или 1), берем его. Для старых крипов ищем ближайший.
      const targetSource =
        creep.memory.sourceIndex !== undefined
          ? sources[creep.memory.sourceIndex]
          : creep.pos.findClosestByRange(FIND_SOURCES);

      if (targetSource) {
        if (creep.harvest(targetSource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targetSource, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
      }
    } else {
      /**
       * 4. РЕЖИМ ПЕРЕДАЧИ (Delivery Mode)
       * Развозим энергию согласно установленным приоритетам.
       */
      let target = null;

      // ПРИОРИТЕТ 1: Расширения (Extensions) - важны для лимита энергии
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // ПРИОРИТЕТ 2: Спавн (Spawn) - заправляем базу
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: structure =>
            structure.structureType === STRUCTURE_SPAWN &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // ПРИОРИТЕТ 3: Терминал (Terminal) - используем для рыночных операций
      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.terminal;
      }

      // ПРИОРИТЕТ 4: Хранилище (Storage) - основной склад
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
