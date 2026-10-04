// ===================================================
// TASK/exec.powerSpawn.js — исполнители задач PowerSpawn
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// withdrawPower и isValidPowerSpawnTask живут здесь же: их единственные потребители —
// два исполнителя этого семейства.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const { resolveTarget } = require("./exec.common");

function withdrawPower(creep) {
  const storage = creep.room.storage;
  const terminal = creep.room.terminal;

  if (storage && storage.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(storage, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(storage);
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  if (terminal && terminal.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(terminal, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(terminal);
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  return false;
}

function isValidPowerSpawnTask(task, resourceType) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.targetId &&
    task.resourceType === resourceType
  );
}

function executeFillPowerSpawnPower(creep, task) {
  if (!isValidPowerSpawnTask(task, RESOURCE_POWER)) {
    return "SKIP";
  }

  const target = resolveTarget(task.targetId);
  if (!target) {
    return "SKIP";
  }

  const storage = creep.room.storage;

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store[RESOURCE_POWER] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_POWER] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  const targetFull = target.store.getFreeCapacity(RESOURCE_POWER) === 0;

  if (!creep.memory.working) {
    if (targetFull) {
      delete creep.memory.working;
      return "DONE";
    }

    return withdrawPower(creep) ? "CONTINUE" : "SKIP";
  }

  if (!targetFull) {
    const result = creep.transfer(target, RESOURCE_POWER);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(target);
      return "CONTINUE";
    }

    if (result === OK || result === ERR_FULL) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP";
  }

  // Target полон, но рюкзак ещё не пуст — сбрасываем обратно в storage
  if (!storage) {
    delete creep.memory.working;
    return "SKIP";
  }

  const dropResult = creep.transfer(storage, RESOURCE_POWER);

  if (dropResult === ERR_NOT_IN_RANGE) {
    creep.travelTo(storage);
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return "CONTINUE";
  }

  delete creep.memory.working;
  return "SKIP";
}

function executeFillPowerSpawnEnergy(creep, task) {
  if (!isValidPowerSpawnTask(task, RESOURCE_ENERGY) || !task.sourceId) {
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

  const targetFull = target.store.getFreeCapacity(RESOURCE_ENERGY) === 0;

  // source нужен только двум веткам: забору (ниже) и обратному сбросу при
  // полном target. Резолвится по факту нужды, а не заранее: крип, который
  // просто везёт энергию в неполный powerSpawn, не платит за него вовсе.
  let source = null;

  if (!creep.memory.working) {
    if (targetFull) {
      delete creep.memory.working;
      return "DONE";
    }

    source = resolveTarget(task.sourceId);
    if (!source) {
      delete creep.memory.working;
      return "SKIP";
    }

    const result = creep.withdraw(source, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(source);
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "DONE";
  }

  if (!targetFull) {
    const result = creep.transfer(target, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(target);
      return "CONTINUE";
    }

    if (result === OK || result === ERR_FULL) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP";
  }

  // Target полон, но рюкзак ещё не пуст — сбрасываем обратно в source (storage).
  // Здесь source может быть ещё не резолвлен: фаза забора выше не исполнялась
  // (крип вошёл уже с грузом), поэтому резолвим его тут, по факту нужды.
  const dropTarget = source || resolveTarget(task.sourceId);

  if (!dropTarget) {
    delete creep.memory.working;
    return "SKIP";
  }

  const dropResult = creep.transfer(dropTarget, RESOURCE_ENERGY);

  if (dropResult === ERR_NOT_IN_RANGE) {
    creep.travelTo(dropTarget);
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return "CONTINUE";
  }

  delete creep.memory.working;
  return "SKIP";
}


module.exports = {
  executeFillPowerSpawnPower,
  executeFillPowerSpawnEnergy,
};
