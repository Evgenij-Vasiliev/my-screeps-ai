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
    //
    // Приоритет лекарей сохраняется, но только пока лекарь ДОСТАЁТ башней:
    // findClosestByRange вернёт ближайшего даже за пределами дальности, и
    // раньше один лекарь вне TOWER_FALLOFF_RANGE вообще блокировал атаку —
    // интент по нему сгорал (ERR_NOT_IN_RANGE), а до других доступных
    // врагов дело не доходило. Теперь цель выбирается ТОЛЬКО из врагов в
    // зоне поражения: сначала лекарь в зоне, иначе любой враг в зоне.
    const reachableHealers =
      roomData.healers && roomData.healers.length > 0
        ? tower.pos.findInRange(roomData.healers, TOWER_FALLOFF_RANGE)
        : [];

    let attackTarget =
      reachableHealers.length > 0
        ? tower.pos.findClosestByRange(reachableHealers)
        : null;

    if (!attackTarget && roomData.hostiles && roomData.hostiles.length > 0) {
      const reachableHostiles = tower.pos.findInRange(
        roomData.hostiles,
        TOWER_FALLOFF_RANGE,
      );

      // Башня достаёт не всю комнату: интент по врагу за пределами дальности
      // сгорел бы впустую (ERR_NOT_IN_RANGE), заблокировав лечение и ремонт.
      if (reachableHostiles.length > 0) {
        attackTarget = tower.pos.findClosestByRange(reachableHostiles);
      }
    }

    if (attackTarget) {
      tower.attack(/** @type {Creep} */ (attackTarget));
      return;
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
