// ===================================================
// TASK.GENERATORS.JS — фасад генераторов задач
// ===================================================
// Единая точка входа генераторов блока task/: наружу отдаёт те же ОДИННАДЦАТЬ
// генераторов и в том же порядке, что были до разбиения 04.10.2026 (было 686
// строк в одном файле). Имя модуля и набор экспортов не меняются, поэтому
// потребители (room/run.js:12 и его 11 вызовов на room/run.js:103-176,
// tests/sites.index.test.js:115, tests/fill.spawns.test.js:70,
// tests/roomstate.test.js:343) правок не требуют.
//
// Логика разложена по семействам целей:
//   task/gen.spawns.js     — spawn и extension (самый дорогой цикл генерации);
//   task/gen.powerSpawn.js — power и energy PowerSpawn;
//   task/gen.factory.js    — энергия фабрики и вывоз батарей;
//   task/gen.terminal.js   — энергия терминала и отправка ресурсов;
//   task/gen.towers.js     — наполнение башен;
//   task/gen.repair.js     — ремонт повреждённых структур;
//   task/gen.build.js      — стройка;
//   task/gen.upgrade.js    — апгрейд контроллера.
// Каждый модуль отвечает только за свои категории TASK_CHAIN (правило 4
// DEVELOPMENT_RULES.md) и не зависит ни от какого другого модуля блока.
//
// require("./task/x") ниже Node разрешает как обычно; на шарде движок
// отбрасывает ведущий "./" и ищет имя от корня (Gruntfile.js:22-25).
// ===================================================
const spawns = require("./task/gen.spawns");
const powerSpawn = require("./task/gen.powerSpawn");
const factory = require("./task/gen.factory");
const terminal = require("./task/gen.terminal");
const towers = require("./task/gen.towers");
const repair = require("./task/gen.repair");
const build = require("./task/gen.build");
const upgrade = require("./task/gen.upgrade");

module.exports = {
  generateFillSpawnsExtensions: spawns.generateFillSpawnsExtensions,
  generateFillPowerSpawnPower: powerSpawn.generateFillPowerSpawnPower,
  generateFillPowerSpawnEnergy: powerSpawn.generateFillPowerSpawnEnergy,
  generateFillFactoryEnergy: factory.generateFillFactoryEnergy,
  generateCollectFactoryBattery: factory.generateCollectFactoryBattery,
  generateFillTerminalEnergy: terminal.generateFillTerminalEnergy,
  generateFillTerminalResources: terminal.generateFillTerminalResources,
  generateFillTowers: towers.generateFillTowers,
  generateRepairStructures: repair.generateRepairStructures,
  generateBuildStructures: build.generateBuildStructures,
  generateUpgradeController: upgrade.generateUpgradeController,
};
