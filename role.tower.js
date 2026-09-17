const { TOWER } = require("./constants");

module.exports = {
  /**
   * @param {StructureTower} tower
   * @param {Object} roomData
   *   { hostiles, woundedCreep, wallsAndRamparts, damagedStructure }
   */
  run: function (tower, roomData) {
    if (!tower) return;

    // Глобальный кэш состояний башен (не сериализуется в Memory)
    if (!global._towerState) global._towerState = {};
    if (!global._towerState[tower.id]) global._towerState[tower.id] = {};
    const state = global._towerState[tower.id];

    const hostiles = roomData.hostiles;
    const hasHostiles = hostiles && hostiles.length > 0;

    state.underAttack = hasHostiles;

    // ── 1. АТАКА ─────────────────────────────────────────────────────────
    // Высший приоритет и без оглядки на запас энергии: если башня не
    // выстрелит сейчас, враг успеет снести крипов/постройки.
    if (hasHostiles) {
      const healers = hostiles.filter(creep =>
        creep.body.some(part => part.type === HEAL),
      );

      const closestHostile = tower.pos.findClosestByRange(
        healers.length > 0 ? healers : hostiles,
      );
      if (closestHostile) {
        tower.attack(/** @type {Creep} */ (closestHostile));
        return;
      }
    }

    // ── 2. ЛЕЧЕНИЕ ───────────────────────────────────────────────────────
    // Обязательно ДО ремонта. Раньше лечение стояло последним — после двух
    // `return` на ремонт стен/зданий, порога энергии и `Game.time %
    // REPAIR_INTERVAL`, из-за чего не выполнялось практически никогда.
    if (roomData.woundedCreep) {
      if (tower.heal(roomData.woundedCreep) === OK) return;
    }

    // ── 3. РЕМОНТ ────────────────────────────────────────────────────────
    // Только раз в REPAIR_INTERVAL и при достаточном запасе энергии.
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
    }
  },
};
