// ===================================================
// TASK/exec.factory.js — исполнители задач фабрики
// ===================================================
// Часть разбиения task.executors.js (957 строк, 04.10.2026): исполнители
// разложены по тем же семействам, что и генераторы (task/gen.*.js). Наружу их
// по-прежнему отдаёт фасад task.executors.js — имена экспортов и объект
// executors не изменились (их зовут task/runner.js:2, executor.power.test.js:81,
// role.micro.test.js:125).
//
// Два исполнителя: запас энергии фабрики и вывоз произведённых батарей.
// isValidBatteryTask — проверка задачи второго из них.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const energySource = require("energySource");
const { resolveTarget, isValidTask, isTargetFull } = require("./exec.common");

function executeFillFactoryEnergy(creep, task) {
  if (!isValidTask(task)) {
    return "SKIP";
  }

  // source не резолвится: забор идёт из creep.room.storage (см. выше).
  const target = resolveTarget(task.targetId);

  if (!target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  // Переключение фазы — читаем store только в начале тика,
  // опираясь на состояние, зафиксированное к концу ПРЕДЫДУЩЕГО тика.
  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true; // энергию набрали в прошлом тике — едем выгружать
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    // Выгрузили в прошлом тике, рюкзак пуст — условие 3: задача закончена
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    // Фаза сбора энергии
    if (isTargetFull(target)) {
      delete creep.memory.working;
      return "DONE"; // условие 1: фабрика уже полна
    }

    const withdrawn = energySource.withdrawFromStorage(creep);
    if (!withdrawn) {
      delete creep.memory.working;
      return "SKIP"; // условие 2: невыполнима — нет энергии/резерв не позволяет
    }

    return "CONTINUE";
  }

  // Фаза доставки в фабрику
  if (isTargetFull(target)) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return "CONTINUE"; // завершение определится в начале следующего тика по working+store===0

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      delete creep.memory.working;
      return "DONE";

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
function isValidBatteryTask(task) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.sourceId &&
    !!task.targetId &&
    task.resourceType === RESOURCE_BATTERY
  );
}

function executeCollectFactoryBattery(creep, task) {
  if (!isValidBatteryTask(task)) {
    return "SKIP";
  }

  // Здесь source — сама фабрика (task/gen.factory.js:83), он нужен обеим
  // фазам, поэтому резолвится сразу.
  const source = resolveTarget(task.sourceId);
  const target = resolveTarget(task.targetId);

  if (!source || !target) {
    return "SKIP";
  }

  if (creep.memory.working === undefined) {
    creep.memory.working = false;
  }

  // Переключение фазы — читаем store в начале тика, до собственных действий
  if (!creep.memory.working && creep.store[RESOURCE_BATTERY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_BATTERY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    // Фаза сбора батареек с фабрики
    if (source.store[RESOURCE_BATTERY] === 0) {
      delete creep.memory.working;
      return "DONE"; // условие 1: батареек на фабрике больше нет
    }

    if (creep.store.getFreeCapacity() === 0) {
      delete creep.memory.working;
      return "DONE"; // условие 3: рюкзак уже полон (защитный случай)
    }

    const result = creep.withdraw(source, RESOURCE_BATTERY);

    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(source);
      return "CONTINUE";
    }

    if (result === OK) {
      return "CONTINUE";
    }

    delete creep.memory.working;
    return "SKIP"; // условие 2: невыполнима
  }

  // Фаза доставки в storage
  const result = creep.transfer(target, RESOURCE_BATTERY);

  switch (result) {
    case OK:
      return "CONTINUE"; // завершение определится на входе следующего тика

    case ERR_NOT_IN_RANGE:
      creep.travelTo(target);
      return "CONTINUE";

    case ERR_FULL:
      delete creep.memory.working;
      return "SKIP"; // storage переполнен — невыполнима на этот раз

    case ERR_INVALID_TARGET:
      delete creep.memory.working;
      return "SKIP";

    default:
      delete creep.memory.working;
      return "SKIP";
  }
}


module.exports = {
  executeFillFactoryEnergy,
  executeCollectFactoryBattery,
};
