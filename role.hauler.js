/**
 * ЛОГИКА ТРАНСПОРТЕРA (Hauler Role)
 */
const roleHauler = {
  /** @param {Creep} creep **/
  run: function (creep) {
    /**
     * 0. АНТИ-БЛОКИРОВКА (Уступаем место майнеру)
     */
    // Проверяем, не стоим ли мы на контейнере
    const containerUnderCreep = creep.pos
      .lookFor(LOOK_STRUCTURES)
      .find(s => s.structureType === STRUCTURE_CONTAINER);

    if (containerUnderCreep) {
      // Ищем майнера вплотную к нам
      const minerNear = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: c => c.memory.role === "test_miner",
      })[0];

      // Если майнер рядом и он ЕЩЕ НЕ на контейнере — отходим
      if (minerNear && !minerNear.pos.isEqualTo(containerUnderCreep.pos)) {
        const directions = [
          TOP,
          TOP_RIGHT,
          RIGHT,
          BOTTOM_RIGHT,
          BOTTOM,
          BOTTOM_LEFT,
          LEFT,
          TOP_LEFT,
        ];
        const randomDir =
          directions[Math.floor(Math.random() * directions.length)];
        creep.move(randomDir);
        creep.say("🚜 Уступаю!");
        return; // Пропускаем остаток тика, чтобы освободить клетку
      }
    }

    /**
     * 1. УПРАВЛЕНИЕ СОСТОЯНИЕМ
     */
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 доставка");
    }

    /**
     * 2. РЕЖИМ СБОРА
     */
    if (!creep.memory.working) {
      const sources = creep.room.find(FIND_SOURCES);
      const mySource = sources[creep.memory.sourceIndex];

      if (mySource) {
        // Приоритет 1: Энергия на земле
        const dropped = mySource.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0,
        })[0];

        if (dropped) {
          if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, {
              visualizePathStyle: { stroke: "#ffaa00" },
            });
          }
        } else {
          // Приоритет 2: Контейнер
          const targetContainer = mySource.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s =>
              s.structureType === STRUCTURE_CONTAINER &&
              s.store[RESOURCE_ENERGY] > 0,
          })[0];

          if (targetContainer) {
            if (
              creep.withdraw(targetContainer, RESOURCE_ENERGY) ===
              ERR_NOT_IN_RANGE
            ) {
              creep.moveTo(targetContainer, {
                visualizePathStyle: { stroke: "#ffaa00" },
              });
            }
          }
        }
      }
    } else {
    /**
     * 3. РЕЖИМ ДОСТАВКИ
     */
      let target = null;

      // Приоритет 1: Расширения
      target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_EXTENSION &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      // Приоритет 2: Спавн
      if (!target) {
        target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: s =>
            s.structureType === STRUCTURE_SPAWN &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
      }

      // Приоритет 3: Терминал (для продажи излишков)
      if (
        !target &&
        creep.room.terminal &&
        creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.terminal;
      }

      // Приоритет 4: Хранилище (Storage)
      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
      }

      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
    }
  },
};

module.exports = roleHauler;
