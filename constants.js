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
  OPERATE_FACTORY: "factory",
};

const TERMINAL_SUPPLY = {
  ENERGY_MIN: 100000,
  ENERGY_TARGET: 150000,
  MINERAL_MAX: 10000,
  BATTERY_MAX: 10000,
  COMPOUND_MAX: 10000,
  STORAGE_RESERVE_MULTIPLIER: 1.3, // множитель к STORAGE.ENERGY_MIN — ниже этого уровня терминал не забирает энергию из хранилища
};

const TOWER = {
  REPAIR_ENERGY_MIN: 700,
  REPAIR_INTERVAL: 10,
  WALL_THRESHOLD_DEFAULT: 1000,
  WALL_THRESHOLD_STEP: 1000,
  SUPPLY_THRESHOLD: 1000,
};

const POWER_SPAWN = {
  POWER_MIN: 10,
  ENERGY_MIN: 500,
};

const PRESPAWN_THRESHOLD = { miner: 50, linkWorker: 30 };

const SPAWN_QUOTA = {
  harvester: 0,
  linkWorker: 1,
  miner: 2,
  towerSupplier: 1,
  repairer: 1,
  builder: 0,
  upgrader: 0,
  worker: 3,
  mineralMiner: 1,
};

const MINERAL_MIN_AMOUNT_TO_SPAWN = 1500;

const CREEP_BODIES = {
  miner: { work: 5, carry: 1, move: 2 },
  towerSupplier: { carry: 4, move: 2 },
  linkWorker: { carry: 4, move: 2 },
  harvester: { work: 0, carry: 1, move: 1 },
  upgrader: { work: 3, carry: 2, move: 3 },
  builder: { work: 5, carry: 5, move: 5 },
  repairer: { work: 3, carry: 2, move: 3 },
  worker: { work: 0, carry: 3, move: 2 },
  mineralMiner: { work: 5, carry: 5, move: 5 },
};

const CONTROLLER = {
  DOWNGRADE_THRESHOLD: 190000,
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
  PRESPAWN_THRESHOLD,
  CREEP_BODIES,
  TOWER,
  POWER_SPAWN,
  SPAWN_QUOTA,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  CONTROLLER,
  CACHE,
  CPU,
};
