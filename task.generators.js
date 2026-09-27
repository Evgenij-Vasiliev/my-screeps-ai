const taskManager = require("task.manager");
const {
  POWER_SPAWN,
  STORAGE,
  FACTORY,
  TERMINAL_SUPPLY,
  TOWER,
  TASK_CONFIG,
  CONTROLLER,
} = require("./constants");

const TASK_TYPE = "fillSpawnsExtensions";

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLSPAWNS = ["type", "targetId", "sourceId", "resourceType"];

function isDuplicateTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillSpawnsExtensions", candidate, FIELDS_FILLSPAWNS);
}

function needsEnergy(target) {
  if (
    !target ||
    !target.store ||
    typeof target.store.getFreeCapacity !== "function"
  ) {
    return false;
  }

  return target.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
}

function generateFillSpawnsExtensions(roomState) {
  if (!TASK_CONFIG.fillSpawnsExtensions) return;
  const { storage, spawns, extensions } = roomState;

  if (!storage) {
    return;
  }

  const targets = spawns.concat(extensions);

  for (const target of targets) {
    if (!needsEnergy(target)) {
      continue;
    }

    const candidate = {
      type: "transfer",
      sourceId: storage.id,
      targetId: target.id,
      resourceType: RESOURCE_ENERGY,
    };

    if (isDuplicateTask(roomState.roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomState.roomName, TASK_TYPE, candidate);
  }
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_POWERSPAWNPOWER = ["type", "targetId", "resourceType"];

function isDuplicatePowerSpawnPowerTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillPowerSpawnPower", candidate, FIELDS_POWERSPAWNPOWER);
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_POWERSPAWNENERGY = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicatePowerSpawnEnergyTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillPowerSpawnEnergy", candidate, FIELDS_POWERSPAWNENERGY);
}

function generateFillPowerSpawnPower(roomState) {
  if (!TASK_CONFIG.fillPowerSpawnPower) return;
  const { powerSpawn, storage, terminal, roomName } = roomState;

  if (!powerSpawn) {
    return;
  }

  if (powerSpawn.store[RESOURCE_POWER] >= POWER_SPAWN.POWER_MIN) {
    return;
  }

  const needed = powerSpawn.store.getFreeCapacity(RESOURCE_POWER);
  if (needed <= 0) {
    return;
  }

  const storagePower = storage ? storage.store[RESOURCE_POWER] : 0;
  const terminalPower = terminal ? terminal.store[RESOURCE_POWER] : 0;

  if (storagePower + terminalPower < needed) {
    return;
  }

  const candidate = {
    type: "transfer",
    targetId: powerSpawn.id,
    resourceType: RESOURCE_POWER,
  };

  if (isDuplicatePowerSpawnPowerTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "fillPowerSpawnPower", candidate);
}

function generateFillPowerSpawnEnergy(roomState) {
  if (!TASK_CONFIG.fillPowerSpawnEnergy) return;
  const { powerSpawn, storage, roomName } = roomState;

  if (!storage) {
    return;
  }

  if (!powerSpawn) {
    return;
  }

  if (powerSpawn.store[RESOURCE_ENERGY] >= POWER_SPAWN.ENERGY_MIN) {
    return;
  }

  const needed = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);
  if (needed <= 0) {
    return;
  }

  if (storage.store[RESOURCE_ENERGY] < needed) {
    return;
  }

  const candidate = {
    type: "transfer",
    sourceId: storage.id,
    targetId: powerSpawn.id,
    resourceType: RESOURCE_ENERGY,
  };

  if (isDuplicatePowerSpawnEnergyTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "fillPowerSpawnEnergy", candidate);
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLFACTORYENERGY = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateFillFactoryEnergyTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillFactoryEnergy", candidate, FIELDS_FILLFACTORYENERGY);
}

function generateFillFactoryEnergy(roomState) {
  if (!TASK_CONFIG.fillFactoryEnergy) return;
  const { factory, storage, roomName } = roomState;

  if (!storage) {
    return;
  }

  if (!factory) {
    return;
  }

  if (factory.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    return;
  }

  const reserveThreshold =
    STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER;
  if (storage.store[RESOURCE_ENERGY] <= reserveThreshold) {
    return;
  }

  const candidate = {
    type: "transfer",
    sourceId: storage.id,
    targetId: factory.id,
    resourceType: RESOURCE_ENERGY,
  };

  if (isDuplicateFillFactoryEnergyTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "fillFactoryEnergy", candidate);
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_COLLECTFACTORYBATTERY = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateCollectFactoryBatteryTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "collectFactoryBattery", candidate, FIELDS_COLLECTFACTORYBATTERY);
}

function generateCollectFactoryBattery(roomState) {
  if (!TASK_CONFIG.collectFactoryBattery) return;
  const { factory, storage, roomName } = roomState;

  if (!storage) {
    return;
  }

  if (!factory) {
    return;
  }

  if (factory.store[RESOURCE_BATTERY] === 0) {
    return;
  }

  const candidate = {
    type: "transfer",
    sourceId: factory.id,
    targetId: storage.id,
    resourceType: RESOURCE_BATTERY,
  };

  if (isDuplicateCollectFactoryBatteryTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "collectFactoryBattery", candidate);
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLTERMINALENERGY = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateFillTerminalEnergyTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillTerminalEnergy", candidate, FIELDS_FILLTERMINALENERGY);
}

function generateFillTerminalEnergy(roomState) {
  if (!TASK_CONFIG.fillTerminalEnergy) return;
  const { storage, terminal, roomName } = roomState;

  if (!storage || !terminal) {
    return;
  }

  if (terminal.store[RESOURCE_ENERGY] >= TERMINAL_SUPPLY.ENERGY_TARGET) {
    return;
  }

  const reserveThreshold =
    STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
  if (storage.store[RESOURCE_ENERGY] <= reserveThreshold) {
    return;
  }

  const candidate = {
    type: "transfer",
    sourceId: storage.id,
    targetId: terminal.id,
    resourceType: RESOURCE_ENERGY,
  };

  if (isDuplicateFillTerminalEnergyTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "fillTerminalEnergy", candidate);
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLTERMINALRESOURCE = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateFillTerminalResourceTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillTerminalResources", candidate, FIELDS_FILLTERMINALRESOURCE);
}

function generateFillTerminalResources(roomState) {
  if (!TASK_CONFIG.fillTerminalResources) return;
  const { storage, terminal, roomName } = roomState;

  if (!storage || !terminal) {
    return;
  }

  const RESOURCE_TERMINAL_MAX = 10000;

  for (const resourceType in storage.store) {
    if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) {
      continue;
    }

    if (storage.store[resourceType] === 0) {
      continue;
    }

    const currentInTerminal = terminal.store[resourceType] || 0;
    if (currentInTerminal >= RESOURCE_TERMINAL_MAX) {
      continue;
    }

    const candidate = {
      type: "transfer",
      sourceId: storage.id,
      targetId: terminal.id,
      resourceType,
    };

    if (isDuplicateFillTerminalResourceTask(roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomName, "fillTerminalResources", candidate);
  }
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLTOWERS = ["type", "targetId", "sourceId", "resourceType"];

function isDuplicateFillTowersTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillTowers", candidate, FIELDS_FILLTOWERS);
}

function generateFillTowers(roomState) {
  if (!TASK_CONFIG.fillTowers) return;
  const { storage, towers, roomName } = roomState;

  if (!storage) {
    return;
  }

  for (const tower of towers) {
    if (tower.store[RESOURCE_ENERGY] >= TOWER.SUPPLY_THRESHOLD) {
      continue;
    }

    const candidate = {
      type: "transfer",
      sourceId: storage.id,
      targetId: tower.id,
      resourceType: RESOURCE_ENERGY,
    };

    if (isDuplicateFillTowersTask(roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomName, "fillTowers", candidate);
  }
}

const REPAIR_THRESHOLD_RATIO = 0.5;

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_REPAIR = ["targetId"];

function isDuplicateRepairTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "repairStructures", candidate, FIELDS_REPAIR);
}

function generateRepairStructures(roomState) {
  if (!TASK_CONFIG.repairStructures) return;

  const { roomName, damagedStructures } = roomState;

  for (const structure of damagedStructures) {
    if (structure.hits >= structure.hitsMax * REPAIR_THRESHOLD_RATIO) {
      continue;
    }

    const candidate = {
      type: "repair",
      targetId: structure.id,
    };

    if (isDuplicateRepairTask(roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomName, "repairStructures", candidate);
  }
}
/**
 * Множество targetId, уже стоящих в очереди задач указанного типа.
 * Собирается один раз, чтобы проверка дублей не была O(кандидаты x очередь).
 * @param {string} roomName
 * @param {string} taskType
 * @returns {Set<string>}
 */
function collectTargetIds(roomName, taskType) {
  const ids = new Set();
  const tasks =
    Memory.rooms &&
    Memory.rooms[roomName] &&
    Memory.rooms[roomName].tasks &&
    Memory.rooms[roomName].tasks[taskType];

  if (tasks) {
    for (let i = 0; i < tasks.length; i++) {
      // null — надгробие задачи, завершённой в этом тике.
      if (tasks[i]) ids.add(tasks[i].targetId);
    }
  }

  return ids;
}

function generateBuildStructures(roomState) {
  if (!TASK_CONFIG.buildStructures) return;

  const { roomName } = roomState;

  // Стройплощадки комнаты из общего индекса — без перебора всей Империи
  // на каждую комнату за тик.
  const sites = roomState.constructionSites;
  if (!sites || sites.length === 0) return;

  const existing = collectTargetIds(roomName, "buildStructures");

  for (let i = 0; i < sites.length; i++) {
    const siteId = sites[i].id;
    if (existing.has(siteId)) continue;

    taskManager.addTask(roomName, "buildStructures", {
      type: "build",
      targetId: siteId,
    });
    existing.add(siteId);
  }
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_UPGRADE = ["targetId"];

function isDuplicateUpgradeTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "upgradeController", candidate, FIELDS_UPGRADE);
}

function generateUpgradeController(roomState) {
  if (!TASK_CONFIG.upgradeController) return;

  const { controller, storage, roomName } = roomState;

  if (!controller || !storage) {
    return;
  }

  if (controller.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MIN) {
    return;
  }

  const candidate = {
    type: "upgrade",
    targetId: controller.id,
  };

  if (isDuplicateUpgradeTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "upgradeController", candidate);
}

module.exports = {
  generateFillSpawnsExtensions,
  generateFillPowerSpawnPower,
  generateFillPowerSpawnEnergy,
  generateFillFactoryEnergy,
  generateCollectFactoryBattery,
  generateFillTerminalEnergy,
  generateFillTerminalResources,
  generateFillTowers,
  generateRepairStructures,
  generateBuildStructures,
  generateUpgradeController,
};
