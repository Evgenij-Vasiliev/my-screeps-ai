// ===================================================
// CONSTANTS/TASKS.JS — TASKS — конфигурация Task System
// ===================================================
// TASK_CONFIG и интервалы генерации задач.
// Выделено из constants.js; потребители берут значения через barrel
// constants.js, чтобы объекты конфига оставались одним экземпляром.
// ===================================================
// ── TASK_CONFIG ──────────────────────────────────────────────────────────
// Какие категории задач вообще генерируются для воркеров этой комнаты.
// true/false — вкл/выкл конкретной категории задач.
// Два последних флага — не генераторы: они включают структурные подсистемы
// комнаты (`factoryManager` / `powerSpawnManager` в room.manager.js).
// При false вызов менеджера не делается вообще — структура не «дёргается»
// каждый тик вхолостую.
//
// Обе структурные подсистемы включены:
//  - factory: снабжение fillFactoryEnergy оставляет в store резерв под
//    результат (FACTORY.PRODUCT_RESERVE), продукт вывозит collectFactoryBattery;
//  - powerSpawn: PowerSpawn уровня RCL8 обрабатывает power в GPL
//    (processPower), сырьё подвозят fillPowerSpawnPower + fillPowerSpawnEnergy.
//    Раньше флаг стоял false, и при живых 200k power на складах империи GPL
//    не производился вовсе: сырьё копилось в PowerSpawn, а processPower()
//    не вызывался ни разу.
const TASK_CONFIG = {
  fillSpawnsExtensions: true, // подвоз энергии в спавны/расширения
  fillPowerSpawnPower: true, // подвоз POWER в PowerSpawn
  fillPowerSpawnEnergy: true, // подвоз энергии в PowerSpawn
  fillTerminalEnergy: true, // подвоз энергии в терминал
  fillTerminalResources: true, // подвоз прочих ресурсов в терминал
  // Фабричный контур включён (решение владельца): энергия едет в фабрику,
  // battery вывозится, менеджер производства работает. Все три флага
  // (fillFactoryEnergy + collectFactoryBattery + factory) включаются и
  // выключаются только вместе — иначе фабрика либо голодает, либо копит
  // продукт без вывоза. Контракт «все три включены» закреплён тестом
  // tests/factory.manager.test.js (раздел 1).
  fillFactoryEnergy: false, // подвоз энергии в фабрику
  collectFactoryBattery: false, // забор battery из фабрики
  repairStructures: true, // ремонт повреждённых структур (дороги — только башни)
  buildStructures: true, // стройка по construction site
  fillTowers: true, // подвоз энергии в башни
  upgradeController: true, // прокачка контроллера

  factory: false, // factory.manager.run() — 600 энергии → 50 battery
  powerSpawn: true, // powerSpawn.manager.run() — processPower() (GPL)
};

// ── TASK_GEN_INTERVAL ────────────────────────────────────────────────────
// Как часто перегенерировать очередь категории задач (в тиках). Генератор
// идемпотентен (дедуп по taskType|targetId|resourceType), поэтому пропуск тика
// не создаёт дублей — только откладывает реакцию на смену состояния цели.
// 1 — каждый тик. Фаза расписания сдвигается по имени комнаты, чтобы комнаты
// не пересобирали очереди в один и тот же тик (синхронные пики CPU).
const TASK_GEN_INTERVAL = {
  fillSpawnsExtensions: 1, // критичная логистика энергии спавна — каждый тик
  fillPowerSpawnPower: 5,
  fillPowerSpawnEnergy: 5,
  fillTerminalEnergy: 3,
  fillTerminalResources: 3,
  fillFactoryEnergy: 5,
  collectFactoryBattery: 5,
  repairStructures: 3,
  buildStructures: 5,
  fillTowers: 2,
  upgradeController: 5,
};
const TASK_GEN_INTERVAL_DEFAULT = 1;

module.exports = {
  TASK_CONFIG,
  TASK_GEN_INTERVAL,
  TASK_GEN_INTERVAL_DEFAULT,
};
