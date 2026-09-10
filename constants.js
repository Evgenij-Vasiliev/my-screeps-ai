// ===================================================
// CONSTANTS.JS — единый модуль констант проекта
// ===================================================
// Сюда переносим все "магические числа" по мере рефакторинга файлов.
// Ничего, что относится к конкретной роли/менеджеру, не должно
// жить россыпью в других файлах — все настраиваемые значения стягиваются сюда.
// ===================================================

// ── STORAGE ──────────────────────────────────────────────────────────────
// Резерв энергии в Storage комнаты.
const STORAGE = {
  ENERGY_MIN: 150000, // не опускаться ниже — резерв комнаты
};

// ── TASK_TYPES ───────────────────────────────────────────────────────────
// Типы задач для системы Worker/Task (taskManager, taskExecutors).
const TASK_TYPES = {
  TRANSFER: "transfer",
  BUILD: "build",
  REPAIR: "repair",
  UPGRADE: "upgrade",
};

// ── TERMINAL_SUPPLY ──────────────────────────────────────────────────────
// Пороги пополнения терминала энергией/ресурсами из Storage.
// Единый источник порогов — market.manager.js продаёт всё, что превышает
// эти же значения, чтобы не было двух разных источников правды.
const TERMINAL_SUPPLY = {
  ENERGY_MIN: 100000, // ниже этого — терминал нуждается в подвозе энергии
  ENERGY_TARGET: 150000, // цель пополнения энергии терминала
  MINERAL_MAX: 0, // терминал не должен копить минералы сверх этого
  BATTERY_MAX: 0, // терминал не должен копить battery сверх этого
  COMPOUND_MAX: 0, // терминал не должен копить compounds сверх этого
  STORAGE_RESERVE_MULTIPLIER: 1.3, // множитель к STORAGE.ENERGY_MIN — ниже этого уровня терминал не забирает энергию из хранилища
};

// ── FACTORY ──────────────────────────────────────────────────────────────
// Порог, ниже которого фабрика не имеет права забирать энергию из Storage.
const FACTORY = {
  ENERGY_RESERVE_MULTIPLIER: 1.1, // множитель к STORAGE.ENERGY_MIN
};

// ── TOWER ────────────────────────────────────────────────────────────────
// Пороги и интервалы поведения башен (ремонт стен, атака, подпитка).
const TOWER = {
  REPAIR_ENERGY_MIN: 700, // минимум энергии в башне, чтобы начать ремонт
  REPAIR_INTERVAL: 15, // раз в сколько тиков проверяем повреждённые структуры
  WALL_THRESHOLD_DEFAULT: 1000, // стартовый порог прочности стен для ремонта
  WALL_THRESHOLD_STEP: 1000, // на сколько поднимаем порог с каждым уровнем
  SUPPLY_THRESHOLD: 750, // ниже этого — башне нужна подпитка энергией
  HOSTILE_CHECK_INTERVAL: 100, // раз в сколько тиков ищем врагов (когда их не было)
};

// ── TASK_CONFIG ──────────────────────────────────────────────────────────
// Какие категории задач вообще генерируются для воркеров этой комнаты.
// true/false — вкл/выкл конкретной категории задач.
const TASK_CONFIG = {
  fillSpawnsExtensions: true, // подвоз энергии в спавны/расширения
  fillPowerSpawnPower: false, // подвоз POWER в PowerSpawn
  fillPowerSpawnEnergy: false, // подвоз энергии в PowerSpawn
  fillTerminalEnergy: true, // подвоз энергии в терминал
  fillTerminalResources: false, // подвоз прочих ресурсов в терминал
  fillFactoryEnergy: false, // подвоз энергии в фабрику
  collectFactoryBattery: false, // забор battery из фабрики
  repairStructures: true, // ремонт повреждённых структур
  buildStructures: true, // стройка по construction site
  fillTowers: true, // подвоз энергии в башни
  upgradeController: true, // прокачка контроллера
};

// ── POWER_SPAWN ──────────────────────────────────────────────────────────
// Минимумы для запуска processPower() в PowerSpawn.
const POWER_SPAWN = {
  POWER_MIN: 10, // минимум POWER в PowerSpawn для обработки
  ENERGY_MIN: 500, // минимум энергии в PowerSpawn для обработки
};

// ── PRESPAWN_THRESHOLD ───────────────────────────────────────────────────
// За сколько тиков до смерти крипа (по ticksToLive) роль считается
// "скоро освободится" и заранее запускается пре-спавн замены.
const PRESPAWN_THRESHOLD = {
  miner: 100,
  remoteMiner: 150,
  linkWorker: 30,
};

// ── SPAWN_QUOTA ──────────────────────────────────────────────────────────
// Сколько крипов каждой роли должно поддерживаться одновременно,
// по умолчанию — во ВСЕХ комнатах. Переопределяется для конкретной
// комнаты через ROOM_SPAWN_QUOTA_OVERRIDES ниже.
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
  attacker: 1,
  reserver: 2,
  remoteMiner: 2,
  remoteHauler: 2,
  labWorker: 1,
};

// ── ROOM_SPAWN_QUOTA_OVERRIDES ───────────────────────────────────────────
// Точечные переопределения SPAWN_QUOTA для конкретных комнат.
// Если роль для комнаты не указана здесь — берётся значение из SPAWN_QUOTA.
const ROOM_SPAWN_QUOTA_OVERRIDES = {
  E35S37: { harvester: 2 },
};

// ── MINERAL_MIN_AMOUNT_TO_SPAWN ──────────────────────────────────────────
// Минимальный остаток минерала в месторождении, ниже которого
// mineralMiner не спавнится (нет смысла добывать крохи).
const MINERAL_MIN_AMOUNT_TO_SPAWN = 500;

// ── CREEP_BODIES ─────────────────────────────────────────────────────────
// Тело (набор частей) для каждой роли. Порядок частей в самом крипе
// задаёт prepareBody() в creep.factory.js: TOUGH → WORK → CARRY → MOVE.
const CREEP_BODIES = {
  miner: { work: 5, carry: 12, move: 5 },
  towerSupplier: { carry: 4, move: 2 },
  linkWorker: { carry: 4, move: 2 },
  harvester: { work: 1, carry: 1, move: 1 },
  upgrader: { work: 3, carry: 2, move: 3 },
  builder: { work: 5, carry: 5, move: 5 },
  repairer: { work: 3, carry: 2, move: 3 },
  worker: { work: 8, carry: 8, move: 16 },
  mineralMiner: { work: 5, carry: 5, move: 5 },
  attacker: { tough: 0, move: 10, heal: 0, ranged_attack: 10 },
  reserver: { claim: 2, move: 4 },
  remoteMiner: { work: 5, carry: 1, move: 6 },
  remoteHauler: { carry: 20, move: 20 },
  labWorker: { carry: 1, move: 1 },
};

// ── CONTROLLER ───────────────────────────────────────────────────────────
// Пороги деградации контроллера (ticksToDowngrade), на которые
// ориентируется upgrader и логика тревоги по контроллеру.
const CONTROLLER = {
  DOWNGRADE_MAX: 150000,
  DOWNGRADE_MIN: 50000,
};

// ── CACHE ────────────────────────────────────────────────────────────────
// Интервал обновления кэшей сканера (scanner.js) и подобных структур.
const CACHE = {
  REFRESH_INTERVAL: 20,
};

// ── CPU ──────────────────────────────────────────────────────────────────
// Настройки мониторинга CPU (cpuMonitor.js): как часто отчитываться,
// на каком окне усреднять, при каком уровне bucket считать критичным.
const CPU = {
  REPORT_INTERVAL: 10,
  AVERAGE_WINDOW: 100,
  BUCKET_CRITICAL: 500,
};

// ── MARKET ───────────────────────────────────────────────────────────────
// Настройки менеджера рынка (market.manager.js).
const MARKET = {
  // Ресурсы, которые нужно ЗАКУПАТЬ на рынке.
  // Чтобы включить/выключить закупку ресурса — просто добавь/убери строку.
  BUY_RESOURCES: ["X", "O"],

  // Ресурсы, которые нужно ПРОДАВАТЬ на рынке.
  // Чтобы включить/выключить продажу ресурса — просто добавь/убери строку.
  SELL_RESOURCES: [RESOURCE_ENERGY],

  // Максимум сделок (покупок + продаж суммарно) за один тик —
  // защита от избыточного расхода CPU за один тик.
  MAX_DEALS_PER_TICK: 3,

  // Минимальный порог цены при продаже: не продавать дешевле,
  // чем (лучшая цена на рынке) × этот коэффициент.
  MIN_SELL_PRICE_RATIO: 0.8,

  // Максимальный порог цены при покупке: не покупать дороже,
  // чем (минимальная цена на рынке) × этот коэффициент.
  MAX_BUY_PRICE_RATIO: 1.2,
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
  ROOM_SPAWN_QUOTA_OVERRIDES,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
  CONTROLLER,
  CACHE,
  CPU,
  MARKET,
};
