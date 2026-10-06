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
  miner: true,
  linkWorker: true,
  labWorker: true,
  mineralMiner: true,
  worker: true,

  // ── генераторы задач (false — новые задачи не ставятся) ────
  // ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ (правка 05.10.2026). Раньше эти же 11 имён
  // дублировались булевыми флагами в constants/tasks.js (TASK_CONFIG), и
  // гейт room/run.js требовал И то, И другое — решало более строгое.
  // Значения разошлись: здесь fillPowerSpawnPower/Energy, fillFactoryEnergy,
  // collectFactoryBattery и fillTerminalResources стояли true, а в TASK_CONFIG
  // — false. Из-за этого фабрика и powerSpawn НЕ РАБОТАЛИ, хотя выключатель
  // показывал «включено»: живой замер tick 83451761 — фабрики с 32-452
  // энергии при требуемых 600 (COMMODITIES: battery = 600 energy -> 50),
  // powerSpawn с power 11-88 и энергией 6-38 при требуемых 50
  // (engine power-spawns/process-power.js). Флаги из TASK_CONFIG удалены,
  // теперь выключение системы — только здесь.
  fillSpawnsExtensions: true,
  fillPowerSpawnPower: true,
  fillPowerSpawnEnergy: true,
  fillTerminalEnergy: true,
  // fillTerminalResources: false — это РЕЖИМ, а не просто выключение: true
  // означает «лить в терминал всё, чего меньше 10 000» (task/gen.terminal.js),
  // false — «грузить только заявки сети» (Memory.rooms[].terminalExports).
  // Оставлено false осознанно: живой замер tick ~83451500 показал терминалы,
  // занятые на ~250 000 из 300 000 (энергия ~100k + ресурсы ~145k), поэтому
  // режим «лить всё» залил бы остаток места и вытеснил довоз реагентов.
  fillTerminalResources: false,
  fillFactoryEnergy: true,
  collectFactoryBattery: true,
  fillTowers: true,
  repairStructures: true,
  buildStructures: true,
  upgradeController: true,

  // ── комнаты (по имени комнаты) ─────────────────────────────
  // E35S37: false,
};
