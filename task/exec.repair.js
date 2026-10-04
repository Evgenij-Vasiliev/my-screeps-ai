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
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const energySource = require("energySource");
const { resolveTarget } = require("./exec.common");

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
    if (target.hits >= target.hitsMax) {
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

  if (target.hits >= target.hitsMax) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.repair(target);

  switch (result) {
    case OK:
      return target.hits >= target.hitsMax ? "DONE" : "CONTINUE";

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
