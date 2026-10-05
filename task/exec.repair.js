// ===================================================
// TASK/exec.repair.js — исполнитель задач ремонта
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// isValidRepairTask — проверка задачи этого семейства.
// isDoneRepair — когда цель считается отремонтированной (пункт 3 плана:
// дороге достаточно 3 000 хитов — абсолютный порог, а не доля от максимума;
// остальным структурам — максимума).
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const energySource = require("energySource");
const { resolveTarget } = require("./exec.common");
const { REPAIR } = require("../constants");

/**
 * Порог завершения для ДОРОГИ — ОБЩИЙ с башней: `REPAIR.ROAD_DONE_HITS`
 * (constants/defense.js) = 3 000 хитов.
 *
 * Значение одно на оба инструмента ремонта: воркер закрывает задачу на нём, а
 * башня на нём же перестаёт брать дорогу целью (room/repair.js,
 * pickRepairTarget). Пока пороги были врозь, башня гнала болотную дорогу
 * (25 000 хитов) до максимума — 29 действий по 10 энергии, — тогда как воркер
 * считал её отремонтированной. Почему хиты, а не доля от максимума, и почему
 * полоса [2 000; 3 000] — в комментарии к REPAIR.
 *
 * Откат (docs/REPAIR-PLAN.md:160): `git checkout -- task/exec.repair.js`.
 */

/**
 * Цель задачи ремонта доведена до нужного состояния.
 *
 * Дороге достаточно `REPAIR.ROAD_DONE_HITS` хитов, любой другой структуре —
 * максимума хитов (прежнее поведение).
 *
 * @param {Structure} target
 * @returns {boolean}
 */
function isDoneRepair(target) {
  if (target.structureType === STRUCTURE_ROAD) {
    return target.hits >= REPAIR.ROAD_DONE_HITS;
  }

  return target.hits >= target.hitsMax;
}

function isValidRepairTask(task) {
  return !!task && task.type === "repair" && !!task.targetId;
}

function executeRepairStructures(creep, task) {
  if (!isValidRepairTask(task)) {
    return "SKIP";
  }

  const target = resolveTarget(task.targetId);

  if (!target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (isDoneRepair(target)) {
      delete creep.memory.working;
      return "DONE";
    }

    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (isDoneRepair(target)) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.repair(target);

  switch (result) {
    case OK:
      return isDoneRepair(target) ? "DONE" : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}


module.exports = {
  executeRepairStructures,
};
