const { TOWER } = require("./constants");

module.exports = {
  /**
   * Здесь выполняются ТОЛЬКО интенты: все цели (список врагов и лекарей,
   * раненый союзник, цель ремонта) считаются один раз на комнату в
   * room.manager.runTowerLogic. Раньше на каждую башню заново прогонялся
   * body.some(HEAL) по всем врагам и findClosestByRange — при 4 башнях
   * в комнате это N_башен × N_врагов лишних проходов за тик.
   * @param {StructureTower} tower
   * @param {Object} roomData
   *   { hostiles, healers, woundedCreep, wallTarget, damagedTarget }
   */
  run: function (tower, roomData) {
    if (!tower) return;

    // ── 1. АТАКА ─────────────────────────────────────────────────────────
    // Высший приоритет и без оглядки на запас энергии: если башня не
    // выстрелит сейчас, враг успеет снести крипов/постройки.
    const targetList =
      roomData.healers && roomData.healers.length > 0
        ? roomData.healers
        : roomData.hostiles;

    if (targetList && targetList.length > 0) {
      const closestHostile = tower.pos.findClosestByRange(targetList);

      // Башня достаёт не всю комнату: findClosestByRange вернёт ближайшего
      // даже если он за пределами дальности, и такой интент сгорит впустую
      // (ERR_NOT_IN_RANGE), заблокировав лечение и ремонт в этом тике.
      if (
        closestHostile &&
        tower.pos.inRangeTo(closestHostile, TOWER_FALLOFF_RANGE)
      ) {
        tower.attack(/** @type {Creep} */ (closestHostile));
        return;
      }
    }

    // ── 2. ЛЕЧЕНИЕ ───────────────────────────────────────────────────────
    // Обязательно ДО ремонта. Раньше лечение стояло последним — после двух
    // `return` на ремонт стен/зданий, порога энергии и `Game.time %
    // REPAIR_INTERVAL`, из-за чего не выполнялось практически никогда.
    const woundedCreep = roomData.woundedCreep;
    if (
      woundedCreep &&
      tower.pos.inRangeTo(woundedCreep, TOWER_FALLOFF_RANGE) &&
      tower.heal(woundedCreep) === OK
    ) {
      return;
    }

    // ── 3. РЕМОНТ ────────────────────────────────────────────────────────
    // Только раз в REPAIR_INTERVAL и при достаточном запасе энергии.
    // Цели ремонта приходят готовыми: они посчитаны в том же тике
    // (TOWER.WALL_SCAN_INTERVAL == TOWER.REPAIR_INTERVAL).
    if (tower.store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) return;
    if (Game.time % TOWER.REPAIR_INTERVAL !== 0) return;

    const wallTarget = roomData.wallTarget;

    // Ремонт стен и валов (самая слабая стена ниже порога)
    if (wallTarget && tower.pos.inRangeTo(wallTarget, TOWER_FALLOFF_RANGE)) {
      tower.repair(wallTarget);
      return;
    }

    // Ремонт повреждённых зданий. Проверяется и когда стена вне дальности
    // башни: раньше такой тик целиком уходил в неудачный интент по стене.
    const damagedTarget = roomData.damagedTarget;
    if (
      damagedTarget &&
      tower.pos.inRangeTo(damagedTarget, TOWER_FALLOFF_RANGE)
    ) {
      tower.repair(damagedTarget);
    }
  },
};
