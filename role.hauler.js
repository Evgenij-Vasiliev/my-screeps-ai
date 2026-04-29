const roleHauler = {
  run: function (creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 везу");
    }

    if (!creep.memory.working) {
      const sources = creep.room._sources || creep.room.find(FIND_SOURCES);
      const containers = creep.room._sourceContainers || [];

      const mySource = sources[creep.memory.sourceIndex] || sources[0];
      const myContainer = containers[creep.memory.sourceIndex] || null;

      if (!mySource) {
        creep.say("❓ нет источника");
        return;
      }

      const dropped = mySource.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      })[0];

      if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
          creep.moveTo(dropped, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      if (myContainer && myContainer.store[RESOURCE_ENERGY] > 50) {
        if (creep.withdraw(myContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(myContainer, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      creep.say("⏳ жду");
    } else {
      let target = null;

      const spawnTargets = creep.room._energyTargets;
      if (spawnTargets && spawnTargets.length > 0) {
        target = creep.pos.findClosestByRange(spawnTargets);
      }

      if (
        !target &&
        creep.room.storage &&
        creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        target = creep.room.storage;
      }

      // Терминал заполняем только если storage достаточно заполнен
      const terminalTarget = creep.room.memory.terminalEnergyTarget || 10000;
      const storageEnough =
        creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 50000;

      if (
        !target &&
        storageEnough &&
        creep.room.terminal &&
        creep.room.terminal.store[RESOURCE_ENERGY] < terminalTarget
      ) {
        target = creep.room.terminal;
      }

      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
      } else {
        creep.say("😴 всё полно");
      }
    }
  },
};

module.exports = roleHauler;
