/**
 * ЛОГИКА АПГРЕЙДЕРА (Upgrader Role)
 * Основная задача: постоянная накачка контроллера комнаты энергией (RCL).
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. СОСТОЯНИЕ (State Management)
     * Если память пуста, начинаем с режима "готов к набору энергии".
     */
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    /**
     * 2. ТУМБЛЕР (Logic Switch)
     * Переключаем режимы: "Сбор" (false) и "Улучшение" (true).
     */
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true; // Рюкзак полон -> идем к контроллеру
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Энергия кончилась -> возвращаемся к источнику
    }

    /**
     * 3. РЕЖИМ СБОРА (Harvesting Mode)
     * Поиск ближайшего источника для пополнения запасов.
     */
    if (!creep.memory.working) {
      // Получаем список всех источников в комнате
      const sources = creep.room.find(FIND_SOURCES);

      // Выбираем цель: если в памяти есть индекс — берем его, иначе — ближайший (для старых крипов)
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
       * 4. РЕЖИМ УЛУЧШЕНИЯ (Upgrade Mode)
       * Работа с контроллером комнаты.
       */
      const target = creep.room.controller;
      if (creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
        // Рисуем синюю линию пути к контроллеру для отличия от других ролей
        creep.moveTo(target, { visualizePathStyle: { stroke: "#4b0082" } });
      }
    }
  },
};
