const energySource = require("energySource");
const { STORAGE, TERMINAL_SUPPLY, CONTROLLER, MOVE } = require("./constants");

/**
 * ШАГ 3 ПЛАНА (ленивый резолв целей): повторяющиеся в одном тике id берём из
 * per-room кэша объектов в heap с ключом Game.time.
 *
 * Замер на живом шарде (shard3, Game.time 83294987, docs/resolve-measure.json):
 *   Game.getObjectById по прогретому id — 0.000094 CPU на вызов,
 *   повторный вызов того же id в том же тике — 0.000047 CPU,
 *   по несуществующему id — 0.000141 CPU,
 *   проверка кэша (tick + byId + hasOwnProperty) — 0.000088 + 0.000052 CPU.
 *
 * Кэш живёт один тик (объекты Game пересобираются каждый тик, хранить их
 * дольше нельзя), поэтому объект в heap один, а не по комнате на каждый id:
 * платить за индексацию было бы дороже, чем сэкономить.
 *
 * Откат шага 3: git checkout -- task.executors.js
 */
let resolveCache = null;

function resolveTarget(id) {
  if (!id) {
    return null;
  }

  const tick = Game.time;

  if (!resolveCache || resolveCache.tick !== tick) {
    resolveCache = { tick: tick, byId: {} };
  }

  if (Object.prototype.hasOwnProperty.call(resolveCache.byId, id)) {
    return resolveCache.byId[id];
  }

  const target = Game.getObjectById(id);
  resolveCache.byId[id] = target;
  return target;
}

function withdrawPower(creep) {
  const storage = creep.room.storage;
  const terminal = creep.room.terminal;

  if (storage && storage.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(storage, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: MOVE.STABLE });
    }
    return result === OK || result === ERR_NOT_IN_RANGE;
  }

  if (terminal && terminal.store[RESOURCE_POWER] > 0) {
    const result = creep.withdraw(terminal, RESOURCE_POWER);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(terminal, { reusePath: MOVE.STABLE });
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

function isValidTask(task) {
  return (
    !!task &&
    task.type === "transfer" &&
    !!task.sourceId &&
    !!task.targetId &&
    task.resourceType === RESOURCE_ENERGY
  );
}

function isTargetFull(target) {
  if (
    target &&
    target.store &&
    typeof target.store.getFreeCapacity === "function"
  ) {
    return target.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
  }
  return false;
}

function executeFillSpawnsExtensions(creep, task) {
  if (!isValidTask(task)) {
    return "SKIP";
  }

  // source (storage) здесь не резолвится: энергия берётся из creep.room.storage
  // внутри energySource.withdrawFromStorage, а sourceId всегда указывает на
  // storage (task.generators.js:50) — резолв был мёртвой проверкой.
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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

  // Здесь source — сама фабрика (task.generators.js:221), он нужен обеим
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
      creep.moveTo(source, { reusePath: MOVE.STABLE });
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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

function executeFillTowers(creep, task) {
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

  if (!creep.memory.working && creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
  } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    delete creep.memory.working;
    return "DONE";
  }

  if (!creep.memory.working) {
    if (isTargetFull(target)) {
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

  if (isTargetFull(target)) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);

  switch (result) {
    case OK:
      return "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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

    const reserveThreshold =
      STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
    if (source.store[RESOURCE_ENERGY] <= reserveThreshold) {
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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
      creep.moveTo(source, { reusePath: MOVE.STABLE });
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
    creep.moveTo(target, { reusePath: MOVE.NORMAL });
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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
    creep.moveTo(storage, { reusePath: MOVE.STABLE });
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
      creep.moveTo(source, { reusePath: MOVE.STABLE });
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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
    creep.moveTo(dropTarget, { reusePath: MOVE.STABLE });
    return "CONTINUE";
  }

  if (dropResult === OK) {
    return "CONTINUE";
  }

  delete creep.memory.working;
  return "SKIP";
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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
      creep.moveTo(target, { reusePath: MOVE.NORMAL });
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

function isValidUpgradeTask(task) {
  return !!task && task.type === "upgrade" && !!task.targetId;
}

function executeUpgradeController(creep, task) {
  if (!isValidUpgradeTask(task)) {
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
    if (target.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MAX) {
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

  if (target.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MAX) {
    delete creep.memory.working;
    return "DONE";
  }

  const result = creep.upgradeController(target);

  switch (result) {
    case OK:
      return "CONTINUE";

    case ERR_NOT_IN_RANGE:
      creep.moveTo(target, { reusePath: MOVE.VOLATILE });
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
  executeFillSpawnsExtensions,
  executeFillFactoryEnergy,
  executeFillTowers,
  executeFillPowerSpawnPower,
  executeFillPowerSpawnEnergy,
  executors: {
    fillSpawnsExtensions: executeFillSpawnsExtensions,
    fillTerminalEnergy: executeFillTerminalEnergy,
    fillTerminalResources: executeFillTerminalResources,
    fillPowerSpawnPower: executeFillPowerSpawnPower,
    fillPowerSpawnEnergy: executeFillPowerSpawnEnergy,
    fillFactoryEnergy: executeFillFactoryEnergy,
    collectFactoryBattery: executeCollectFactoryBattery,
    fillTowers: executeFillTowers,
    repairStructures: executeRepairStructures,
    buildStructures: executeBuildStructures,
    upgradeController: executeUpgradeController,
  },
};
