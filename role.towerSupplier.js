const energySource = require("energySource");

module.exports = {
  run: function (creep, roomState) {
    if (!creep.room.storage) return;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      energySource.withdrawFromStorage(creep);
      return;
    }

    const towers = roomState.towers;

    let tower = null;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (
          tower === null ||
          t.store[RESOURCE_ENERGY] < tower.store[RESOURCE_ENERGY]
        ) {
          tower = t;
        }
      }
    }

    if (tower) {
      if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(tower, { reusePath: 5 });
      }
      return;
    }

    if (creep.store[RESOURCE_ENERGY] > 0) {
      if (
        creep.transfer(creep.room.storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(creep.room.storage, { reusePath: 5 });
      }
    }
  },
};
