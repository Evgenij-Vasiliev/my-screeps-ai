const taskManager = require("task.manager");
// Числа повреждённых структур берутся из кэша сканера, а НЕ из room.manager.
// Это принципиально: room.manager сам подключает task.generators
// (room.manager.js, строка с require("./task.generators")), поэтому обратный
// require создавал цикл и на шарде падал с
// «Circular reference to module 'room.manager'» — движок Screeps, в отличие
// от Node, циклы не разрешает. Направление «generators → scanner» ациклично:
// scanner зависит только от constants.
const scanner = require("scanner");
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
  if (!target) {
    return false;
  }

  // Есть ли свободное место под энергию — БЕЗ вызова store.getFreeCapacity().
  //
  // `.energy` и `.energyCapacity` — документированные алиасы store[RESOURCE_ENERGY]
  // и store.getCapacity(RESOURCE_ENERGY): @types/screeps:4685-4696 (spawn),
  // :5104-5116 (extension), :5343-5355 (tower). Поэтому `energy < energyCapacity`
  // тождественно прежнему `getFreeCapacity(RESOURCE_ENERGY) > 0`.
  //
  // Зачем: обход spawn/extension — самый дорогой цикл генерации (62 объекта на
  // комнату за тик). Замер на живом shard3 30.09.2026
  // (scripts/task.manager.bench.js, N=300, реплика ровно этого цикла):
  // 0.0240 и 0.0209 CPU на комнату с вызовом getFreeCapacity против 0.0034 и
  // 0.0061 CPU с алиасами — 4-7 раз дешевле. Живая сверка эквивалентности:
  // 282 объекта spawn+extension в 5 комнатах, расхождений между
  // `energy < energyCapacity` и `getFreeCapacity(ENERGY) > 0` — 0
  // (Game.time ≈ 83331255).
  //
  // Проверка типа — для офлайн-фикстур: у заглушки без этих полей ответ
  // «места нет», как и раньше у заглушки без store.
  const capacity = target.energyCapacity;

  if (typeof capacity !== "number") {
    return false;
  }

  return target.energy < capacity;
}

function generateFillSpawnsExtensions(roomState) {
  if (!TASK_CONFIG.fillSpawnsExtensions) return;
  const { storage, spawns, extensions, room } = roomState;

  if (!storage) {
    return;
  }

  // ── Дешёвый отсев: есть ли в комнате куда заливать вообще ────────────
  // energyAvailable/energyCapacityAvailable — суммы по ВСЕМ spawn и extension
  // комнаты, их считает движок (@types/screeps:4321-4328: «Total amount of
  // energy available in all spawns and extensions in the room»). Равенство
  // означает «полны все»: тогда needsEnergy() ложно для каждого из ~60
  // объектов комнаты, и обход не нашёл бы ни одного кандидата.
  //
  // Замер shard3 29.09.2026 (scripts/cpu.peaks.measure.js, флаг
  // Memory.cpuGenProfile, 92 окна): во ВСЕХ 5 комнатах империи
  // energyAvailable == energyCapacityAvailable (12600/12600, 10000/10000,
  // 11600/11600, 10600/10600, 12600/12600) и needy = 0, а обход 285 объектов
  // обходился в 0.7921 CPU/тик — 77 % всего блока taskManager и ~18 % расхода
  // империи. Результат генератора при этом пустой: ни одной задачи.
  //
  // Проверка типов — для офлайн-тестов: у заглушки roomState этих полей нет,
  // и тогда генератор работает как раньше (обход), а не молча выключается.
  const roomEnergy = room && room.energyAvailable;
  if (
    typeof roomEnergy === "number" &&
    roomEnergy === room.energyCapacityAvailable
  ) {
    return;
  }

  const roomName = roomState.roomName;

  // ── Гейт по глубине очереди (решение человека 30.09.2026) ────────────
  // Пока свободных (никем не зарезервированных) задач этого типа в комнате
  // уже не меньше TASK_CONFIG.FILLSPAWNS_QUEUE_GATE, сканировать
  // spawn/extension нечего: свободную задачу воркер и так найдёт, а скан
  // стоит 0.021-0.025 CPU на неполную комнату за тик
  // (scripts/task.manager.bench.js, реплика цикла, N=300).
  //
  // Замер состояния очередей shard3 30.09.2026 (read-only): в 4 комнатах из 5
  // в очереди 12-18 задач, свободных 10-16, воркеров 2 на комнату.
  // freeTasks — O(1) по счётчику индекса (task.manager.js, freeTasks).
  //
  // Гейт НЕ меняет ни addTask, ни FIFO, ни потолок постановки: он лишь
  // пропускает скан, когда очередь и без него не пуста. Откат — поставить
  // TASK_CONFIG.FILLSPAWNS_QUEUE_GATE = 0.
  const gate = TASK_CONFIG.FILLSPAWNS_QUEUE_GATE;
  if (gate > 0 && taskManager.freeTasks(roomName, TASK_TYPE) >= gate) {
    return;
  }

  // storage.id читается один раз на комнату, а не на каждого кандидата:
  // свойство игрового объекта — вызов функции (см. комментарий в needsEnergy).
  const storageId = storage.id;

  // Один проход по двум спискам вместо spawns.concat(extensions): раньше на
  // каждую комнату за тик создавался промежуточный массив на 60+ элементов.
  const groups = [spawns, extensions];

  for (let g = 0; g < groups.length; g++) {
    const list = groups[g];

    for (let i = 0; i < list.length; i++) {
      const target = list[i];

      if (!needsEnergy(target)) {
        continue;
      }

      const candidate = {
        type: "transfer",
        sourceId: storageId,
        targetId: target.id,
        resourceType: RESOURCE_ENERGY,
      };

      if (isDuplicateTask(roomName, candidate)) {
        continue;
      }

      // addTask возвращает false, когда на эту комнату и тип в этом тике уже
      // поставлен потолок TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK
      // (task.manager.js:253-255). Дальше ни одна задача не добавится —
      // прекращаем обход, не строя ключи дублей для остальных кандидатов.
      if (!taskManager.addTask(roomName, TASK_TYPE, candidate)) {
        return;
      }
    }
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
  const { storage, terminal, roomName } = roomState;

  if (!storage || !terminal) {
    return;
  }

  // ── ЗАЯВКИ ТЕРМИНАЛЬНОЙ СЕТИ (Memory.rooms[room].terminalExports) ────────
  // Terminal.send списывает объём из terminal.store, поэтому ресурс, которого
  // в терминале нет, сеть отправить НЕ МОЖЕТ — заявка без воркера остаётся
  // в Memory и висит вечно. Порядок такой: terminalNetwork.addExport пишет
  // «ресурс → объём» на комнату-донора, а этот генератор превращает заявку в
  // задачу «привези resourceType из storage в terminal».
  //
  // Пока флаг TASK_CONFIG.fillTerminalResources выключен (по умолчанию false),
  // грузятся ТОЛЬКО заявки сети. Раньше в этом режиме генератор не работал
  // вовсе (`if (!TASK_CONFIG.fillTerminalResources) return`), то есть механизм
  // terminalExports был оборван на середине. Включённый флаг сохраняет прежнее
  // поведение: лить в терминал всё, чего меньше RESOURCE_TERMINAL_MAX.
  const exports =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].terminalExports) ||
    {};
  const exportTypes = Object.keys(exports);

  if (!TASK_CONFIG.fillTerminalResources && exportTypes.length === 0) {
    return;
  }

  const RESOURCE_TERMINAL_MAX = 10000;

  // Цель терминала — максимум из базового лимита (при включённом флаге) и
  // заявки сети. Заявка НЕ должна опускать цель ниже базовой: иначе излишек,
  // который ждёт рынок, не доехал бы ни до сети, ни до продажи.
  const baseCap = TASK_CONFIG.fillTerminalResources ? RESOURCE_TERMINAL_MAX : 0;
  const resourceTypes = TASK_CONFIG.fillTerminalResources
    ? Object.keys(storage.store)
    : exportTypes;

  for (let i = 0; i < resourceTypes.length; i++) {
    const resourceType = resourceTypes[i];
    if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) {
      continue;
    }

    if ((storage.store[resourceType] || 0) === 0) {
      continue;
    }

    // cap === 0 бывает только в режиме заявок: ресурс есть в storage, но сеть
    // его не просила — в терминал он не едет (этим и управляет флаг).
    const cap = Math.max(baseCap, exports[resourceType] || 0);
    if (cap === 0) {
      continue;
    }

    const currentInTerminal = terminal.store[resourceType] || 0;
    if (currentInTerminal >= cap) {
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
    // .energy — алиас store[RESOURCE_ENERGY] (@types/screeps:5343-5355):
    // чтение свойства дешевле, чем store[RESOURCE_ENERGY] (замер 30.09.2026,
    // scripts/task.manager.bench.js, случай 12d: обращение к store + вызов
    // getCapacity стоит 0.0193 CPU на 62 объекта, алиасы — 0.0034).
    if (tower.energy >= TOWER.SUPPLY_THRESHOLD) {
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

  const { roomName } = roomState;
  const cache = roomState._structureCache;
  const hasNumbers =
    !!cache && !!cache.damagedRoadIds && !!cache.damagedRoadHits;

  // 1. Дороги — числами из кэша сканера. Ни Game.getObjectById, ни массива
  //    дескрипторов: отбор идёт прямо по типизированным массивам кэша.
  if (hasNumbers) {
    const ids = cache.damagedRoadIds;
    const hits = cache.damagedRoadHits;
    const maxes = cache.damagedRoadHitsMax;

    for (let i = 0; i < ids.length; i++) {
      if (!isBelowRepairThreshold(hits[i], maxes[i])) continue;
      if (!isLiveDamaged(ids[i])) continue;
      addRepairTask(roomName, ids[i]);
    }

    // 2. Группы структур (spawns/towers/extensions/links/labs и остальные) —
    //    тоже числами. Дескрипторы собираются в один массив на вызов.
    const groups = [];
    scanner.collectDamagedStructures(cache, groups);

    for (let i = 0; i < groups.length; i++) {
      const s = groups[i];
      if (!isBelowRepairThreshold(s.hits, s.hitsMax)) continue;
      if (!isLiveDamaged(s.id)) continue;
      addRepairTask(roomName, s.id);
    }

    return;
  }

  // Фолбэк для старого кэша в heap и для фикстур тестов: объекты, уже
  // собранные вызывающим кодом.
  const damagedStructures = roomState.damagedStructures;
  if (!damagedStructures) return;

  for (let i = 0; i < damagedStructures.length; i++) {
    const structure = damagedStructures[i];
    if (!isBelowRepairThreshold(structure.hits, structure.hitsMax)) continue;
    addRepairTask(roomName, structure.id);
  }
}

/**
 * Структура ниже порога ремонта: hits вдвое хуже максимума.
 *
 * `REPAIR_THRESHOLD_RATIO` = 0.5, сравнение `hits < hitsMax * 0.5` записано
 * как `hits * (1 / 0.5) < hitsMax`, то есть `hits * 2 < hitsMax`: так в
 * горячем цикле нет ни деления, ни дробного множителя (элементов сотни,
 * проверка идёт каждый тик). Числа приходят либо из кэша сканера (дороги),
 * либо с живых объектов (группы структур); undefined (источник без снимка)
 * не проходит проверку.
 *
 * @param {number|undefined} hits
 * @param {number|undefined} hitsMax
 * @returns {boolean}
 */
function isBelowRepairThreshold(hits, hitsMax) {
  return (
    typeof hits === "number" &&
    typeof hitsMax === "number" &&
    hits * (1 / REPAIR_THRESHOLD_RATIO) < hitsMax
  );
}

/**
 * Живой объект ещё повреждён.
 *
 * Нужно только для дорог: их hits взяты из кэша сканера (возраст до
 * CACHE.REFRESH_INTERVAL тиков), поэтому кандидат проверяется по-настоящему.
 * Кандидатов единицы, а дорог в списке сотни — резолв идёт только по
 * прошедшим порог, обычно это 0 объектов.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isLiveDamaged(id) {
  const live = Game.getObjectById(id);
  return !!live && live.hits < live.hitsMax;
}

/** Ставит repair-задачу, если такой ещё нет. */
function addRepairTask(roomName, targetId) {
  const candidate = {
    type: "repair",
    targetId,
  };

  if (isDuplicateRepairTask(roomName, candidate)) return;

  taskManager.addTask(roomName, "repairStructures", candidate);
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
