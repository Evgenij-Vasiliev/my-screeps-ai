const taskManager = require("task.manager");
const {
  POWER_SPAWN,
  STORAGE,
  FACTORY,
  TERMINAL_SUPPLY,
  TOWER,
  TASK_CONFIG,
  TASK_GEN_INTERVAL,
  TASK_GEN_INTERVAL_DEFAULT,
  CONTROLLER,
} = require("./constants");

const TASK_TYPE = "fillSpawnsExtensions";

// ── ДЕДУП ОДНИМ ПРОХОДОМ (ТЗ №1, P5) ────────────────────────────────────
// Идентичность Task = `taskType|targetId|resourceType` (§6 фундамента: sourceId
// в идентичность не входит). Внутри каждой категории type/sourceId/resourceType
// постоянны, поэтому новый ключ даёт те же решения, что прежние 11
// `isDuplicate*` (мок-тест 1.6), но убирает проход по очереди на каждую цель:
// ключи собираются одним проходом на вызов генератора.

/**
 * Ключ идентичности Task.
 * @param {string} taskType
 * @param {Object} candidate
 * @returns {string}
 */
function identityKey(taskType, candidate) {
  return taskType + "|" + candidate.targetId + "|" + candidate.resourceType;
}

/**
 * Один проход по очереди категории: ключи уже существующих Task.
 * Зарезервированная (reservedBy) Task тоже считается существующей.
 * @param {string} roomName
 * @param {string} taskType
 * @returns {Object<string, number>}
 */
function existingKeys(roomName, taskType) {
  const tasks =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].tasks &&
      Memory.rooms[roomName].tasks[taskType]) ||
    [];
  const keys = /** @type {Object<string, number>} */ ({});
  for (let i = 0; i < tasks.length; i++) {
    keys[identityKey(taskType, tasks[i])] = 1;
  }
  return keys;
}

/**
 * Есть ли уже Task на эту цель (дешёвая проверка до чтения состояния цели).
 * @param {string} taskType
 * @param {string} targetId
 * @param {string} resourceType
 * @param {Object<string, number>} keys
 * @returns {boolean}
 */
function hasTaskFor(taskType, targetId, resourceType, keys) {
  return keys[taskType + "|" + targetId + "|" + resourceType] === 1;
}

/**
 * Создаёт Task, только если такой ещё нет в очереди (по ключу идентичности).
 * @param {string} roomName
 * @param {string} taskType
 * @param {Object} candidate
 * @param {Object<string, number>} keys
 * @returns {boolean} создана ли Task
 */
function addIfNew(roomName, taskType, candidate, keys) {
  const key = identityKey(taskType, candidate);
  if (keys[key]) return false;
  keys[key] = 1;
  return taskManager.addTask(roomName, taskType, candidate);
}

function generateFillSpawnsExtensions(roomState) {
  if (!TASK_CONFIG.fillSpawnsExtensions) return;
  const { storage, spawns, extensions, roomName } = roomState;

  if (!storage) return;

  const keys = existingKeys(roomName, TASK_TYPE);
  const storageId = storage.id;
  // Два прохода без concat (аллокация массива на каждый вызов): цели, на
  // которые Task уже есть, отсекаются до чтения их состояния.
  for (let i = 0; i < spawns.length; i++) {
    fillSpawnTarget(roomName, storageId, spawns[i], keys);
  }
  for (let i = 0; i < extensions.length; i++) {
    fillSpawnTarget(roomName, storageId, extensions[i], keys);
  }
}

/**
 * Одна цель fillSpawnsExtensions: пропустить, если Task уже есть или цель полна.
 * Для спавнов/расширений `energy`/`energyCapacity` — прямые свойства структуры
 * (без создания объекта Store): консольный A/B на 49 целях дал 8.13 мкс против
 * 15.44 у `store.getFreeCapacity` и 19.70 у прежней проверки с typeof.
 * @param {string} roomName
 * @param {string} storageId
 * @param {Object} target
 * @param {Object<string, number>} keys
 */
function fillSpawnTarget(roomName, storageId, target, keys) {
  if (hasTaskFor(TASK_TYPE, target.id, RESOURCE_ENERGY, keys)) return;
  if (target.energy >= target.energyCapacity) return;

  addIfNew(
    roomName,
    TASK_TYPE,
    {
      type: "transfer",
      sourceId: storageId,
      targetId: target.id,
      resourceType: RESOURCE_ENERGY,
    },
    keys,
  );
}

function generateFillPowerSpawnPower(roomState) {
  if (!TASK_CONFIG.fillPowerSpawnPower) return;
  const { powerSpawn, storage, terminal, roomName } = roomState;

  if (!powerSpawn) return;

  if (powerSpawn.store[RESOURCE_POWER] >= POWER_SPAWN.POWER_MIN) return;

  const needed = powerSpawn.store.getFreeCapacity(RESOURCE_POWER);
  if (needed <= 0) return;

  const storagePower = storage ? storage.store[RESOURCE_POWER] : 0;
  const terminalPower = terminal ? terminal.store[RESOURCE_POWER] : 0;

  if (storagePower + terminalPower < needed) return;

  addIfNew(
    roomName,
    "fillPowerSpawnPower",
    {
      type: "transfer",
      targetId: powerSpawn.id,
      resourceType: RESOURCE_POWER,
    },
    existingKeys(roomName, "fillPowerSpawnPower"),
  );
}

function generateFillPowerSpawnEnergy(roomState) {
  if (!TASK_CONFIG.fillPowerSpawnEnergy) return;
  const { powerSpawn, storage, roomName } = roomState;

  if (!storage) return;

  if (!powerSpawn) return;

  if (powerSpawn.store[RESOURCE_ENERGY] >= POWER_SPAWN.ENERGY_MIN) return;

  const needed = powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY);
  if (needed <= 0) return;

  if (storage.store[RESOURCE_ENERGY] < needed) return;

  addIfNew(
    roomName,
    "fillPowerSpawnEnergy",
    {
      type: "transfer",
      sourceId: storage.id,
      targetId: powerSpawn.id,
      resourceType: RESOURCE_ENERGY,
    },
    existingKeys(roomName, "fillPowerSpawnEnergy"),
  );
}

function generateFillFactoryEnergy(roomState) {
  if (!TASK_CONFIG.fillFactoryEnergy) return;
  const { factory, storage, roomName } = roomState;

  if (!storage) return;

  if (!factory) return;

  if (factory.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return;

  const reserveThreshold =
    STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER;
  if (storage.store[RESOURCE_ENERGY] <= reserveThreshold) return;

  addIfNew(
    roomName,
    "fillFactoryEnergy",
    {
      type: "transfer",
      sourceId: storage.id,
      targetId: factory.id,
      resourceType: RESOURCE_ENERGY,
    },
    existingKeys(roomName, "fillFactoryEnergy"),
  );
}

function generateCollectFactoryBattery(roomState) {
  if (!TASK_CONFIG.collectFactoryBattery) return;
  const { factory, storage, roomName } = roomState;

  if (!storage) return;

  if (!factory) return;

  if (factory.store[RESOURCE_BATTERY] === 0) return;

  addIfNew(
    roomName,
    "collectFactoryBattery",
    {
      type: "transfer",
      sourceId: factory.id,
      targetId: storage.id,
      resourceType: RESOURCE_BATTERY,
    },
    existingKeys(roomName, "collectFactoryBattery"),
  );
}

function generateFillTerminalEnergy(roomState) {
  if (!TASK_CONFIG.fillTerminalEnergy) return;
  const { storage, terminal, roomName } = roomState;

  if (!storage || !terminal) return;

  if (terminal.store[RESOURCE_ENERGY] >= TERMINAL_SUPPLY.ENERGY_TARGET) return;

  const reserveThreshold =
    STORAGE.ENERGY_MIN * TERMINAL_SUPPLY.STORAGE_RESERVE_MULTIPLIER;
  if (storage.store[RESOURCE_ENERGY] <= reserveThreshold) return;

  addIfNew(
    roomName,
    "fillTerminalEnergy",
    {
      type: "transfer",
      sourceId: storage.id,
      targetId: terminal.id,
      resourceType: RESOURCE_ENERGY,
    },
    existingKeys(roomName, "fillTerminalEnergy"),
  );
}

function generateFillTerminalResources(roomState) {
  const { storage, terminal, roomName } = roomState;
  if (!storage || !terminal) return;

  const exports =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].terminalExports) ||
    {};
  const exportTypes = Object.keys(exports);
  if (!TASK_CONFIG.fillTerminalResources && exportTypes.length === 0) return;

  const RESOURCE_TERMINAL_MAX = 10000;
  const resourceTypes = TASK_CONFIG.fillTerminalResources
    ? Object.keys(storage.store)
    : exportTypes;
  const keys = existingKeys(roomName, "fillTerminalResources");

  for (let i = 0; i < resourceTypes.length; i++) {
    const resourceType = resourceTypes[i];
    if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;

    if ((storage.store[resourceType] || 0) === 0) continue;

    const currentInTerminal = terminal.store[resourceType] || 0;
    const exportNeed = exports[resourceType] || 0;
    const cap = exportNeed || RESOURCE_TERMINAL_MAX;
    if (currentInTerminal >= cap) continue;

    addIfNew(
      roomName,
      "fillTerminalResources",
      {
        type: "transfer",
        sourceId: storage.id,
        targetId: terminal.id,
        resourceType,
      },
      keys,
    );
  }
}

function generateFillTowers(roomState) {
  if (!TASK_CONFIG.fillTowers) return;
  const { storage, towers, roomName } = roomState;

  if (!storage) return;

  const keys = existingKeys(roomName, "fillTowers");
  for (let i = 0; i < towers.length; i++) {
    const tower = towers[i];
    // Башни, на которые Task уже есть, отсекаются до чтения состояния:
    // `tower.energy` — прямое свойство структуры, без объекта Store.
    if (hasTaskFor("fillTowers", tower.id, RESOURCE_ENERGY, keys)) continue;

    if (tower.energy >= TOWER.SUPPLY_THRESHOLD) continue;

    addIfNew(
      roomName,
      "fillTowers",
      {
        type: "transfer",
        sourceId: storage.id,
        targetId: tower.id,
        resourceType: RESOURCE_ENERGY,
      },
      keys,
    );
  }
}

const REPAIR_THRESHOLD_RATIO = 0.5;

function generateRepairStructures(roomState) {
  if (!TASK_CONFIG.repairStructures) return;

  const { roomName, damagedStructures } = roomState;
  const keys = existingKeys(roomName, "repairStructures");
  for (let i = 0; i < damagedStructures.length; i++) {
    const structure = damagedStructures[i];
    if (structure.hits >= structure.hitsMax * REPAIR_THRESHOLD_RATIO) continue;

    addIfNew(
      roomName,
      "repairStructures",
      {
        type: "repair",
        targetId: structure.id,
      },
      keys,
    );
  }
}

function generateBuildStructures(roomState) {
  if (!TASK_CONFIG.buildStructures) return;

  const { roomName } = roomState;

  // ТЗ №1 (счётчик): Object.values(Game.constructionSites) проходит по всем
  // стройплощадкам империи на каждую комнату за тик — измеряем их число.
  const allSites = Object.values(Game.constructionSites);
  const sites = allSites.filter(site => site.pos.roomName === roomName);
  const keys = existingKeys(roomName, "buildStructures");
  for (let i = 0; i < sites.length; i++) {
    addIfNew(
      roomName,
      "buildStructures",
      {
        type: "build",
        targetId: sites[i].id,
      },
      keys,
    );
  }
}

function generateUpgradeController(roomState) {
  if (!TASK_CONFIG.upgradeController) return;

  const { controller, storage, roomName } = roomState;

  if (!controller || !storage) return;

  if (controller.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MIN) return;

  addIfNew(
    roomName,
    "upgradeController",
    {
      type: "upgrade",
      targetId: controller.id,
    },
    existingKeys(roomName, "upgradeController"),
  );
}

// ── ТРОТТЛИНГ ГЕНЕРАЦИИ ─────────────────────────────────────────────────
// Генераторы идемпотентны (дедуп по `taskType|targetId|resourceType`), поэтому
// их можно запускать не каждый тик, а раз в TASK_GEN_INTERVAL тиков категории:
// пропуск тика не создаёт дублей и не теряет потребность — только откладывает
// реакцию на смену состояния цели на несколько тиков. Фаза расписания сдвинута
// по имени комнаты, чтобы комнаты не сканировали в один и тот же тик.

/**
 * Систематический сдвиг комнаты по имени: разные комнаты запускают генератор в
 * разные тики внутри интервала. Считается один раз на комнату и живёт в heap.
 * @param {string} roomName
 * @returns {number}
 */
function getRoomPhase(roomName) {
  if (!global._taskGenPhase) global._taskGenPhase = {};
  const cached = global._taskGenPhase[roomName];
  if (typeof cached === "number") return cached;

  let phase = 0;
  for (let i = 0; i < roomName.length; i++) {
    phase = (phase * 31 + roomName.charCodeAt(i)) % 97;
  }
  global._taskGenPhase[roomName] = phase;
  return phase;
}

/**
 * Запускает генератор категории не чаще одного раза в `interval` тиков.
 * @param {string} roomName
 * @param {string} taskType
 * @param {Object} roomState
 * @param {Function} generator
 * @param {number} [interval] явный интервал (тесты); по умолчанию — из конфига
 * @returns {boolean} запускался ли генератор в этом тике
 */
function runIfDue(roomName, taskType, roomState, generator, interval) {
  const gap =
    typeof interval === "number"
      ? interval
      : TASK_GEN_INTERVAL[taskType] || TASK_GEN_INTERVAL_DEFAULT;

  if (gap > 1 && (Game.time + getRoomPhase(roomName)) % gap !== 0) {
    return false;
  }

  generator(roomState);
  return true;
}

/**
 * Таблица «категория → генератор». Порядок совпадает с прежним порядком вызовов
 * в room.manager (категории независимы, дедуп внутри каждой).
 */
const TASK_GENERATORS = [
  { taskType: "fillSpawnsExtensions", run: generateFillSpawnsExtensions },
  { taskType: "fillPowerSpawnPower", run: generateFillPowerSpawnPower },
  { taskType: "fillPowerSpawnEnergy", run: generateFillPowerSpawnEnergy },
  { taskType: "fillFactoryEnergy", run: generateFillFactoryEnergy },
  { taskType: "collectFactoryBattery", run: generateCollectFactoryBattery },
  { taskType: "fillTerminalEnergy", run: generateFillTerminalEnergy },
  { taskType: "fillTerminalResources", run: generateFillTerminalResources },
  { taskType: "fillTowers", run: generateFillTowers },
  { taskType: "repairStructures", run: generateRepairStructures },
  { taskType: "buildStructures", run: generateBuildStructures },
  { taskType: "upgradeController", run: generateUpgradeController },
];

/**
 * Единая точка запуска генерации задач комнаты с троттлингом по категориям.
 * room.manager вызывает её вместо ручного перечисления 11 генераторов.
 * @param {Object} roomState
 */
function runAll(roomState) {
  const roomName = roomState.roomName;
  for (let i = 0; i < TASK_GENERATORS.length; i++) {
    const entry = TASK_GENERATORS[i];
    runIfDue(roomName, entry.taskType, roomState, entry.run);
  }
}

module.exports = {
  TASK_GENERATORS,
  runIfDue,
  runAll,
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
