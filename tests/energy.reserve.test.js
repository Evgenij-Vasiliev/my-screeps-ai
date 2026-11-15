"use strict";
/**
 * ENERGY.RESERVE.TEST.JS — этап 1: резерв энергетических контрактов.
 *
 * Проверяем:
 *   1) reserved() суммирует только назначенные живым крипам задачи;
 *   2) free() = storage - ENERGY_MIN - DEFENSE_RESERVE - reserved();
 *   3) две задачи не могут зарезервировать одну и ту же энергию;
 *   4) releaseTask/completeTask освобождают резерв;
 *   5) смерть крипа и expiresAt освобождают резерв;
 *   6) getNextTask с acceptFn пропускает недоступную задачу и не блокирует
 *      остальные.
 *
 * Запуск: node tests/energy.reserve.test.js
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
  creeps: { c1: { name: "c1" }, c2: { name: "c2" } },
  rooms: {},
};

const { STORAGE } = require("../constants");
const taskManager = require("../task.manager");
const energyPolicy = require("../energy.policy");

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

let roomSeq = 0;
function makeRoom(energy) {
  const name = "W1N" + ++roomSeq;
  const room = { name, storage: { store: { energy } } };
  Game.rooms[name] = room;
  Memory.rooms[name] = { tasks: {} };
  global.__taskHeap = null;
  return room;
}
function task(id, reserve, reservedBy, expiresAt) {
  const t = { type: "transfer", taskId: id, reserve };
  if (reservedBy) t.reservedBy = reservedBy;
  if (expiresAt !== undefined) t.expiresAt = expiresAt;
  return t;
}

console.log("1. reserved(): только назначенные живые задачи");
{
  const room = makeRoom(200000);
  Memory.rooms[room.name].tasks.fillTowers = [
    task("a", 600, "c1"),
    task("b", 600), // свободна
    task("c", 0, "c2"), // нулевой резерв
    task("d", 600, "dead"), // мёртвый крип
    null, // надгробие
    task("e", 600, "c2", 999), // просрочена
  ];
  check("reserved = 600", energyPolicy.reserved(room) === 600, String(energyPolicy.reserved(room)));
  check(
    "free = 200000 - 150000 - 20000 - 600 = 29400",
    energyPolicy.free(room) === 30000 - 600,
    String(energyPolicy.free(room)),
  );
}

console.log("\n2. Две задачи не резервируют одну энергию");
{
  const room = makeRoom(170600); // free = 600
  const a = task("a", 600);
  const b = task("b", 600);
  Memory.rooms[room.name].tasks.fillTowers = [a, b];
  check("canReserve(a) до назначения = true", energyPolicy.canReserve(room, a) === true);
  a.reservedBy = "c1";
  check("canReserve(b) после a = false", energyPolicy.canReserve(room, b) === false);
  check("reserved = 600", energyPolicy.reserved(room) === 600, String(energyPolicy.reserved(room)));
}

console.log("\n3. releaseTask/completeTask освобождают резерв");
{
  const room = makeRoom(170600);
  const a = task("a", 600, "c1");
  Memory.rooms[room.name].tasks.fillTowers = [a];
  check("до release reserved = 600", energyPolicy.reserved(room) === 600);
  taskManager.releaseTask(room.name, "fillTowers", a);
  check("после release reserved = 0", energyPolicy.reserved(room) === 0);

  a.reservedBy = "c1";
  taskManager.completeTask(room.name, "fillTowers", a);
  check("после complete reserved = 0", energyPolicy.reserved(room) === 0);
}

console.log("\n4. Смерть крипа освобождает резерв");
{
  const room = makeRoom(170600);
  Memory.rooms[room.name].tasks.fillTowers = [task("a", 600, "c1")];
  check("живой крип — 600", energyPolicy.reserved(room) === 600);
  Game.creeps = {};
  check("крип умер — 0", energyPolicy.reserved(room) === 0);
  Game.creeps = { c1: { name: "c1" }, c2: { name: "c2" } };
}

console.log("\n5. Просроченная задача не удерживает резерв и не выдаётся");
{
  const room = makeRoom(170600);
  const expired = task("a", 600, "c1", 999);
  Memory.rooms[room.name].tasks.fillTowers = [expired];
  check("reserved = 0", energyPolicy.reserved(room) === 0);
  check("canReserve(expired) = true (reserve не учитывается)", energyPolicy.canReserve(room, expired) === true);
  check("getTaskById(expired) = null", taskManager.getTaskById(room.name, "fillTowers", "a") === null);
  const next = taskManager.getNextTask(room.name, "fillTowers", null, t => energyPolicy.canReserve(room, t));
  check("getNextTask не отдаёт просроченную", next === null, next && next.taskId);
}

console.log("\n6. Недоступная задача не блокирует остальные");
{
  const room = makeRoom(170600);
  const assigned = task("a", 600, "c1");
  const unaffordable = task("b", 600);
  const free = task("c", 0);
  Memory.rooms[room.name].tasks.fillTowers = [assigned, unaffordable, free];
  const next = taskManager.getNextTask(room.name, "fillTowers", null, t =>
    energyPolicy.canReserve(room, t),
  );
  check("выбрана доступная задача c", next && next.taskId === "c", next && next.taskId);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
