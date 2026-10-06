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
const econ = require("econ");

const FIELDS_FILLFACTORYENERGY = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateFillFactoryEnergyTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillFactoryEnergy", candidate, FIELDS_FILLFACTORYENERGY);
}

function generateFillFactoryEnergy(roomState) {
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

  // ── ЗАДАЧА СТАВИТСЯ ТОЛЬКО ПРИ ПОЛОЖИТЕЛЬНОМ САЛЬДО ───────────────────
  // Принцип владельца (05.10.2026): «есть положительное сальдо по энергии
  // (хранилище-терминал) — создаётся задача завезти энергию на фабрику, то
  // есть задача создаётся только при УВЕЛИЧЕНИИ энергии в комнате; такой же
  // принцип и наполнения powerSpawn».
  //
  // saldo = энергия комнаты (склад + терминал) за последнее окно: выросла —
  // задача есть, упала или стоит — задачи нет.
  //
  // ЧТО ЭТИМ ЗАКРЫТО. Раньше генератор возил энергию, пока в фабрике есть
  // ЛЮБОЕ свободное место (условие выше), то есть до 50 000 — и склады упали
  // 190-208k -> 152-173k (живой замер tick 83463640: в фабрике E35S37 лежало
  // 49 215 энергии при нуле батарей, rate империи -870/тик). Теперь как только
  // энергия комнаты перестала расти — в том числе потому, что её вывезли в
  // фабрику, — новые задачи не ставятся, и закачка останавливается сама.
  //
  // Никаких порогов свободных средств склада здесь нет: сама фабрика о складе
  // не знает (factory.manager.js), расход регулирует только очередь задач.
  if (econ.roomGrowth(roomName) <= 0) {
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
