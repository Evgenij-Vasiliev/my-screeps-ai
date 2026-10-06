// ===================================================
// TASK/gen.powerSpawn.js — генераторы PowerSpawn: power и energy
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Две категории TASK_CHAIN на одну структуру: processPower и запас энергии.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const econ = require("econ");
const { POWER_SPAWN } = require("../constants");

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

  // ── ЗАДАЧА СТАВИТСЯ ТОЛЬКО ПРИ ПОЛОЖИТЕЛЬНОМ САЛЬДО ───────────────────
  // Принцип владельца (05.10.2026): «такой же принцип и наполнения
  // powerSpawn» — задача на доставку энергии появляется, только когда энергия
  // комнаты (склад + терминал) за последнее окно ВЫРОСЛА (econ.roomGrowth).
  //
  // До этого генератор был выключен флагом TASK_CONFIG.fillPowerSpawnEnergy
  // (false) при том, что тумблер systems.js показывал true, и powerSpawn стоял
  // с power 11-88 и энергией 6-38, тогда как processPower требует всего 50
  // энергии (engine power-spawns/process-power.js: energy < amount *
  // POWER_SPAWN_ENERGY_RATIO(50) -> выход). Живой замер tick 83451761.
  //
  // Сама структура о складе не знает (powerSpawn.manager.js) — расход
  // регулирует только очередь задач, как и у фабрики.
  if (econ.roomGrowth(roomName) <= 0) {
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

module.exports = {
  generateFillPowerSpawnPower,
  generateFillPowerSpawnEnergy,
};
