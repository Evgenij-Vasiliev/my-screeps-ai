const roleMineralMiner = {
  run: function (creep, roomState) {
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
        creep.moveTo(storage, { reusePath: 50, visualize: false });
      } else if (transferResult !== OK) {
        console.log(
          `[Mineral] ${creep.name} : transfer() вернул ошибку ${transferResult}`,
        );
      }
      return;
    }

    if (!roomState.mineral || !roomState.mineral.id) return;

    const mineral = Game.getObjectById(roomState.mineral.id);
    if (!mineral || !roomState.mineral.extractorId) return;

    const harvestResult = creep.harvest(mineral);
    if (harvestResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, { reusePath: 50, visualize: false });
    } else if (harvestResult !== OK) {
      // console.log(...)
    }
  },
};

module.exports = roleMineralMiner;
