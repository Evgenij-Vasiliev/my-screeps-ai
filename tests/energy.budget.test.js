"use strict";
/**
 * ENERGY.BUDGET.TEST.JS — периодические имперские бюджеты направлений.
 *
 * Проверяем:
 *   1) лимиты считаются от числа источников (30 000 за 300 тиков);
 *   2) лимит направления общий, задача списывает полную стоимость;
 *   3) при остатке меньше стоимости задача не выдаётся;
 *   4) направления независимы;
 *   5) граница периода полностью обновляет лимиты;
 *   6) старое списание не повторяется;
 *   7) задача без направления бюджет не трогает.
 *
 * Запуск: node tests/energy.budget.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

global.Memory = {};
global.Game = { time: 0, rooms: {}, creeps: {} };
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_POWER = "power";
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";

const { BUDGET } = require("../constants");
const energyPolicy = require("../energy.policy");

for (let i = 1; i <= 5; i++) {
  Game.rooms["W1N" + i] = {
    name: "W1N" + i,
    controller: { my: true },
    sources: [{}, {}],
  };
}

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

console.log("1. Расчёт от источников");
{
  const s = energyPolicy.budgetStatus();
  check("период 0", s.period === 0, s.period);
  check("добыча 30 000", s.income === 30000, s.income);
  check("фабрики 11 700", s.limits.factory === 11700, s.limits.factory);
  check("spawn 8 010", s.limits.spawn === 8010, s.limits.spawn);
  check("towers 510", s.limits.towers === 510, s.limits.towers);
}

console.log("\n1b. Старое состояние бюджета сбрасывается версией");
{
  energyPolicy.budgetStatus().version = 0;
  const reset = energyPolicy.budgetStatus();
  check("версия восстановлена", reset.version === BUDGET.VERSION, reset.version);
  check("лимит фабрик после сброса", reset.remaining.factory === 11700, reset.remaining.factory);
}

console.log("\n1c. budgetCost — фактическая потребность цели");
{
  const t = { direction: "spawn", maxEnergy: 1600, budgetCost: 50 };
  check("списано 50, не 1600", energyPolicy.tryChargeTaskBudget(t) === true);
  check("остаток spawn 7960", energyPolicy.budgetStatus().remaining.spawn === 7960, energyPolicy.budgetStatus().remaining.spawn);
}

console.log("\n1d. Старая spawn-задача нормализуется по потребности цели");
{
  Game.getObjectById = id =>
    id === "oldSpawnTarget" ? { energyCapacity: 100, energy: 0 } : null;
  const old = {
    direction: "spawn",
    targetId: "oldSpawnTarget",
    reserve: 1600,
    maxEnergy: 1600,
  };
  check("списано 100, не 1600", energyPolicy.tryChargeTaskBudget(old) === true);
  check("остаток spawn 7860", energyPolicy.budgetStatus().remaining.spawn === 7860, energyPolicy.budgetStatus().remaining.spawn);
  check("maxEnergy нормализован", old.maxEnergy === 100, old.maxEnergy);
  delete Game.getObjectById;
}

console.log("\n1e. Защищённый резерв spawn");
{
  energyPolicy.budgetStatus().remaining.spawn = 600;
  const ordinary = { direction: "spawn", maxEnergy: 200 };
  check("обычная задача не трогает резерв", energyPolicy.tryChargeTaskBudget(ordinary) === false);
  check("остаток не изменился", energyPolicy.budgetStatus().remaining.spawn === 600, energyPolicy.budgetStatus().remaining.spawn);
  const mandatory = { direction: "spawn", maxEnergy: 200, mandatory: true };
  check("обязательная задача использует резерв", energyPolicy.tryChargeTaskBudget(mandatory) === true);
  check("остаток 400", energyPolicy.budgetStatus().remaining.spawn === 400, energyPolicy.budgetStatus().remaining.spawn);
  check("обычная после резерва всё ещё blocked", energyPolicy.tryChargeTaskBudget({ direction: "spawn", maxEnergy: 200 }) === false);
}

console.log("\n2. Полная стоимость задачи и общий лимит");
{
  const first = { direction: "factory", maxEnergy: 600 };
  check("первая задача списана", energyPolicy.tryChargeTaskBudget(first) === true);
  check("остаток 11 100", energyPolicy.budgetStatus().remaining.factory === 11100, energyPolicy.budgetStatus().remaining.factory);

  let charged = 1;
  for (;;) {
    const t = { direction: "factory", maxEnergy: 600 };
    if (!energyPolicy.tryChargeTaskBudget(t)) break;
    charged++;
  }
  check("всего 19 задач по 600", charged === 19, charged);
  check("остаток 300", energyPolicy.budgetStatus().remaining.factory === 300, energyPolicy.budgetStatus().remaining.factory);
  check("20-я не проходит", energyPolicy.budgetAvailable({ direction: "factory", maxEnergy: 600 }) === false);
}

console.log("\n3. Направления независимы и проверка не списывает");
{
  const tower = { direction: "towers", maxEnergy: 500 };
  check("башни ещё имеют бюджет", energyPolicy.tryChargeTaskBudget(tower) === true);
  check("остаток башен 10", energyPolicy.budgetStatus().remaining.towers === 10, energyPolicy.budgetStatus().remaining.towers);
  check("задача не хранит budgetPeriod/budgetCharged", !("budgetPeriod" in tower) && !("budgetCharged" in tower));
  check("budgetAvailable не списывает", energyPolicy.budgetAvailable(tower) === false);
  check("остаток башен всё ещё 10", energyPolicy.budgetStatus().remaining.towers === 10, energyPolicy.budgetStatus().remaining.towers);
}

console.log("\n4. Граница периода");
{
  Game.time = BUDGET.PERIOD_TICKS;
  const s = energyPolicy.budgetStatus();
  check("новый период", s.period === 1, s.period);
  check("лимит фабрик восстановлен", s.remaining.factory === 11700, s.remaining.factory);
  check("лимит башен восстановлен", s.remaining.towers === 510, s.remaining.towers);
  const newTask = { direction: "factory", maxEnergy: 600 };
  check("новая задача списывает новый период", energyPolicy.tryChargeTaskBudget(newTask) === true);
  check("остаток 11 100", energyPolicy.budgetStatus().remaining.factory === 11100, energyPolicy.budgetStatus().remaining.factory);
  check("новая задача не хранит бюджетные поля", !("budgetPeriod" in newTask) && !("budgetCharged" in newTask));
}

console.log("\n5. Задача без направления");
{
  check("без направления — true", energyPolicy.tryChargeTaskBudget({ maxEnergy: 600 }) === true);
  check("бюджеты не изменились", energyPolicy.budgetStatus().remaining.factory === 11100, energyPolicy.budgetStatus().remaining.factory);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
