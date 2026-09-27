const { TOWER } = require("./constants");

module.exports = {
  /**
   * @param {StructureTower} tower
   * @param {Object} roomData
   *   { hostiles, woundedCreep, wallsAndRamparts, damagedStructure }
   */
  run: function (tower, roomData) {
    if (!tower) return;

    // Memory.towerState убран (задание 5 плана): он дублировал флаг
    // Memory.rooms[room].underAttack и переписывался на каждую башню
    // каждый тик. Заодно ушла задержка реакции: прежнее условие
    // shouldCheckAttack пропускало атаку до TOWER.HOSTILE_CHECK_INTERVAL
    // тиков, пока флаг не проставится в предыдущем тике.
    const hostiles = roomData.hostiles;
    const hasHostiles = hostiles && hostiles.length > 0;

    if (hasHostiles) {
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
