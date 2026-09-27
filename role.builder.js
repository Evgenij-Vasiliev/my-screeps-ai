const roleUpgrader = require("./role.upgrader");
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
      // Стройплощадки комнаты берутся из общего индекса (один проход по
      // Game.constructionSites за тик), а не перебором всей Империи на
      // каждого строителя. Ближайшую площадку ищет движок.
      const sitesInRoom = roomState.constructionSites;
      const target =
        sitesInRoom && sitesInRoom.length > 0
          ? creep.pos.findClosestByRange(sitesInRoom)
          : null;

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
