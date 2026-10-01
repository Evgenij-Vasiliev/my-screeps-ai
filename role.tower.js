const { TOWER } = require("./constants");

module.exports = {
  /**
   * @param {StructureTower} tower
   * @param {Object} roomData
   *   { hostiles, woundedCreep, repairTarget, repairTowerId, canRepair }
   *   canRepair — тик ремонта ЭТОЙ комнаты (room.manager.isTowerRepairTick).
   *   repairTarget / repairTowerId — одна цель на комнату и одна башня под неё
   *   (room.manager.pickRepairTarget): интент стоит 0.2 CPU, поэтому 16 башен
   *   по одной цели (пик 4.5031 CPU раз в 15 тиков, замер 29.09.2026) заменены
   *   на одно действие ближайшей башней.
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

    if (roomData.canRepair !== true) return;
    if (tower.store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) return;

    // Ремонт: цель и башня выбраны уровнем комнаты (room.manager.pickRepairTarget
    // и isTowerRepairTick). Бьёт ТОЛЬКО выбранная башня — ближайшая к цели;
    // остальные в этот тик не тратят интент (0.2 CPU каждая). Стены в цели не
    // попадают вовсе: они не распадаются (см. комментарий в room.manager.js).
    if (roomData.repairTarget) {
      if (tower.id === roomData.repairTowerId) {
        tower.repair(roomData.repairTarget);
      }
      return;
    }

    // Лечение союзников
    if (roomData.woundedCreep) {
      tower.heal(roomData.woundedCreep);
    }
  },
};
