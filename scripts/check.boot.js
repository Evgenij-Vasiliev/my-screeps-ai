"use strict";
/**
 * ===================================================
 * SCRIPTS/CHECK.BOOT.JS — офлайн-загрузка модулей как на шарде
 * ===================================================
 * Проверяет ДВЕ вещи, которые движок Screeps делает до первого тика:
 *   1) граф require ацикличен (движок циклы не разрешает — падал
 *      «Circular reference to module 'room.manager'»);
 *   2) каждый модуль и вся цепочка загрузки (main -> empire -> room.manager)
 *      исполняются без исключений при пустом Game/Memory — то есть код
 *      грузится так же, как в рантайме.
 *
 * Мок-окружение: все константы STRUCTURE_*, RESOURCE_*, FIND_*, ERR_*, OK и
 * пустые Game/Memory, как их даёт движок до первого тика.
 *
 * Запуск: node scripts/check.boot.js    (0 — загрузилось, 1 — ошибка)
 * ===================================================
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const { listSourceFiles } = require("./deploy.modules");

const ROOT = path.join(__dirname, "..");

/* ── Константы движка, нужные коду на этапе загрузки ──────────────────── */
const STRUCTURES = [
  "SPAWN", "EXTENSION", "ROAD", "CONSTRUCTED_WALL", "WALL", "RAMPART", "KEEPER_LAIR",
  "PORTAL", "CONTROLLER", "TOWER", "STORAGE", "TERMINAL", "LINK", "EXTRACTOR",
  "LAB", "FACTORY", "OBSERVER", "POWER_SPAWN", "NUKER", "CONTAINER", "POWER_BANK",
];
for (let i = 0; i < STRUCTURES.length; i++) {
  global["STRUCTURE_" + STRUCTURES[i]] = STRUCTURES[i].toLowerCase();
}
global.STRUCTURE_CONSTRUCTED_WALL = "constructedWall";

for (const r of [
  "ENERGY", "POWER", "HYDROGEN", "OXYGEN", "UTRIUM", "LEMERGIUM", "KEANIUM",
  "ZYNTHIUM", "CATALYST", "GHODIUM", "BATTERY", "OPS", "SILICON", "METAL",
  "BIOMASS", "MIST", "UTRIUM_HYDRIDE", "UTRIUM_OXIDE", "KEANIUM_HYDRIDE",
  "KEANIUM_OXIDE", "LEMERGIUM_HYDRIDE", "LEMERGIUM_OXIDE", "ZYNTHIUM_HYDRIDE",
  "ZYNTHIUM_OXIDE", "GHODIUM_HYDRIDE", "GHODIUM_OXIDE", "UTRIUM_ALKALIDE",
  "KEANIUM_ALKALIDE", "LEMERGIUM_ALKALIDE", "ZYNTHIUM_ALKALIDE", "GHODIUM_ALKALIDE",
  "CATALYST_ALKALIDE", "GHODIUM_ACID", "UTRIUM_ACID", "KEANIUM_ACID",
  "LEMERGIUM_ACID", "ZYNTHIUM_ACID", "CATALYST_ACID", "GHODIUM_CRYSTAL",
]) {
  global["RESOURCE_" + r] = r;
}

const FINDS = [
  "CREEPS", "MY_CREEPS", "HOSTILE_CREEPS", "SOURCES", "DROPPED_RESOURCES",
  "STRUCTURES", "MY_STRUCTURES", "HOSTILE_STRUCTURES", "CONSTRUCTION_SITES",
  "MY_CONSTRUCTION_SITES", "FLAGS", "MINERALS", "DEPOSITS", "RUINS", "TOMBSTONES",
  "NUKES", "MY_SPAWNS", "HOSTILE_SPAWNS", "MY_TOWERS", "EXIT_TOP", "EXIT_RIGHT",
  "EXIT_BOTTOM", "EXIT_LEFT", "EXIT",
];
for (const f of FINDS) global["FIND_" + f] = f;

const ERRS = [
  "NOT_OWNED", "NOT_ENOUGH_ENERGY", "NOT_ENOUGH_RESOURCES", "NOT_IN_RANGE",
  "NOT_FOUND", "INVALID_TARGET", "FULL", "NOT_ENOUGH_EXTENSIONS", "NO_PATH",
  "INVALID_ARGS", "TIRED", "BUSY", "RCL_NOT_ENOUGH", "GCL_NOT_ENOUGH", "FULL_STORAGE",
];
for (const e of ERRS) global["ERR_" + e] = -1;

global.OK = 0;
// Движок объявляет и общий список ресурсов: им пользуются market.manager
// и терминальные задачи.
global.RESOURCES_ALL = [
  global.RESOURCE_ENERGY, global.RESOURCE_POWER, global.RESOURCE_HYDROGEN,
  global.RESOURCE_OXYGEN, global.RESOURCE_UTRIUM, global.RESOURCE_LEMERGIUM,
  global.RESOURCE_KEANIUM, global.RESOURCE_ZYNTHIUM, global.RESOURCE_CATALYST,
  global.RESOURCE_GHODIUM, global.RESOURCE_BATTERY,
];
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.TOUGH = "tough";
global.ATTACK = "attack";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";
global.CLAIM = "claim";

/* ── Пустые Game/Memory, как до первого тика ──────────────────────────── */
global.Memory = { rooms: {}, creeps: {}, flags: {}, spawns: {} };
global.Game = {
  time: 1,
  rooms: {},
  creeps: {},
  structures: {},
  spawns: {},
  flags: {},
  constructionSites: {},
  cpu: { limit: 20, tickLimit: 500, bucket: 10000, getUsed: () => 0, shardLimits: {} },
  shard: { name: "shard3", type: "normal" },
  market: { credits: 0, getAllOrders: () => [], orders: {} },
  map: { findRoute: () => [] },
  notify: () => 0,
  getObjectById: () => null,
  powerCreeps: {},
  resources: {},
};

/* ── Разрешение имён модулей как на шарде ─────────────────────────────── */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const direct = path.join(ROOT, request + ".js");
    if (fs.existsSync(direct)) return direct;
    const indexed = path.join(ROOT, request, "index.js");
    if (fs.existsSync(indexed)) return indexed;
    // на шарде есть и встроенные модули игры ("game", "constants" и т.п.)
    return request;
  }
  return origResolve.call(this, request, ...rest);
};

/**
 * Модули ровно в том составе, в каком они уедут на шард: SRC деплоя
 * (корень, constants/*, room/*) минус EXCLUDE. Файл из подпапки грузится
 * так же, как на шарде, — по имени с путём ("constants/spawn"); его
 * относительные require Node разрешает от своего каталога, а движок получает
 * уже переведённые в корневые имена (scripts/deploy.modules.js).
 */
const files = listSourceFiles(ROOT);

let failed = 0;

/* 1. Каждый модуль по отдельности — константы и таблицы строятся на загрузке. */
for (const rel of files) {
  try {
    require(path.join(ROOT, rel));
  } catch (e) {
    failed++;
    console.log(`ОШИБКА загрузки ${rel}: ${e.message}`);
    if (e.stack) console.log(e.stack.split("\n").slice(1, 4).join("\n"));
  }
}
if (!failed) {
  const inFolders = files.filter(rel => rel.includes("/")).length;
  console.log(
    `Загрузка всех ${files.length} модулей по отдельности: OK ` +
      `(корень ${files.length - inFolders}, в подпапках ${inFolders})`,
  );
}

/* 2. Цепочка main -> empire -> room.manager (как её тянет движок). */
try {
  delete require.cache[require.resolve(path.join(ROOT, "main.js"))];
  require(path.join(ROOT, "main.js"));
  console.log("Цепочка main.js -> empire -> room.manager загрузилась: OK");
} catch (e) {
  failed++;
  console.log(`ОШИБКА цепочки main.js: ${e.message}`);
  if (e.stack) console.log(e.stack.split("\n").slice(1, 5).join("\n"));
}

/* 3. Пустой тик: loop() на пустом Game не должен падать на загрузке. */
try {
  const main = require(path.join(ROOT, "main.js"));
  if (typeof main.loop === "function") {
    main.loop();
    console.log("main.loop() на пустом Game: OK");
  } else {
    console.log("main.loop не экспортируется — проверяется на шарде");
  }
} catch (e) {
  failed++;
  console.log(`ОШИБКА main.loop(): ${e.message}`);
  if (e.stack) console.log(e.stack.split("\n").slice(1, 5).join("\n"));
}

process.exit(failed === 0 ? 0 : 1);
