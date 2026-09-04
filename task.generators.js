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

function isDuplicateTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks[TASK_TYPE]) ||
    [];

  // Резервация (reservedBy) намеренно не участвует в сравнении —
  // зарезервированная Task тоже считается существующей.
  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.targetId === candidate.targetId &&
      task.sourceId === candidate.sourceId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicatePowerSpawnPowerTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillPowerSpawnPower) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
}

function isDuplicatePowerSpawnEnergyTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillPowerSpawnEnergy) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.sourceId === candidate.sourceId &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicateFillFactoryEnergyTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillFactoryEnergy) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.sourceId === candidate.sourceId &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicateCollectFactoryBatteryTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.collectFactoryBattery) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.sourceId === candidate.sourceId &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicateFillTerminalEnergyTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillTerminalEnergy) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.sourceId === candidate.sourceId &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicateFillTerminalResourceTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillTerminalResources) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.sourceId === candidate.sourceId &&
      task.targetId === candidate.targetId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicateFillTowersTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.fillTowers) ||
    [];

  return tasks.some(
    task =>
      task.type === candidate.type &&
      task.targetId === candidate.targetId &&
      task.sourceId === candidate.sourceId &&
      task.resourceType === candidate.resourceType,
  );
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

function isDuplicateRepairTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.repairStructures) ||
    [];

  return tasks.some(task => task.targetId === candidate.targetId);
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
function isDuplicateBuildTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.buildStructures) ||
    [];

  return tasks.some(task => task.targetId === candidate.targetId);
}

function generateBuildStructures(roomState) {
  if (!TASK_CONFIG.buildStructures) return;

  const { roomName } = roomState;

  const sites = Object.values(Game.constructionSites).filter(
    site => site.pos.roomName === roomName,
  );

  for (const site of sites) {
    const candidate = {
      type: "build",
      targetId: site.id,
    };

    if (isDuplicateBuildTask(roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomName, "buildStructures", candidate);
  }
}

function isDuplicateUpgradeTask(roomName, candidate) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks.upgradeController) ||
    [];

  return tasks.some(task => task.targetId === candidate.targetId);
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
