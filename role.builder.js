const roleUpgrader = require("./role.upgrader");
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
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
      const sitesInRoom = Object.values(Game.constructionSites).filter(
        s => s.pos.roomName === creep.room.name,
      );

      let target = null;
      let minRange = Infinity;
      for (let i = 0; i < sitesInRoom.length; i++) {
        const range = creep.pos.getRangeTo(sitesInRoom[i]);
        if (range < minRange) {
          minRange = range;
          target = sitesInRoom[i];
        }
      }

      if (target) {
        if (creep.build(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
      } else {
        roleUpgrader.run(creep);
      }
    }
  },
};
