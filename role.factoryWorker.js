/**
 * ===================================================
 * ROLE.FACTORYWORKER.JS — Рабочий фабрики
 * ===================================================
 * VERSION: 4.2
 *
 * Состояния:
 * getEnergy   — берём энергию из storage
 * toFactory   — несём энергию на фабрику, выгружаем
 * getBattery  — забираем батарейки с фабрики
 * toStorage   — везём батарейки в storage, выгружаем
 *
 * Переход в следующее состояние происходит ТОЛЬКО при OK.
 * Любая другая ошибка (ERR_NOT_ENOUGH_RESOURCES, ERR_FULL,
 * ERR_INVALID_TARGET и т.п.) не двигает state — попытка
 * просто повторится на следующем тике.
 *
 * Фикс v4.2: в getBattery, если батареек ещё нет, крип не стоит
 * вхолостую вечно — если энергии на фабрике не хватает на цикл
 * производства (< 600), крип идёт подвозить ещё, разрывая дедлок
 * "жду батарейку, которая никогда не появится".
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    const storage = creep.room.storage;
    const factory = creep.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY,
    })[0];

    if (!storage || !factory) return;

    if (!creep.memory.state) creep.memory.state = "getEnergy";

    switch (creep.memory.state) {
      case "getEnergy": {
        const r = creep.withdraw(storage, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        } else if (r === OK) {
          creep.memory.state = "toFactory";
        }
        break;
      }

      case "toFactory": {
        const r = creep.transfer(factory, RESOURCE_ENERGY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(factory, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        } else if (r === OK) {
          creep.memory.state = "getBattery";
        }
        break;
      }

      case "getBattery": {
        if (factory.store[RESOURCE_BATTERY] === 0) {
          if (factory.store[RESOURCE_ENERGY] < 600) {
            // батареек нет и на цикл производства не хватает энергии —
            // вместо вечного ожидания идём подвозить ещё
            creep.memory.state = "getEnergy";
          }
          return;
        }
        const r = creep.withdraw(factory, RESOURCE_BATTERY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(factory, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        } else if (r === OK) {
          creep.memory.state = "toStorage";
        }
        break;
      }

      case "toStorage": {
        const r = creep.transfer(storage, RESOURCE_BATTERY);
        if (r === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        } else if (r === OK) {
          creep.memory.state = "getEnergy";
        }
        break;
      }
    }
  },
};
