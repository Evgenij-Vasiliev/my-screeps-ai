const { TOWER } = require("./constants");

module.exports = {
  /**
   * @param {StructureTower} tower
   * @param {Object} roomData — общие для всех башен комнаты данные,
   *   собраны один раз в roomManager.runTowerLogic (оптимизация CPU:
   *   без этого каждая башня заново искала бы то же самое).
   *   { hostiles, woundedCreep, wallsAndRamparts, damagedStructure }
   */
  run: function (tower, roomData) {
    if (!tower) return;

    // Атака вражеских крипов
    const closestHostile = tower.pos.findClosestByRange(roomData.hostiles);
    if (closestHostile) {
      tower.attack(closestHostile);
      return;
    }

    if (tower.store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) return;
    if (Game.time % TOWER.REPAIR_INTERVAL !== 0) return;

    // Ремонт стен и валов (список уже отсортирован по возрастанию hits)
    if (roomData.wallsAndRamparts && roomData.wallsAndRamparts.length > 0) {
      tower.repair(roomData.wallsAndRamparts[0]);
      return;
    }

    // Ремонт самого повреждённого здания (кроме стен и валов)
    if (roomData.damagedStructure) {
      tower.repair(roomData.damagedStructure);
      return;
    }

    // Лечение раненых союзников
    if (roomData.woundedCreep) {
      tower.heal(roomData.woundedCreep);
    }
  },
};
