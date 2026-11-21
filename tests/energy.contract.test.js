"use strict";
/**
 * ENERGY.CONTRACT.TEST.JS — этап 2: контракт reserve/maxEnergy.
 *
 * Проверяем:
 *   1) генераторы выставляют reserve/maxEnergy для fillTowers,
 *      fillFactoryEnergy, fillSpawnsExtensions;
 *   2) фактическое снятие ограничено maxEnergy и свободной вместимостью carry;
 *   3) повторный CONTINUE не снимает бюджет заново;
 *   4) reserved() учитывает energyTaken (остаток контракта).
 *
 * Запуск: node tests/energy.contract.test.js
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
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.RESOURCE_ENERGY = "energy";
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
global.Game = {
  time: 1000,
  creeps: { c1: { name: "c1" } },
  rooms: {},
  getObjectById: () => null,
};

const systems = require("../systems");
const taskManager = require("../task.manager");
const taskGenerators = require("../task.generators");
const taskExecutors = require("../task.executors");
const energySource = require("../energySource");
const energyPolicy = require("../energy.policy");

systems.fillTowers = true;
systems.fillFactoryEnergy = true;
systems.fillSpawnsExtensions = true;

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

function tasks(room, type) {
  const mem = Memory.rooms[room];
  return (mem && mem.tasks && mem.tasks[type]) || [];
}

console.log("1. Генераторы выставляют контракт");
{
  const room = "W1N1";
  Memory.rooms[room] = { tasks: {} };
  taskGenerators.generateFillTowers({
    roomName: room,
    storage: { id: "storage1" },
    towers: [{ id: "tower1", energy: 0 }],
  });
  const t = tasks(room, "fillTowers")[0];
  check("fillTowers reserve=500", t && t.reserve === 500, t && t.reserve);
  check("fillTowers maxEnergy=500", t && t.maxEnergy === 500, t && t.maxEnergy);
}

{
  const room = "W1N2";
  Memory.rooms[room] = { tasks: {} };
  Game.rooms[room] = {
    name: room,
    storage: { store: { energy: 230000 } },
  };
  taskGenerators.generateFillFactoryEnergy({
    roomName: room,
    storage: { id: "storage2", store: { energy: 230000 } },
    factory: {
      id: "factory2",
      store: { energy: 0, getFreeCapacity: () => 50000 },
    },
  });
  const t = tasks(room, "fillFactoryEnergy")[0];
  check("fillFactoryEnergy reserve=600", t && t.reserve === 600, t && t.reserve);
  check("fillFactoryEnergy maxEnergy=600", t && t.maxEnergy === 600, t && t.maxEnergy);
}

{
  const room = "W1N3";
  Memory.rooms[room] = { tasks: {} };
  taskGenerators.generateFillSpawnsExtensions({
    roomName: room,
    storage: { id: "storage3" },
    spawns: [{ id: "spawn3", energy: 0, energyCapacity: 300 }],
    extensions: [],
    room: { energyAvailable: 0, energyCapacityAvailable: 300 },
  });
  const t = tasks(room, "fillSpawnsExtensions")[0];
  check("fillSpawns reserve=300 (потребность цели)", t && t.reserve === 300, t && t.reserve);
  check("fillSpawns maxEnergy=300", t && t.maxEnergy === 300, t && t.maxEnergy);
}

console.log("\n2. Фактическое снятие и повторный CONTINUE");
{
  const withdrawAmounts = [];
  const creep = {
    memory: {},
    store: {
      energy: 0,
      getFreeCapacity: () => 1600,
    },
    room: {
      storage: { id: "storage4", store: { energy: 1000000 } },
    },
    withdraw(obj, resourceType, amount) {
      withdrawAmounts.push(amount);
      this.store.energy += amount;
      return OK;
    },
    transfer: () => OK,
    travelTo: () => {},
  };
  const tower = {
    id: "tower4",
    store: { energy: 0, getFreeCapacity: () => 1000 },
  };
  Game.getObjectById = id => (id === "tower4" ? tower : null);
  const task = {
    type: "transfer",
    sourceId: "storage4",
    targetId: "tower4",
    resourceType: "energy",
    reserve: 500,
    maxEnergy: 500,
  };
  const r1 = taskExecutors.executors.fillTowers(creep, task);
  check("первое снятие = 1600", withdrawAmounts[0] === 1600, withdrawAmounts[0]);
  check("энергия в carry = 1600", creep.store.energy === 1600, creep.store.energy);
  check("первый вызов CONTINUE", r1 === "CONTINUE", r1);
  check("energyTaken = 500", task.energyTaken === 500, task.energyTaken);

  // Имитируем повторный CONTINUE с пустым carry: бюджет уже исчерпан.
  creep.store.energy = 0;
  creep.memory.working = false;
  const r2 = taskExecutors.executors.fillTowers(creep, task);
  check("повторного снятия нет", withdrawAmounts.length === 1, withdrawAmounts.length);
  check("второй вызов SKIP", r2 === "SKIP", r2);
}

console.log("\n3. reserved() учитывает energyTaken");
{
  const room = { name: "W1N5", storage: { store: { energy: 171000 } } };
  Memory.rooms[room.name] = {
    tasks: {
      fillTowers: [
        { taskId: "a", reserve: 500, reservedBy: "c1", energyTaken: 300 },
      ],
    },
  };
  check("остаток резерва = 200", energyPolicy.remainingReserve(
    Memory.rooms[room.name].tasks.fillTowers[0],
  ) === 200);
  check("reserved = 200", energyPolicy.reserved(room) === 200, energyPolicy.reserved(room));
  check("free = 800", energyPolicy.free(room) === 800, energyPolicy.free(room));
}


console.log("\n4. Carry, ошибки и повторное назначение");
{
  // Нельзя запросить больше, чем есть сверх резерва: 150100 - 150000 = 100.
  const amounts = [];
  const creep = {
    memory: {},
    store: { energy: 0, getFreeCapacity: () => 1600 },
    room: { storage: { id: "s", store: { energy: 150100 } } },
    withdraw(obj, res, amount) {
      amounts.push(amount);
      this.store.energy += amount;
      return OK;
    },
    travelTo: () => {},
  };
  const ok = energySource.withdrawFromStorage(creep, false, 500);
  check("снятие обрезано остатком сверх резерва", ok === true && amounts[0] === 100, amounts[0]);
}

{
  // Ошибка withdraw не увеличивает energyTaken и даёт SKIP.
  const creep = {
    memory: {},
    store: { energy: 0, getFreeCapacity: () => 1600 },
    room: { storage: { id: "s", store: { energy: 1000000 } } },
    withdraw: () => ERR_NOT_ENOUGH_RESOURCES,
    transfer: () => OK,
    travelTo: () => {},
  };
  const tower = { id: "tower6", store: { energy: 0, getFreeCapacity: () => 1000 } };
  Game.getObjectById = id => (id === "tower6" ? tower : null);
  const task = {
    type: "transfer",
    sourceId: "s",
    targetId: "tower6",
    resourceType: "energy",
    reserve: 500,
    maxEnergy: 500,
  };
  const r = taskExecutors.executors.fillTowers(creep, task);
  check("ошибка не увеличила energyTaken", !task.energyTaken, task.energyTaken);
  check("ошибка даёт SKIP", r === "SKIP", r);
}

{
  // Сняли 500, 300 доставили, 200 осталось в carry: повторного снятия нет.
  const amounts = [];
  const creep = {
    memory: {},
    store: { energy: 0, getFreeCapacity: () => 1600 },
    room: { storage: { id: "s", store: { energy: 1000000 } } },
    withdraw(obj, res, amount) {
      amounts.push(amount);
      this.store.energy += amount;
      return OK;
    },
    transfer: () => OK,
    travelTo: () => {},
  };
  const tower = { id: "tower7", store: { energy: 0, getFreeCapacity: () => 1000 } };
  Game.getObjectById = id => (id === "tower7" ? tower : null);
  const task = {
    type: "transfer",
    sourceId: "s",
    targetId: "tower7",
    resourceType: "energy",
    reserve: 500,
    maxEnergy: 500,
  };
  taskExecutors.executors.fillTowers(creep, task); // снял 500
  creep.store.energy = 200; // 300 «доставлено», 200 осталось
  creep.memory.working = true;
  taskExecutors.executors.fillTowers(creep, task); // переносит остаток, не снимает
  check("повторного снятия нет", amounts.length === 1, amounts.length);
  check("energyTaken = 500", task.energyTaken === 500, task.energyTaken);
}

{
  // После частичного снятия остаток контракта не резервируется дважды.
  const room = { name: "W1N8", storage: { store: { energy: 170400 } } };
  Memory.rooms[room.name] = {
    tasks: {
      fillTowers: [
        { taskId: "r", reserve: 500, reservedBy: "c1", energyTaken: 300 },
      ],
    },
  };
  check("remaining = 200", energyPolicy.remainingReserve(
    Memory.rooms[room.name].tasks.fillTowers[0],
  ) === 200);
  check("reserved = 200", energyPolicy.reserved(room) === 200, energyPolicy.reserved(room));
  check("свободно 200", energyPolicy.free(room) === 200, energyPolicy.free(room));
  check(
    "можно зарезервировать 200, но не 201",
    energyPolicy.canReserve(room, { reserve: 200 }) === true &&
      energyPolicy.canReserve(room, { reserve: 201 }) === false,
  );
  check(
    "energyTaken не может превысить maxEnergy",
    energyPolicy.remainingReserve({ reserve: 500, maxEnergy: 500, energyTaken: 600 }) === 0,
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
