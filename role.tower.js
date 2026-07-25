const { TOWER } = require("./constants");

module.exports = {
  run: function (tower) {
    if (!tower) return;

    // Атака вражеских крипов
    const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (closestHostile) {
      tower.attack(closestHostile);
      return;
    }

    if (tower.store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) return;
    if (Game.time % TOWER.REPAIR_INTERVAL !== 0) return;

    // Ремонт стен и валов с пошаговым увеличением прочности
    const wallThreshold =
      tower.room.memory.wallThreshold || TOWER.WALL_THRESHOLD_DEFAULT;
    const wallsAndRamparts = tower.room.find(FIND_STRUCTURES, {
      filter: structure =>
        (structure.structureType === STRUCTURE_WALL ||
          structure.structureType === STRUCTURE_RAMPART) &&
        structure.hits < wallThreshold,
    });

    if (wallsAndRamparts.length > 0) {
      wallsAndRamparts.sort((a, b) => a.hits - b.hits);
      tower.repair(wallsAndRamparts[0]);
      return;
    } else {
      tower.room.memory.wallThreshold =
        wallThreshold + TOWER.WALL_THRESHOLD_STEP;
    }

    // Ремонт самого повреждённого здания (кроме стен и валов)
    const damagedStructure = tower.room
      .find(FIND_STRUCTURES, {
        filter: structure =>
          structure.hits < structure.hitsMax &&
          structure.structureType !== STRUCTURE_WALL &&
          structure.structureType !== STRUCTURE_RAMPART,
      })
      .sort((a, b) => a.hits - b.hits)[0];

    if (damagedStructure) {
      tower.repair(damagedStructure);
      return;
    }

    // Лечение раненых союзников
    const woundedCreep = tower.room.find(FIND_MY_CREEPS, {
      filter: creep => creep.hits < creep.hitsMax,
    })[0];

    if (woundedCreep) {
      tower.heal(woundedCreep);
    }
  },
};
