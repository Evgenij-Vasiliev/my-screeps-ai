/**
 * ===================================================
 * ROLE.FACTORYWORKER.JS — Рабочий фабрики
 * ===================================================
 * VERSION: 4.0
 *
 * Состояния:
 * getEnergy   — берём энергию из storage
 * toFactory   — несём энергию на фабрику, выгружаем
 * getBattery  — забираем батарейки с фабрики
 * toStorage   — везём батарейки в storage, выгружаем
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
      case "getEnergy":
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        } else {
          creep.memory.state = "toFactory";
        }
        break;

      case "toFactory":
        if (creep.transfer(factory, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(factory, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        } else {
          creep.memory.state = "getBattery";
        }
        break;

      case "getBattery":
        if (factory.store[RESOURCE_BATTERY] === 0) return;
        if (creep.withdraw(factory, RESOURCE_BATTERY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(factory, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        } else {
          creep.memory.state = "toStorage";
        }
        break;

      case "toStorage":
        if (creep.transfer(storage, RESOURCE_BATTERY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        } else {
          creep.memory.state = "getEnergy";
        }
        break;
    }
  },
};
