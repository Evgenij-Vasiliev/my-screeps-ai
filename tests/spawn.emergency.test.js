"use strict";
/**
 * SPAWN.EMERGENCY.TEST.JS — аварийное восстановление комнаты без крипов.
 * Запуск: node tests/spawn.emergency.test.js
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
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_INVALID_ARGS = -5;
global.TOUGH = "tough";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.BODYPART_COST = {
  tough: 10,
  work: 100,
  carry: 50,
  move: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
};
global._ = { some: (obj, fn) => Object.keys(obj).some(k => fn(obj[k])) };
global.Memory = { rooms: {} };
global.Game = {
  time: 1000,
  creeps: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};

const { SPAWN_QUOTA } = require("../constants");
const spawnManager = require("../spawn.manager");

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

let calls = [];
function makeSpawn(energy) {
  return {
    spawning: null,
    room: { name: "W1N1", energyAvailable: energy },
    spawnCreep(body, name, opts) {
      calls.push({ body, name, memory: opts && opts.memory });
      return OK;
    },
  };
}
function state(creeps, energy) {
  const spawn = makeSpawn(energy);
  return {
    roomName: "W1N1",
    room: spawn.room,
    spawns: [spawn],
    creeps,
  };
}
function resetGate() {
  delete global.__spawnGate;
}

console.log("1. Нет крипов, энергии хватает — минимальное тело");
{
  calls = [];
  const spawn = makeSpawn(200);
  resetGate();
  spawnManager.run({
    roomName: "W1N1",
    room: spawn.room,
    spawns: [spawn],
    creeps: [],
  });
  check("спавн вызван", calls.length === 1, calls.length);
  const c = calls[0];
  check("тело 1W/1C/1M", c && c.body.join(",") === "work,carry,move", c && c.body.join(","));
  check("роль worker", c && c.memory && c.memory.role === "worker");
  check("homeRoom задан", c && c.memory && c.memory.homeRoom === "W1N1");
  check("имя аварийное", c && /_e$/.test(c.name), c && c.name);
}

console.log("\n2. Живой крип — дубля нет");
{
  calls = [];
  const spawn = makeSpawn(200);
  resetGate();
  const roles = ["worker", "miner", "linkWorker", "labWorker", "mineralMiner"];
  const creeps = roles.map(role => ({ memory: { role }, ticksToLive: 1200 }));
  spawnManager.run({
    roomName: "W1N1",
    room: spawn.room,
    spawns: [spawn],
    creeps,
  });
  check("аварийный спавн не вызван", calls.length === 0, calls.length);
}

console.log("\n3. Недостаточно энергии — невозможное тело не создаётся");
{
  calls = [];
  const spawn = makeSpawn(199);
  resetGate();
  spawnManager.run({
    roomName: "W1N1",
    room: spawn.room,
    spawns: [spawn],
    creeps: [],
  });
  check("спавн не вызван", calls.length === 0, calls.length);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
