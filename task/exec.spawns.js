// ===================================================
// TASK/exec.spawns.js — исполнитель задач наполнения spawn и extension
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// Энергия берётся из creep.room.storage через energySource.withdrawFromStorage;
// sourceId задачи всегда указывает на storage.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const energySource = require("energySource");
const { resolveTarget, isValidTask, isTargetFull } = require("./exec.common");

function executeFillSpawnsExtensions(creep, task) {
  if (!isValidTask(task)) {
    return "SKIP";
  }

  // source (storage) здесь не резолвится: энергия берётся из creep.room.storage
  // внутри energySource.withdrawFromStorage, а sourceId всегда указывает на
  // storage (task/gen.spawns.js:133) — резолв был мёртвой проверкой.
  const target = resolveTarget(task.targetId);

  if (!target) {
    return "SKIP";
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    const withdrawn = energySource.withdrawFromStorage(creep);

    if (!withdrawn) {
      return "SKIP";
    }

    return "CONTINUE";
  }

  if (isTargetFull(target)) {
    return "DONE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return isTargetFull(target) ? "DONE" : "CONTINUE";

    case ERR_NOT_IN_RANGE:
      // TRAVELER: этот исполнитель — самый горячий у роли worker (все 5 воркеров
      // империи держат задачу именно fillSpawnsExtensions; замер shard3
      // 04.10.2026), поэтому библиотека движения подключена здесь, а не в
      // fillTowers — та стоит 8-й в TASK_CHAIN и почти не берётся (её 6 задач
      // простояли незарезервированными, пока воркеры работали на idx=0).
      // travelTo создаётся в main.js; нативный moveTo не подменён.
      // Откат: git checkout -- task.executors.js
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      return "DONE";

    case ERR_INVALID_TARGET:
      return "SKIP";

    case ERR_NOT_ENOUGH_RESOURCES:
      return "SKIP";

    default:
      return "SKIP";
  }
}


module.exports = {
  executeFillSpawnsExtensions,
};
