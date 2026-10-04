// ===================================================
// TASK.EXECUTORS.JS — фасад исполнителей задач
// ===================================================
// Единая точка входа исполнителей блока task/: наружу отдаёт те же имена и тот
// же объект executors, что были до разбиения 04.10.2026 (было 957 строк в
// одном файле). Состав и порядок не меняются, поэтому потребители
// (task/runner.js:2, tests/executor.power.test.js:81,
// tests/role.micro.test.js:125) правок не требуют.
//
// Логика разложена по семействам — тем же, что у генераторов (task/gen.*.js):
//   task/exec.common.js     — resolveTarget, isValidTask, isTargetFull;
//   task/exec.spawns.js     — наполнение spawn и extension;
//   task/exec.factory.js    — энергия фабрики и вывоз батарей;
//   task/exec.towers.js     — наполнение башен;
//   task/exec.terminal.js   — энергия терминала и отправка ресурсов;
//   task/exec.powerSpawn.js — power и energy PowerSpawn;
//   task/exec.repair.js     — ремонт;
//   task/exec.build.js      — стройка;
//   task/exec.upgrade.js    — апгрейд контроллера.
// Каждый модуль отвечает только за своё семейство (правило 4
// DEVELOPMENT_RULES.md) и зависит лишь от exec.common (правило CPU 6:
// executors не резолвят id до проверки стора — DEVELOPMENT_RULES.md:173-187).
//
// require("./task/x") ниже Node разрешает как обычно; на шарде движок
// отбрасывает ведущий "./" и ищет имя от корня (Gruntfile.js:22-25).
// ===================================================
const common = require("./task/exec.common");
const spawns = require("./task/exec.spawns");
const factory = require("./task/exec.factory");
const towers = require("./task/exec.towers");
const terminal = require("./task/exec.terminal");
const powerSpawn = require("./task/exec.powerSpawn");
const repair = require("./task/exec.repair");
const build = require("./task/exec.build");
const upgrade = require("./task/exec.upgrade");

module.exports = {
  // Кэш резолва объектов Game, общий для всей империи на тик. Экспортирован для
  // worker.runner: выбор задачи (какая цель ближе) считает расстояние до тех же
  // id, что потом резолвит исполнитель, и без общего кэша один и тот же
  // Game.getObjectById платился бы дважды — при выборе и при исполнении.
  // Контракт тот же, что у внутренних вызовов: (id) => RoomObject | null.
  resolveTarget: common.resolveTarget,
  executeFillSpawnsExtensions: spawns.executeFillSpawnsExtensions,
  executeFillFactoryEnergy: factory.executeFillFactoryEnergy,
  executeFillTowers: towers.executeFillTowers,
  executeFillPowerSpawnPower: powerSpawn.executeFillPowerSpawnPower,
  executeFillPowerSpawnEnergy: powerSpawn.executeFillPowerSpawnEnergy,
  executors: {
    fillSpawnsExtensions: spawns.executeFillSpawnsExtensions,
    fillTerminalEnergy: terminal.executeFillTerminalEnergy,
    fillTerminalResources: terminal.executeFillTerminalResources,
    fillPowerSpawnPower: powerSpawn.executeFillPowerSpawnPower,
    fillPowerSpawnEnergy: powerSpawn.executeFillPowerSpawnEnergy,
    fillFactoryEnergy: factory.executeFillFactoryEnergy,
    collectFactoryBattery: factory.executeCollectFactoryBattery,
    fillTowers: towers.executeFillTowers,
    repairStructures: repair.executeRepairStructures,
    buildStructures: build.executeBuildStructures,
    upgradeController: upgrade.executeUpgradeController,
  },
};
