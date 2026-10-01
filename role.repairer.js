const roleBuilder = require("./role.builder");
const energySource = require("energySource");
const { MOVE } = require("./constants");

/**
 * Список повреждённых структур комнаты.
 *
 * roomState.damagedStructures — ленивый геттер (room.manager.js): список
 * собирается по факту обращения, потому что башни читают его раз в
 * TOWER.REPAIR_INTERVAL тиков. Роль repairer сейчас не спавнится
 * (SPAWN_QUOTA.repairer = 0, constants.js:88), так что в бою этот путь не
 * исполняется. Обращение через само поле (а не через require room.manager)
 * нужно и здесь: циклический require уронил бы загрузку модулей на шарде.
 */
function damagedList(roomState) {
  return roomState.damagedStructures || [];
}

module.exports = {
  run: function (creep, roomState) {
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false;
    }

    if (!creep.memory.working) {
      energySource.withdrawFromStorage(creep);
    } else {
      let target = null;
      let minRange = Infinity;

      const damaged = damagedList(roomState);

      for (let i = 0; i < damaged.length; i++) {
        const s = damaged[i];
        const range = creep.pos.getRangeTo(s);
        if (range < minRange) {
          minRange = range;
          target = s;
        }
      }

      if (target) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { reusePath: MOVE.VOLATILE });
        }
      } else {
        roleBuilder.run(creep, roomState);
      }
    }
  },
};
