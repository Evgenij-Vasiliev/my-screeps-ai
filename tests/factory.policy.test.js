"use strict";
/**
 * FACTORY.POLICY.TEST.JS — фабрика управляется бюджетом задач, а не запасом.
 *
 * Проверяем:
 *   1) запас 71 200/20 000 не мешает создать fillFactoryEnergy;
 *   2) задача создаётся при любой потребности фабрики в энергии;
 *   3) при полной энергии задачи нет;
 *   4) задача несёт полные reserve/maxEnergy=600;
 *   5) достаточный бюджет списывает 600, недостаточный — не выдаёт;
 *   6) другие направления не затронуты;
 *   7) производство с уже имеющейся энергией работает независимо от стока;
 *   8) несколько фабрик используют общий бюджет.
 *
 * Запуск: node tests/factory.policy.test.js
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

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_BATTERY = "battery";
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
global.Memory = { rooms: {} };
global.Game = { time: 0, creeps: {}, rooms: {} };

// Пять комнат-источников: расчётная добыча 10 * 3000 = 30 000.
for (let i = 0; i < 5; i++) {
  Game.rooms["S" + i] = {
    name: "S" + i,
    controller: { my: true },
    sources: [{}, {}],
  };
}

const { FACTORY } = require("../constants");
const systems = require("../systems");
const taskManager = require("../task.manager");
const taskGenerators = require("../task.generators");
const factoryManager = require("../factory.manager");
const energyPolicy = require("../energy.policy");

systems.fillFactoryEnergy = true;

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

let seq = 0;
function roomState(energy, battery, factoryEnergy) {
  const name = "W1N" + ++seq;
  const storage = {
    id: "st" + seq,
    store: { energy, battery, getFreeCapacity: () => 1000000 },
  };
  const factory = {
    id: "f" + seq,
    cooldown: 0,
    produceCalls: 0,
    store: {
      energy: factoryEnergy || 0,
      battery: 0,
      getFreeCapacity: type => (type === RESOURCE_BATTERY ? 50000 : 0),
    },
    produce() {
      this.produceCalls++;
      return OK;
    },
  };
  Memory.rooms[name] = { tasks: {} };
  Game.rooms[name] = { name, controller: { my: true }, storage, factory };
  return { roomName: name, room: Game.rooms[name], storage, factory };
}
function tasks(room, type) {
  return (Memory.rooms[room].tasks[type] || []);
}

console.log("1. Запас батареек не блокирует fillFactoryEnergy");
{
  const high = roomState(250000, 71200, 0);
  taskGenerators.generateFillFactoryEnergy(high);
  const t = tasks(high.roomName, "fillFactoryEnergy")[0];
  check("при 71 200 задача создана", !!t);
  check("reserve/maxEnergy 600", t && t.reserve === 600 && t.maxEnergy === 600);
  check("direction factory", t && t.direction === "factory");

  const target = roomState(210000, 20000, 0);
  taskGenerators.generateFillFactoryEnergy(target);
  check("при ровно 20 000 задача создана", tasks(target.roomName, "fillFactoryEnergy").length === 1);
}

console.log("\n2. Нет потребности — нет задачи");
{
  const full = roomState(250000, 71200, FACTORY.BATCH_ENERGY);
  taskGenerators.generateFillFactoryEnergy(full);
  check("полная энергия — задачи нет", tasks(full.roomName, "fillFactoryEnergy").length === 0);
}

console.log("\n3. Производство не зависит от стока");
{
  const s = roomState(250000, 71200, FACTORY.BATCH_ENERGY);
  s.factory.produceCalls = 0;
  factoryManager.run(s);
  check("produce вызван", s.factory.produceCalls === 1, s.factory.produceCalls);

  const short = roomState(250000, 71200, FACTORY.BATCH_ENERGY - 1);
  short.factory.produceCalls = 0;
  factoryManager.run(short);
  check("меньше 600 — produce не вызван", short.factory.produceCalls === 0);
}

console.log("\n4. Бюджет: полная стоимость и недостаток");
{
  delete Memory.energyBudget;
  const state = energyPolicy.budgetStatus();
  check("лимит factory 11 700", state.limits.factory === 11700, state.limits.factory);
  state.remaining.factory = 600;
  const t = { direction: "factory", maxEnergy: 600 };
  check("достаточный бюджет списывает 600", energyPolicy.tryChargeTaskBudget(t) === true);
  check("остаток 0", energyPolicy.budgetStatus().remaining.factory === 0);
  check("недостаточный бюджет не списывает", energyPolicy.tryChargeTaskBudget({ direction: "factory", maxEnergy: 600 }) === false);
  check("spawn не затронут", energyPolicy.budgetStatus().remaining.spawn === 8010, energyPolicy.budgetStatus().remaining.spawn);
}

console.log("\n5. Несколько фабрик — общий бюджет");
{
  const a = roomState(250000, 71200, 0);
  const b = roomState(250000, 71200, 0);
  taskGenerators.generateFillFactoryEnergy(a);
  taskGenerators.generateFillFactoryEnergy(b);
  check("задача A создана", tasks(a.roomName, "fillFactoryEnergy").length === 1);
  check("задача B создана", tasks(b.roomName, "fillFactoryEnergy").length === 1);
  const budget = energyPolicy.budgetStatus();
  check("бюджет factory общий", budget.limits.factory === 11700);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
