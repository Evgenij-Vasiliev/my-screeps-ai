const roleMineralMiner = {
  run: function (creep) {
    if (!creep.memory._started) {
      console.log(`[Mineral] ${creep.memory.homeRoom} : mineralMiner started`);
      creep.memory._started = true;
    }

    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    if (creep.memory.working && _.sum(creep.store) === 0) {
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

      const transferResult = creep.transfer(storage, resourceType);
      if (transferResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { visualize: false });
      } else if (transferResult !== OK) {
        console.log(
          `[Mineral] ${creep.name} : transfer() вернул ошибку ${transferResult}`,
        );
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

    const harvestResult = creep.harvest(mineral);
    if (harvestResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, { visualize: false });
    } else if (harvestResult !== OK) {
      // console.log(
      //   `[Mineral] ${creep.name} : harvest() вернул ошибку ${harvestResult}`,
      // );
    }
  },
};

module.exports = roleMineralMiner;
