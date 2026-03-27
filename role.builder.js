const roleUpgrader = require("./role.upgrader");

module.exports = {
  run: function (creep) {
    // Переключатель
    // запись состояния в память
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }
    // Тумблер
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true; // Переходим к доставке энергии
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false; // Добываем
    }

    // Режим сбора

    if (!creep.memory.working) {
      const source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
      }
      // Режим стройки
    } else {
      const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
      if (targets.length > 0) {
        if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0]);
        }
      } else {
        roleUpgrader.run(creep);
      }
    }
  },
};
