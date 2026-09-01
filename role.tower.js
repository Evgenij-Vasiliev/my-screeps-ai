const { TOWER } = require("./constants");

module.exports = {
  /**
   * @param {StructureTower} tower
   * @param {Object} roomData
   *   { hostiles, woundedCreep, wallsAndRamparts, damagedStructure }
   */
  run: function (tower, roomData) {
    if (!tower) return;

    if (!Memory.towerState) Memory.towerState = {};
    if (!Memory.towerState[tower.id]) Memory.towerState[tower.id] = {};
    const state = Memory.towerState[tower.id];

    const hostiles = roomData.hostiles;
    const hasHostiles = hostiles && hostiles.length > 0;

    state.underAttack = hasHostiles;

    const shouldCheckAttack =
      state.underAttack || Game.time % TOWER.HOSTILE_CHECK_INTERVAL === 0;

    if (hasHostiles && shouldCheckAttack) {
      const closestHostile = tower.pos.findClosestByRange(hostiles);
      if (closestHostile) {
        tower.attack(closestHostile);
        return;
      }
    }

    if (tower.store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) return;
    if (Game.time % TOWER.REPAIR_INTERVAL !== 0) return;

    const wallsAndRamparts = roomData.wallsAndRamparts;

    // Ремонт стен и валов
    if (wallsAndRamparts && wallsAndRamparts.length > 0) {
      tower.repair(wallsAndRamparts[0]);
      return;
    }

    // Ремонт повреждённых зданий
    if (roomData.damagedStructure) {
      tower.repair(roomData.damagedStructure);
      return;
    }

    // Лечение союзников
    if (roomData.woundedCreep) {
      tower.heal(roomData.woundedCreep);
    }
  },
};
