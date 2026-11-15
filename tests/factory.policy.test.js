"use strict";
/**
 * FACTORY.POLICY.TEST.JS — этап 3: производство батареек по политике.
 *
 * Проверяем:
 *   1) сток батареек >= 20 000 блокирует производство и подвоз;
 *   2) при стоке ниже цели и достаточном бюджете разрешена одна партия;
 *   3) склад < 200 000 или free < 1 200 блокируют;
 *   4) интервал 10 тиков между партиями;
 *   5) factory.manager не производит без 600 энергии/кулдауна;
 *   6) fillFactoryEnergy несёт reserve/maxEnergy = 600 и не создаётся
 *      без разрешения;
 *   7) несколько фабрик в разных комнатах проверяются независимо.
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
global.Game = { time: 1000, creeps: {}, rooms: {} };

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
  // Каждый сценарий начинает с чистого имперского стока батареек.
  for (const name in Game.rooms) {
    const r = Game.rooms[name];
    if (r.storage) r.storage.store.battery = 0;
    if (r.terminal) r.terminal.store.battery = 0;
  }
  const name = "W1N" + ++seq;
  const storage = {
    id: "st" + seq,
    store: { energy, getFreeCapacity: () => 1000000 },
  };
  const terminal = { store: { battery: 0 } };
  const factory = {
    id: "f" + seq,
    cooldown: 0,
    store: {
      energy: factoryEnergy || 0,
      battery: 0,
      getFreeCapacity: type => (type === RESOURCE_BATTERY ? 50000 : 0),
    },
    produceCalls: 0,
    produce() {
      this.produceCalls++;
      return OK;
    },
  };
  const room = {
    name,
    controller: { my: true },
    storage,
    terminal,
    factory,
  };
  Game.rooms[name] = room;
  Memory.rooms[name] = { tasks: {} };
  return { roomName: name, room, storage, factory };
}

function tasks(roomName, type) {
  return (Memory.rooms[roomName].tasks[type] || []);
}
function setStock(room, amount) {
  room.storage.store.battery = amount;
}

console.log("1. Сток батареек блокирует производство");
{
  const s = roomState(250000, 0, 600);
  setStock(s.room, 71200);
  check("factoryAllowed = false при стоке 71 200", energyPolicy.factoryAllowed(s.room) === false);
  s.factory.produceCalls = 0;
  factoryManager.run(s);
  check("produce не вызван", s.factory.produceCalls === 0, s.factory.produceCalls);
  taskGenerators.generateFillFactoryEnergy(s);
  check("fillFactoryEnergy не создан", tasks(s.roomName, "fillFactoryEnergy").length === 0);
}

console.log("\n2. Ниже цели и достаточный бюджет разрешает партию");
{
  const s = roomState(210000, 0, 0);
  setStock(s.room, FACTORY.STOCK_TARGET - 1);
  check("factoryAllowed = true", energyPolicy.factoryAllowed(s.room) === true);
  taskGenerators.generateFillFactoryEnergy(s);
  const t = tasks(s.roomName, "fillFactoryEnergy")[0];
  check("задача создана", !!t);
  check("reserve = 600", t && t.reserve === 600, t && t.reserve);
  check("maxEnergy = 600", t && t.maxEnergy === 600, t && t.maxEnergy);
}

console.log("\n3. Склад и свободный бюджет");
{
  const low = roomState(FACTORY.MIN_STORAGE - 1, 0, 0);
  check("склад < 200k — false", energyPolicy.factoryAllowed(low.room) === false);
  const noFree = roomState(170500, 0, 0); // free = 500 < 1200
  check("free < 1200 — false", energyPolicy.factoryAllowed(noFree.room) === false);
}

console.log("\n4. Интервал 10 тиков");
{
  const s = roomState(210000, 0, 0);
  Memory.rooms[s.roomName].factoryNextBatchAt = Game.time + 5;
  check("интервал не истёк — false", energyPolicy.factoryAllowed(s.room) === false);
  Memory.rooms[s.roomName].factoryNextBatchAt = Game.time;
  check("интервал истёк — true", energyPolicy.factoryAllowed(s.room) === true);
}

console.log("\n5. factory.manager: полная партия и интервал");
{
  const s = roomState(210000, 0, FACTORY.BATCH_ENERGY);
  s.factory.produceCalls = 0;
  factoryManager.run(s);
  check("produce вызван один раз", s.factory.produceCalls === 1, s.factory.produceCalls);
  check(
    "factoryNextBatchAt = time + 10",
    Memory.rooms[s.roomName].factoryNextBatchAt === Game.time + FACTORY.INTERVAL,
    Memory.rooms[s.roomName].factoryNextBatchAt,
  );
  factoryManager.run(s);
  check("второй запуск в интервале запрещён", s.factory.produceCalls === 1, s.factory.produceCalls);

  const short = roomState(210000, 0, FACTORY.BATCH_ENERGY - 1);
  short.factory.produceCalls = 0;
  factoryManager.run(short);
  check("меньше 600 — produce не вызван", short.factory.produceCalls === 0);
}

console.log("\n6. Несколько фабрик в разных комнатах");
{
  const a = roomState(210000, 0, 0);
  const b = roomState(210000, 0, 0);
  setStock(a.room, 0);
  setStock(b.room, 0);
  check("комната A разрешена", energyPolicy.factoryAllowed(a.room) === true);
  check("комната B разрешена", energyPolicy.factoryAllowed(b.room) === true);
  taskGenerators.generateFillFactoryEnergy(a);
  taskGenerators.generateFillFactoryEnergy(b);
  check("задача A создана", tasks(a.roomName, "fillFactoryEnergy").length === 1);
  check("задача B создана", tasks(b.roomName, "fillFactoryEnergy").length === 1);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
