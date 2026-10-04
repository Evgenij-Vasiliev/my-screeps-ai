// ===================================================
// TASK/gen.factory.js — генераторы фабрики: энергия и вывоз батарей
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Две категории TASK_CHAIN на одну структуру: запас энергии и вывоз произведённого.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const { STORAGE, FACTORY, TASK_CONFIG } = require("../constants");

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

module.exports = {
  generateFillFactoryEnergy,
  generateCollectFactoryBattery,
};
