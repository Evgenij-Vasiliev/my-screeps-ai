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
   *   { hostiles, healers, woundedCreep, wallTarget, damagedTarget,
   *     repairTargets, underAttack }
   * @param {Structure} [repairTarget] цель ремонта именно этой башни
   *   (room.manager раздаёт цели из скана по одной на башню; без аргумента
   *   используется общая roomData.damagedTarget — как было раньше)
   */
  run: function (tower, roomData, repairTarget) {
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
    // Общий гейт по энергии для ОБЕИХ веток ремонта: и стены, и структуры
    // ремонтируются только при запасе выше TOWER.REPAIR_ENERGY_MIN.
    if (tower.store[RESOURCE_ENERGY] <= TOWER.REPAIR_ENERGY_MIN) return;

    const wallTarget = roomData.wallTarget;

    // Стены и валы — как раньше: одна цель на комнату и только в тик скана
    // (TOWER.WALL_SCAN_INTERVAL == TOWER.REPAIR_INTERVAL). Ветка сохраняет
    // приоритет стен и работает в том числе в бою: стену под атакой чинить надо.
    if (Game.time % TOWER.REPAIR_INTERVAL === 0) {
      // ВНИМАНИЕ: дальность башни — ГЛОБАЛЬНАЯ константа движка
      // TOWER_FALLOFF_RANGE (в TOWER из constants.js её нет: TOWER.FALLOFF_RANGE
      // === undefined, и интент не проходил бы проверку никогда).
      if (wallTarget && tower.pos.inRangeTo(wallTarget, TOWER_FALLOFF_RANGE)) {
        tower.repair(wallTarget);
        return;
      }
    }

    // Структуры и ДОРОГИ — КАЖДЫЙ тик и по СВОЕЙ цели на башню (третий
    // аргумент от room.manager.runTowerLogic; цели пересобираются каждый тик:
    // у большинства повреждённых структур дефицит меньше 800 хитов, поэтому
    // цель, выбранная раз в 15 тиков, добивалась за один интент и башня
    // простаивала до следующего скана).
    //
    // ЧТО БЫЛО НЕ ТАК (разрушение дорог E35S37). Раньше на комнату была ОДНА
    // цель `roomData.damagedTarget` и один интент ремонта за
    // TOWER.REPAIR_INTERVAL = 15 тиков на башню: все башни били в один и тот же
    // тайл (излишек над его дефицитом сгорал — действие башни стоит
    // TOWER_ENERGY_COST независимо от числа реально восстановленных хитов), а
    // остальные повреждённые тайлы ждали очереди. При сотнях дорожных тайлов
    // оборот очереди доходил до тысяч тиков, и дорога разрушалась раньше, чем до
    // неё доходили башни: ёмкости (800 хитов за действие) хватало — не хватало
    // РАСПРЕДЕЛЕНИЯ и ЧАСТОТЫ. Теперь ремонт идёт каждый тик, у каждой башни
    // свой тайл, а проверка hits < hitsMax не даёт тратить действие на уже
    // полную структуру (цель могла быть добита другой башней между сканами).
    //
    // В БОЮ ВЕТКА ОТКЛЮЧЕНА (roomData.underAttack): энергия башен нужна на атаку
    // и лечение, а ремонт дорог/зданий иначе высасывал бы её каждый тик.
    if (roomData.underAttack) return;

    const damagedTarget = repairTarget || roomData.damagedTarget;
    if (
      damagedTarget &&
      damagedTarget.hits < damagedTarget.hitsMax &&
      tower.pos.inRangeTo(damagedTarget, TOWER_FALLOFF_RANGE)
    ) {
      tower.repair(damagedTarget);
    }
  },
};
