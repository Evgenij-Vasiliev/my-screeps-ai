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
      const withdrewFromStorage = energySource.withdrawFromStorage(creep, true);

      if (withdrewFromStorage) {
        return;
      }

      const terminal = creep.room.terminal;

      if (terminal && terminal.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, { reusePath: 15 });
        }
        return;
      }

      let source = null;
      let minRange = Infinity;
      for (let i = 0; i < roomState.sources.length; i++) {
        const s = roomState.sources[i];
        if (s.energy > 0) {
          const range = creep.pos.getRangeTo(s);
          if (range < minRange) {
            minRange = range;
            source = s;
          }
        }
      }

      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { reusePath: 15 });
        }
      }

      return;
    }

    let target = null;
    let minRange = Infinity;

    for (let i = 0; i < roomState.extensions.length; i++) {
      const s = roomState.extensions[i];
      if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        const range = creep.pos.getRangeTo(s);
        if (range < minRange) {
          minRange = range;
          target = s;
        }
      }
    }

    if (!target) {
      minRange = Infinity;
      for (let i = 0; i < roomState.spawns.length; i++) {
        const s = roomState.spawns[i];
        if (s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
          const range = creep.pos.getRangeTo(s);
          if (range < minRange) {
            minRange = range;
            target = s;
          }
        }
      }
    }

    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    }
  },
};
