/**
 * ВЫКЛЮЧАТЕЛЬ СИСТЕМ.
 *
 * true  — система включена (работает как обычно)
 * false — система выключена
 *
 * Комнаты выключаются по имени комнаты, например:  E35S37: false,
 * Здесь больше ничего нет — только тумблеры.
 */
module.exports = {
  // ── империя ────────────────────────────────────────────────
  roomManager: true, // вся комнатная логика
  terminalNetwork: true, // межкомнатная логистика
  marketManager: true, // рынок

  // ── комната ────────────────────────────────────────────────
  labManager: true, // лаборатории
  spawnManager: true, // спавн крипов
  creeps: true, // исполнение ролей
  towers: true, // башни
  linkManager: true, // линки
  factoryManager: true, // фабрика
  powerSpawnManager: true, // powerSpawn

  // ── крипы ──────────────────────────────────────────────────
  boostManager: false, // буст крипов

  // ── роли (false — роль не работает и не спавнится) ─────────
  harvester: false,
  upgrader: false,
  builder: false,
  repairer: false,
  miner: true,
  towerSupplier: false,
  linkWorker: true,
  labWorker: true,
  mineralMiner: true,
  worker: true,

  // ── генераторы задач (false — новые задачи не ставятся) ────
  fillSpawnsExtensions: true,
  fillPowerSpawnPower: false,
  fillPowerSpawnEnergy: false,
  fillFactoryEnergy: false,
  collectFactoryBattery: false,
  fillTerminalEnergy: true,
  fillTerminalResources: true,
  fillTowers: true,
  repairStructures: true,
  buildStructures: true,
  upgradeController: true,

  // ── комнаты (по имени комнаты) ─────────────────────────────
  // E35S37: false,
};
