"use strict";
/**
 * ===================================================
 * EXECUTOR.POWER.TEST.JS — офлайн-проверка ветки сброса груза
 * ===================================================
 * Регрессия, из-за которой появился этот тест: в
 * executeFillPowerSpawnEnergy (task.executors.js) source резолвился ТОЛЬКО
 * внутри фазы забора (`if (!creep.memory.working)`), а ветка «target полон,
 * но рюкзак ещё не пуст — сбрасываем обратно в source» использовала его же.
 * Крип, вошедший в тик уже с грузом (working === true), до резолва не доходил
 * и вместо разгрузки получал SKIP: задача снималась, груз оставался в рюкзаке.
 *
 * Проверяем поведение исполняемой ветки, а не текст кода:
 *   1) сброс в storage при полном target (было SKIP, стало transfer);
 *   2) доставка в неполный target — source не резолвится вовсе;
 *   3) фаза забора (пустой крип) — withdraw из source;
 *   4) груз доставлен — DONE и очистка памяти;
 *   5) source исчез — аккуратный SKIP без исключения;
 *   6) ERR_NOT_IN_RANGE при сбросе — moveTo к source с reusePath.
 *
 * Живой шард здесь не нужен: ветка зависит только от стора крипа, состояния
 * цели и памяти, а все игровые объекты подменяются. Что локально НЕ
 * проверяется — реальный CPU (Game.cpu.getUsed в симуляторе возвращает 0).
 *
 * Запуск: node tests/executor.power.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// На шарде require("energySource") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

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

/* ── Игровые глобалы ──────────────────────────────────────────────────── */
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.RESOURCE_ENERGY = "energy";

// Резолвы считаем поимённо: «source не резолвится, когда не нужен» — это
// ровно про отсутствие вызова Game.getObjectById.
let resolvedIds = [];
let objects = {};

// Game.time растёт на каждый сценарий: resolveTarget в task.executors.js
// кэширует резолвы на текущий тик (resolveCache по Game.time), и с постоянным
// временем второй сценарий получил бы объекты первого.
let tick = 0;

global.Game = {
  time: 1,
  getObjectById: id => {
    resolvedIds.push(id);
    return objects[id] || null;
  },
};
global.Memory = {};

const { executeFillPowerSpawnEnergy } = require("../task.executors");

/* ── Фикстуры ─────────────────────────────────────────────────────────── */
const TASK = {
  type: "transfer",
  targetId: "spawn1",
  sourceId: "store1",
  resourceType: "energy",
};

function makeTarget(freeCapacity) {
  return { id: "spawn1", store: { getFreeCapacity: () => freeCapacity } };
}

function makeStorage() {
  return { id: "store1", store: {} };
}

// Движок отдаёт 0 для ресурса, которого в складе нет: Store — это Proxy,
// возвращающий 0, если имя есть в RESOURCES_ALL, и undefined иначе
// (screeps/engine, src/game/store.js: `return new Proxy(this, { get ... })`).
// Фикстура повторяет это поведение, иначе проверка
// `creep.store[RESOURCE_ENERGY] === 0` тестировалась бы не так, как на шарде.
const RESOURCES_ALL = ["energy", "power", "battery"];

function makeStore(resources) {
  return new Proxy(resources, {
    get(target, name) {
      if (target[name] !== undefined) return target[name];
      if (typeof name === "string" && RESOURCES_ALL.indexOf(name) !== -1) {
        return 0;
      }
      return undefined;
    },
  });
}

function makeCreep(opts) {
  const intents = [];
  const store = {};
  if (opts.energy) store.energy = opts.energy;

  const creep = {
    name: "w1",
    memory: opts.working === undefined ? {} : { working: opts.working },
    store: makeStore(store),
    room: { storage: opts.storage || null },
    transfer: (obj, resourceType) => {
      intents.push(["transfer", obj.id, resourceType]);
      return opts.transferResult === undefined ? OK : opts.transferResult;
    },
    withdraw: (obj, resourceType) => {
      intents.push(["withdraw", obj.id, resourceType]);
      return OK;
    },
    moveTo: obj => {
      intents.push(["moveTo", obj.id]);
      return OK;
    },
  };
  return { creep: creep, intents: intents };
}

function run(opts) {
  resolvedIds = [];
  global.Game.time = ++tick; // новый тик — чистый кэш резолвов
  objects = { spawn1: makeTarget(opts.freeCapacity) };
  if (opts.withSource) objects.store1 = makeStorage();

  const fixture = makeCreep({
    energy: opts.energy,
    working: opts.working,
    storage: objects.store1,
    transferResult: opts.transferResult,
  });
  fixture.result = executeFillPowerSpawnEnergy(fixture.creep, TASK);
  return fixture;
}

/* ── 1. Сброс груза при полном target ─────────────────────────────────── */
console.log("1. Target полон, крип с грузом — сброс обратно в storage");
{
  const f = run({ freeCapacity: 0, energy: 50, working: true, withSource: true });
  check("результат CONTINUE (раньше был SKIP)", f.result === "CONTINUE", f.result);
  check(
    "интент: transfer в storage",
    JSON.stringify(f.intents) === '[["transfer","store1","energy"]]',
    JSON.stringify(f.intents),
  );
  check("режим working сохранился", f.creep.memory.working === true, JSON.stringify(f.creep.memory));
  check("груз не потерян", f.creep.store.energy === 50, String(f.creep.store.energy));
  check("source резолвлен по факту нужды", resolvedIds.includes("store1"), resolvedIds.join(","));
}

console.log("\n2. Target не полон — доставка, source не резолвится вовсе");
{
  const f = run({ freeCapacity: 200, energy: 50, working: true, withSource: true });
  check("результат CONTINUE", f.result === "CONTINUE", f.result);
  check(
    "интент: transfer в target",
    JSON.stringify(f.intents) === '[["transfer","spawn1","energy"]]',
    JSON.stringify(f.intents),
  );
  check(
    "source НЕ резолвился (ленивый резолв)",
    !resolvedIds.includes("store1"),
    resolvedIds.join(","),
  );
}

console.log("\n3. Фаза забора: пустой крип берёт энергию из source");
{
  const f = run({ freeCapacity: 200, energy: 0, withSource: true });
  check("результат CONTINUE", f.result === "CONTINUE", f.result);
  check(
    "интент: withdraw из storage",
    JSON.stringify(f.intents) === '[["withdraw","store1","energy"]]',
    JSON.stringify(f.intents),
  );
  check("source резолвлен", resolvedIds.includes("store1"), resolvedIds.join(","));
}

console.log("\n4. Груз доставлен: режим снят, задача закрыта");
{
  const f = run({ freeCapacity: 200, energy: 0, working: true, withSource: true });
  check("результат DONE", f.result === "DONE", f.result);
  check("интентов нет", f.intents.length === 0, JSON.stringify(f.intents));
  check(
    "memory.working снят",
    f.creep.memory.working === undefined,
    JSON.stringify(f.creep.memory),
  );
}

console.log("\n5. Source исчез: аккуратный SKIP без исключения");
{
  const f = run({ freeCapacity: 0, energy: 50, working: true, withSource: false });
  check("результат SKIP", f.result === "SKIP", f.result);
  check("интентов нет", f.intents.length === 0, JSON.stringify(f.intents));
  check(
    "memory.working снят (задача не тянется вечно)",
    f.creep.memory.working === undefined,
    JSON.stringify(f.creep.memory),
  );
}

console.log("\n6. Target недостижим при сбросе: едем к source");
{
  const f = run({
    freeCapacity: 0,
    energy: 50,
    working: true,
    withSource: true,
    transferResult: ERR_NOT_IN_RANGE,
  });
  check("результат CONTINUE", f.result === "CONTINUE", f.result);
  check(
    "интент: transfer + moveTo к storage",
    JSON.stringify(f.intents) === '[["transfer","store1","energy"],["moveTo","store1"]]',
    JSON.stringify(f.intents),
  );
  check("груз остался в рюкзаке", f.creep.store.energy === 50, String(f.creep.store.energy));
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
