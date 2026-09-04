// Единый модуль констант для всей логики комнат.
// Сюда переносим все "магические числа" по мере рефакторинга файлов.

const STORAGE = {
  ENERGY_MIN: 150000, // не опускаться ниже — резерв комнаты
};

const TASK_TYPES = {
  TRANSFER: "transfer",
  BUILD: "build",
  REPAIR: "repair",
  UPGRADE: "upgrade",
};

const TERMINAL_SUPPLY = {
  ENERGY_MIN: 100000,
  ENERGY_TARGET: 150000,
  MINERAL_MAX: 10000,
  BATTERY_MAX: 10000,
  COMPOUND_MAX: 10000,
  STORAGE_RESERVE_MULTIPLIER: 1.3, // множитель к STORAGE.ENERGY_MIN — ниже этого уровня терминал не забирает энергию из хранилища
};

const FACTORY = {
  ENERGY_RESERVE_MULTIPLIER: 1.1, // множитель к STORAGE.ENERGY_MIN — ниже этого уровня фабрика не забирает энергию из хранилища
};

const TOWER = {
  REPAIR_ENERGY_MIN: 700,
  REPAIR_INTERVAL: 15,
  WALL_THRESHOLD_DEFAULT: 1000,
  WALL_THRESHOLD_STEP: 1000,
  SUPPLY_THRESHOLD: 750,
  HOSTILE_CHECK_INTERVAL: 100,
};

const TASK_CONFIG = {
  fillSpawnsExtensions: true,
  fillPowerSpawnPower: false,
  fillPowerSpawnEnergy: false,
  fillTerminalEnergy: true,
  fillTerminalResources: false,
  fillFactoryEnergy: false,
  collectFactoryBattery: false,
  repairStructures: true,
  buildStructures: true,
  fillTowers: true,
  upgradeController: true,
};

const POWER_SPAWN = {
  POWER_MIN: 10,
  ENERGY_MIN: 500,
};

const PRESPAWN_THRESHOLD = { miner: 100, linkWorker: 30 };

const SPAWN_QUOTA = {
  harvester: 0,
  linkWorker: 1,
  miner: 2,
  towerSupplier: 0,
  repairer: 0,
  builder: 0,
  upgrader: 0,
  worker: 2,
  mineralMiner: 1,
};

const MINERAL_MIN_AMOUNT_TO_SPAWN = 1500;

const CREEP_BODIES = {
  miner: { work: 5, carry: 12, move: 5 },
  towerSupplier: { carry: 4, move: 2 },
  linkWorker: { carry: 4, move: 2 },
  harvester: { work: 1, carry: 1, move: 1 },
  upgrader: { work: 3, carry: 2, move: 3 },
  builder: { work: 5, carry: 5, move: 5 },
  repairer: { work: 3, carry: 2, move: 3 },
  worker: { work: 5, carry: 5, move: 10 },
  mineralMiner: { work: 5, carry: 5, move: 5 },
};

const CONTROLLER = {
  DOWNGRADE_MAX: 150000,
  DOWNGRADE_MIN: 50000,
};

const CACHE = {
  REFRESH_INTERVAL: 20,
};

const CPU = {
  REPORT_INTERVAL: 10,
  AVERAGE_WINDOW: 100,
  BUCKET_CRITICAL: 500,
};

module.exports = {
  STORAGE,
  TASK_TYPES,
  TERMINAL_SUPPLY,
  FACTORY,
  PRESPAWN_THRESHOLD,
  CREEP_BODIES,
  TOWER,
  TASK_CONFIG,
  POWER_SPAWN,
  SPAWN_QUOTA,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  CONTROLLER,
  CACHE,
  CPU,
};
