// ===================================================
// TASK/exec.terminal.js — исполнители задач терминала
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// Два исполнителя: запас энергии терминала и отправка накопленных ресурсов.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const energySource = require("energySource");
const econ = require("econ");
const { resolveTarget, isValidTask, isTargetFull } = require("./exec.common");

function executeFillTerminalEnergy(creep, task) {
  if (!isValidTask(task) || task.resourceType !== RESOURCE_ENERGY) {
    return "SKIP";
  }

  const target = resolveTarget(task.targetId);

  if (!target) {
    return "SKIP";
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    // source нужен только в ветке забора: у полного крипа резолв не делается.
    const source = resolveTarget(task.sourceId);
    if (!source) {
      return "SKIP";
    }

    // Терминал уже на своей доле (или в нём нет места) — задача ИСЧЕРПАНА.
    // Именно DONE, а не SKIP: при SKIP задача осталась бы в очереди навсегда
    // (генератор новую не поставит, а исполнитель каждый раз отказывался бы),
    // и очередь засорялась бы зомби. Проверка та же, что у генератора
    // (econ.canFillTerminal), но разложенная на два исхода.
    if (econ.terminalReachedShare(source, target)) {
      return "DONE";
    }

    // Свободных средств склада пока не хватает на полный рейс — это ПАУЗА:
    // склад наполнится, и задача снова станет исполнимой.
    if (!econ.hasFreeForTransfer(source, creep.room.name)) {
      return "SKIP";
    }

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

function executeFillTerminalResources(creep, task) {
  if (
    !task ||
    task.type !== "transfer" ||
    !task.sourceId ||
    !task.targetId ||
    !task.resourceType
  ) {
    return "SKIP";
  }

  const target = resolveTarget(task.targetId);

  if (!target) {
    return "SKIP";
  }

  const resourceType = task.resourceType;

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[resourceType] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[resourceType] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (target.store.getFreeCapacity(resourceType) === 0) {
      delete creep.memory.working;
      return "DONE";
    }

    // source нужен только в ветке забора (см. executeFillTerminalEnergy).
    const source = resolveTarget(task.sourceId);
    if (!source) {
      delete creep.memory.working;
      return "SKIP";
    }

    const result = creep.withdraw(source, resourceType);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(source);
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP";
  }

  if (target.store.getFreeCapacity(resourceType) === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.transfer(target, resourceType);

  if (result === ERR_NOT_IN_RANGE) {
    creep.travelTo(target);
    return "CONTINUE";
  }

  if (result === OK) {
    return "CONTINUE";
  }

  if (result === ERR_FULL) {
    delete creep.memory.working;
    return "DONE";
  }

  delete creep.memory.working;
  return "SKIP";
}


module.exports = {
  executeFillTerminalEnergy,
  executeFillTerminalResources,
};
