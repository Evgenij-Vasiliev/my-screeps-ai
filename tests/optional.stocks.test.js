"use strict";
/**
 * ===================================================
 * OPTIONAL.STOCKS.TEST.JS — структуры простые, расход решают задачи
 * ===================================================
 * Принцип задан владельцем 05.10.2026: «Фабрика работает в штатном режиме —
 * получила 600 энергии, произвела 50 батареек, и всё. Она ничего не знает ни
 * о хранилище, ни о терминале. Всё решается в системе задач для воркера.
 * А что касается энергии — есть положительное сальдо по энергии
 * (хранилище-терминал), создаётся задача завезти энергию на фабрику, то есть
 * задача создаётся только при УВЕЛИЧЕНИИ энергии в комнате. Такой же принцип
 * и наполнения powerSpawn».
 *
 * Проверяется ровно это разделение ответственности:
 *
 *   A. МЕНЕДЖЕРЫ СТРУКТУР ничего не знают о складе и терминале:
 *      - фабрика производит, если есть энергия и нет cooldown;
 *      - powerSpawn обрабатывает power, если power > 0 и энергии >= 50
 *        (POWER_SPAWN_ENERGY_RATIO, engine power-spawns/process-power.js);
 *      - никакие пороги, интервалы и проверки роста империи их не касаются.
 *
 *   B. ГЕНЕРАТОР ЗАДАЧ ставит доставку энергии ТОЛЬКО при положительном
 *      сальдо: энергия комнаты (склад + терминал) за окно выросла
 *      (econ.roomGrowth > 0). Нет роста — нет задачи.
 *
 *   C. econ.roomGrowth считает сальдо по комнате: рост — плюс, падение —
 *      минус, по каждой комнате отдельно.
 *
 * Живой дефект, который это закрывает: fillFactoryEnergy возил энергию, пока
 * в фабрике есть ЛЮБОЕ свободное место (до 50 000). В фабрике E35S37 накопилось
 * 49 215 энергии при нуле батарей, склады упали 190-208k -> 152-173k (замер
 * tick 83463640, rate империи -870/тик).
 *
 * Запуск: node tests/optional.stocks.test.js
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
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.Memory = {};
global.Game = { time: 1000 };

const { ECON } = require("../constants");
const econ = require("../econ");
const factoryManager = require("../factory.manager");
const powerSpawnManager = require("../powerSpawn.manager");

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

const ROOM = "W1N1";

function makeStorage(energy) {
  return { id: "s1", store: { [RESOURCE_ENERGY]: energy, getFreeCapacity: () => 1000000 - energy } };
}

function makeTerminal(energy) {
  return { id: "t1", store: { [RESOURCE_ENERGY]: energy } };
}

function makeFactory(energy) {
  return {
    id: "f1",
    cooldown: 0,
    store: { [RESOURCE_ENERGY]: energy, getFreeCapacity: () => 50000 - energy },
    produceCalls: 0,
    produce(resource) {
      this.produceCalls++;
      this.lastResource = resource;
      return global.OK;
    },
  };
}

function makeRoom(storageEnergy, terminalEnergy) {
  return {
    roomName: ROOM,
    storage: makeStorage(storageEnergy),
    terminal: makeTerminal(terminalEnergy),
  };
}

console.log("\nA1. Фабрика: получила энергию — производит (о складе не знает)");
const f1 = makeFactory(600);
factoryManager.run({ roomName: ROOM, factory: f1, storage: makeStorage(0) });
check("с энергией и cd0 фабрика производит", f1.produceCalls === 1, String(f1.produceCalls));
check("и именно батареи", f1.lastResource === RESOURCE_BATTERY, String(f1.lastResource));

const f2 = makeFactory(600);
f2.cooldown = 3;
factoryManager.run({ roomName: ROOM, factory: f2, storage: makeStorage(500000) });
check("на cooldown не производит", f2.produceCalls === 0, String(f2.produceCalls));

const f3 = makeFactory(0);
factoryManager.run({ roomName: ROOM, factory: f3, storage: makeStorage(500000) });
check("без энергии не производит", f3.produceCalls === 0, String(f3.produceCalls));

// Менеджер не должен даже упоминать склад, терминал или econ: иначе расход
// снова начнёт регулировать структура, а не очередь задач.
const factoryMgrCode = fs
  .readFileSync(path.join(__dirname, "..", "factory.manager.js"), "utf8")
  .split("\n")
  .filter(l => {
    const t = l.trim();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  })
  .join("\n");
check(
  "менеджер фабрики не читает склад/терминал/econ",
  !/storage|terminal|econ|Game\.time/.test(factoryMgrCode),
);

console.log("\nA2. powerSpawn: есть power и 50 энергии — обрабатывает");
const p1 = { id: "p1", store: { [RESOURCE_ENERGY]: 50, [RESOURCE_POWER]: 5 }, processCalls: 0, processPower() { this.processCalls++; return global.OK; } };
powerSpawnManager.run({ roomName: ROOM, powerSpawn: p1, storage: makeStorage(0) });
check("обрабатывает при 50 энергии и power", p1.processCalls === 1, String(p1.processCalls));

const p2 = { id: "p2", store: { [RESOURCE_ENERGY]: 49, [RESOURCE_POWER]: 5 }, processCalls: 0, processPower() { this.processCalls++; return global.OK; } };
powerSpawnManager.run({ roomName: ROOM, powerSpawn: p2 });
check("не обрабатывает при 49 энергии", p2.processCalls === 0, String(p2.processCalls));

const p3 = { id: "p3", store: { [RESOURCE_ENERGY]: 500, [RESOURCE_POWER]: 0 }, processCalls: 0, processPower() { this.processCalls++; return global.OK; } };
powerSpawnManager.run({ roomName: ROOM, powerSpawn: p3 });
check("не обрабатывает без power", p3.processCalls === 0, String(p3.processCalls));

const psMgrCode = fs
  .readFileSync(path.join(__dirname, "..", "powerSpawn.manager.js"), "utf8")
  .split("\n")
  .filter(l => {
    const t = l.trim();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  })
  .join("\n");
check(
  "менеджер powerSpawn не читает склад/терминал/econ",
  !/storage|terminal|econ|Game\.time/.test(psMgrCode),
);

console.log("\nC. econ.roomGrowth — сальдо энергии комнаты за окно");
delete Memory.econ;
delete global.__econAcc;
Game.time = 5000;
econ.observe(makeRoom(200000, 100000));
check("первый замер: сальдо ещё не вычислено", econ.roomGrowth(ROOM) === 0, String(econ.roomGrowth(ROOM)));

Game.time = 5000 + ECON.GROWTH_WINDOW;
econ.observe(makeRoom(210000, 100000));
check(
  "энергия выросла на 10000 за окно — сальдо положительное",
  econ.roomGrowth(ROOM) > 0,
  String(econ.roomGrowth(ROOM)),
);

Game.time = 5000 + 2 * ECON.GROWTH_WINDOW;
econ.observe(makeRoom(200000, 100000));
check(
  "энергия упала — сальдо отрицательное",
  econ.roomGrowth(ROOM) < 0,
  String(econ.roomGrowth(ROOM)),
);

check(
  "по незнакомой комнате сальдо равно нулю (задач не будет)",
  econ.roomGrowth("W9N9") === 0,
  String(econ.roomGrowth("W9N9")),
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
