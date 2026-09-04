const roleBuilder = require("./role.builder");
const energySource = require("energySource");

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

      for (let i = 0; i < roomState.damagedStructures.length; i++) {
        const s = roomState.damagedStructures[i];
        const range = creep.pos.getRangeTo(s);
        if (range < minRange) {
          minRange = range;
          target = s;
        }
      }

      if (target) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
      } else {
        roleBuilder.run(creep, roomState);
      }
    }
  },
};
