const taskManager = require("task.manager");
const {
  POWER_SPAWN,
  STORAGE,
  FACTORY,
  TERMINAL_SUPPLY,
  TOWER,
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
  const { storage, terminal, roomName } = roomState;

  if (!storage || !terminal) {
    return;
  }

  if (terminal.store[RESOURCE_ENERGY] >= TERMINAL_SUPPLY.ENERGY_MIN) {
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

function collectRepairCandidates(roomState) {
  const {
    spawns,
    towers,
    extensions,
    links,
    labs,
    roads,
    factory,
    powerSpawn,
    storage,
    terminal,
    observer,
    extractor,
    nuker,
  } = roomState;

  const all = []
    .concat(spawns)
    .concat(towers)
    .concat(extensions)
    .concat(links)
    .concat(labs)
    .concat(roads);

  if (factory) all.push(factory);
  if (powerSpawn) all.push(powerSpawn);
  if (storage) all.push(storage);
  if (terminal) all.push(terminal);
  if (observer) all.push(observer);
  if (extractor) all.push(extractor);
  if (nuker) all.push(nuker);

  return all;
}

function generateRepairStructures(roomState) {
  const { roomName } = roomState;

  const candidates = collectRepairCandidates(roomState);

  for (const structure of candidates) {
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
};
