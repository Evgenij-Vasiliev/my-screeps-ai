const roleMineralMiner = {
  run: function (creep) {
    if (!creep.memory._started) {
      console.log(`[Mineral] ${creep.memory.homeRoom} : mineralMiner started`);
      creep.memory._started = true;
    }

    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    if (
      creep.memory.working &&
      creep.store[RESOURCE_ENERGY] === 0 &&
      _.sum(creep.store) === 0
    ) {
      creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      const storage = creep.room.storage;
      if (!storage) return;

      const resourceType = Object.keys(creep.store)[0];
      if (!resourceType) return;

      if (creep.transfer(storage, resourceType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { visualize: false });
      }
      return;
    }

    const minerals = creep.room.find(FIND_MINERALS);
    if (minerals.length === 0) return;

    const mineral = minerals[0];
    const extractor = mineral.pos
      .lookFor(LOOK_STRUCTURES)
      .find(s => s.structureType === STRUCTURE_EXTRACTOR);
    if (!extractor) return;

    if (creep.harvest(mineral) === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, { visualize: false });
    }
  },
};

module.exports = roleMineralMiner;
