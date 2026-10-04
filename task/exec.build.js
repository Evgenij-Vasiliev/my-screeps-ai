// ===================================================
// TASK/exec.build.js — исполнитель задач стройки
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// isValidBuildTask — проверка задачи этого семейства.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const energySource = require("energySource");
const { resolveTarget } = require("./exec.common");

function isValidBuildTask(task) {
  return !!task && task.type === "build" && !!task.targetId;
}

function executeBuildStructures(creep, task) {
  if (!isValidBuildTask(task)) {
    return "SKIP";
  }

  const target = resolveTarget(task.targetId);

  if (!target) {
    // Стройплощадка исчезла — значит либо достроена, либо снесена.
    // В любом случае задача больше не актуальна.
    return "DONE";
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
    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP";
    }

    return "CONTINUE";
  }

  const result = creep.build(target);

  switch (result) {
    case OK:
      return "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "DONE"; // стройплощадка, вероятно, уже достроена

    case ERR_NOT_ENOUGH_RESOURCES:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}


module.exports = {
  executeBuildStructures,
};
