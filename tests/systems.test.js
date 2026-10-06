"use strict";
/**
 * ===================================================
 * SYSTEMS.TEST.JS — проверка файла-выключателя systems.js
 * ===================================================
 * Выключатель — это файл тумблеров (systems.js) и проверки в точках вызова.
 * Проверяется БЕЗ шарда:
 *
 *   1) файл выключателя — ТОЛЬКО данные: ни функций, ни require, ни Memory;
 *   2) гейты в коде читают тумблер строго (`!== false` / `=== false`), а не
 *      «по истинности»: иначе опечатка в имени молча выключила бы систему;
 *   3) сверка: каждый тумблер подключён в коде, каждое подключение есть в
 *      файле, роли совпадают с картой ROLES и таблицей SPAWN_QUOTA;
 *   4) интеграция на заглушках: тумблер false действительно не вызывает
 *      систему (room.manager) и не спавнит выключенную роль (spawn.manager),
 *      а имя, которого в файле нет, ничего не выключает.
 *
 * Запуск: node tests/systems.test.js
 */

const fs = require("fs");
const path = require("path");

const { listSourceFiles } = require("../scripts/deploy.modules");

const ROOT = path.join(__dirname, "..");
const SWITCH_FILE = path.join(ROOT, "systems.js");

const systems = require(SWITCH_FILE);
const switchSrc = fs.readFileSync(SWITCH_FILE, "utf8");
const switchCode = switchSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

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

/**
 * Рантайм-модули: ровно то, что уезжает на шард (SRC деплоя — корневые *.js,
 * constants/*.js, room/*.js и task/*.js, scripts/deploy.modules.js:49). Список берётся у самого
 * деплоя: иначе файлы из подпапок выпадают из скана тумблеров.
 */
function runtimeFiles() {
  return listSourceFiles(ROOT)
    .filter(rel => rel !== "systems.js")
    .map(rel => {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      return { name: rel, text, code: blank(text) };
    });
}

/**
 * Комментарии заменяются пробелами — нумерация строк сохраняется, поэтому в
 * сообщениях о нарушении настоящий номер строки файла.
 */
function blank(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, m => m.replace(/[^\n]/g, " "));
}

console.log("1. Файл выключателя — только тумблеры");
const keys = Object.keys(systems);
const ROOM_KEY = /^[A-Z]\d+[NS]\d+$/; // E35S37, W12N4 — имя комнаты
const systemKeys = keys.filter(k => !ROOM_KEY.test(k));
const roomKeys = keys.filter(k => ROOM_KEY.test(k));

check("тумблеров систем: 27", systemKeys.length === 27, String(systemKeys.length));
check(
  "в файле нет функций",
  !/\bfunction\b/.test(switchCode) && switchCode.indexOf("=>") === -1,
);
check("в файле нет require", !/require\s*\(/.test(switchCode));
check("в файле нет Memory и Game", !/\bMemory\b|\bGame\b/.test(switchCode));
check("в файле нет логики (только литералы)", !/\bif\b|\bfor\b|\breturn\b/.test(switchCode));

const notBool = keys.filter(k => typeof systems[k] !== "boolean");
check("каждое значение — true/false", notBool.length === 0, notBool.join(","));
check(
  "комнаты, если есть, названы именем комнаты",
  roomKeys.every(k => ROOM_KEY.test(k)),
  roomKeys.join(","),
);

const REQUIRED = [
  "roomManager", "terminalNetwork", "marketManager",
  "labManager", "spawnManager", "creeps", "towers", "linkManager",
  "factoryManager", "powerSpawnManager",
  "boostManager",
  "miner",
  "linkWorker", "labWorker", "mineralMiner", "worker",
  "fillSpawnsExtensions", "fillPowerSpawnPower", "fillPowerSpawnEnergy",
  "fillFactoryEnergy", "collectFactoryBattery", "fillTerminalEnergy",
  "fillTerminalResources", "fillTowers", "repairStructures", "buildStructures",
  "upgradeController",
];
const missing = REQUIRED.filter(n => !Object.prototype.hasOwnProperty.call(systems, n));
check("все системы бота присутствуют", missing.length === 0, missing.join(","));

console.log("\n2. Гейты читают тумблер строго (не «по истинности»)");
const files = runtimeFiles();
// Граница слова обязательна: без неё под шаблон попадает `subsystems[role]`
// из cpuMonitor — это чужой код, а не гейт.
const gateRe = /(?<![\w$.])systems\.([A-Za-z_][A-Za-z0-9_]*)|(?<![\w$.])systems\[([^\]]+)\]/g;
const literalGates = new Set();
const dynamicGates = [];
const looseGates = [];
let gateCount = 0;

for (const f of files) {
  const src = f.code;
  let m;
  gateRe.lastIndex = 0;
  while ((m = gateRe.exec(src))) {
    gateCount++;
    const name = m[1];
    // Строгая форма: `systems.x !== false` (вызов под условием) либо
    // `systems.x === false` (ранний выход). Всё остальное — truthiness,
    // при которой опечатка в имени молча выключит систему.
    const after = src.slice(gateRe.lastIndex, gateRe.lastIndex + 24);
    const strict = /^\s*(?:!==|===)\s*false/.test(after);
    if (!strict) looseGates.push(`${f.name}:${lineOf(src, m.index)} (${m[0]})`);
    if (name) literalGates.add(name);
    else dynamicGates.push(`${f.name}:${lineOf(src, m.index)} (${m[0]})`);
  }
}

/** Номер строки (1-based) для смещения в тексте. */
function lineOf(src, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") n++;
  }
  return n;
}

// Гейтов стало 27 (было 26) после правки 05.10.2026: у генераторов убраны
// дублирующие флаги TASK_CONFIG (единый источник — systems.js), а режим
// fillTerminalResources переехал сюда и читается один раз в
// task/gen.terminal.js строгой формой `systems.fillTerminalResources !== false`.
// Число остаётся защитой от ложной зелени: пропавший гейт или распутье «по
// истинности» проверка ниже покажет.
check("гейтов найдено (защита от ложной зелени)", gateCount === 27, String(gateCount));
check(
  "каждый гейт сравнивает с false (не truthiness)",
  looseGates.length === 0,
  looseGates.join(", "),
);
check(
  "динамических гейтов ровно 3 (роль в комнате, роль в спавне, комната)",
  dynamicGates.length === 3,
  dynamicGates.join(", "),
);

console.log("\n3. Тумблеры ↔ код (механически)");
const EMPIRE = files.find(f => f.name === "empire.js");
/**
 * Слой комнаты целиком: фасад room.manager.js + каталог room/*.js (разбиение
 * 04.10.2026). Тумблеры читаются в room/run.js, карта ролей живёт в
 * room/creeps.js — проверка одного фасада была бы ложно-зелёной.
 */
const roomLayerFiles = files.filter(
  f => f.name === "room.manager.js" || f.name.startsWith("room/"),
);
const ROOM = {
  name: "room.manager.js + room/*.js",
  code: roomLayerFiles.map(f => f.code).join("\n"),
};
const SPAWN = files.find(f => f.name === "spawn.manager.js");

check(
  "боевые файлы требуют systems.js",
  /require\("systems"\)/.test(EMPIRE.code) &&
    /require\("systems"\)/.test(ROOM.code) &&
    /require\("systems"\)/.test(SPAWN.code),
);
check("файла switches.js больше нет", !fs.existsSync(path.join(ROOT, "switches.js")));
check(
  "Memory.off нигде не читается",
  files.filter(f => /Memory\.off/.test(f.code)).length === 0,
  files.filter(f => /Memory\.off/.test(f.code)).map(f => f.name).join(","),
);

/** Ключи карты ROLES из room.manager.js: имена ролей подключены динамически. */
const rolesMatch = ROOM.code.match(/const ROLES = \{([\s\S]*?)\n\};/);
const roleKeys = new Set(
  rolesMatch
    ? (rolesMatch[1].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || []).map(s =>
        s.replace(/\s*:$/, "").trim(),
      )
    : [],
);
/**
 * Ключи таблицы SPAWN_QUOTA: по ним идёт цикл спавна. Файл не зашит: таблица
 * лежит в constants/spawn.js (разбиение 04.10.2026), и поиск идёт по тому же
 * списку, что уезжает на шард, — иначе переезд константы ломает тест, а не
 * ловится им.
 */
const quotaFile = files.find(f => /const SPAWN_QUOTA = \{/.test(f.code));
const quotaMatch = quotaFile
  ? quotaFile.code.match(/const SPAWN_QUOTA = \{([\s\S]*?)\n\};/)
  : null;
const quotaKeys = new Set(
  quotaMatch
    ? (quotaMatch[1].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || []).map(s =>
        s.replace(/\s*:$/, "").trim(),
      )
    : [],
);

const notWired = systemKeys.filter(
  n => !literalGates.has(n) && !roleKeys.has(n),
);
check("каждый тумблер подключён в коде", notWired.length === 0, notWired.join(","));
const unknownGates = [...literalGates].filter(
  n => !Object.prototype.hasOwnProperty.call(systems, n),
);
check("каждое подключение есть в файле тумблеров", unknownGates.length === 0, unknownGates.join(","));

check("ROLES найдена (защита от ложной зелени)", roleKeys.size === 5, String(roleKeys.size));
check("SPAWN_QUOTA найдена (защита от ложной зелени)", quotaKeys.size === 5, String(quotaKeys.size));
check(
  "имена ролей в файле совпадают с картой ROLES",
  [...roleKeys].every(r => Object.prototype.hasOwnProperty.call(systems, r)) &&
    [...roleKeys].filter(r => !Object.prototype.hasOwnProperty.call(systems, r)).length === 0,
  [...roleKeys].filter(r => !Object.prototype.hasOwnProperty.call(systems, r)).join(","),
);
check(
  "каждая роль есть в SPAWN_QUOTA (иначе не перестанет спавниться)",
  [...roleKeys].filter(r => !quotaKeys.has(r)).length === 0,
  [...roleKeys].filter(r => !quotaKeys.has(r)).join(","),
);

console.log("\n4. Интеграция: тумблер false действительно выключает");
/**
 * Файл тумблеров подменяется заглушкой с нужными false: так проверяется
 * ФАКТ ВЫЗОВА системы, а не наличие строки в исходнике. Контракт тот же —
 * обычный объект с флагами, который код читает как `systems.X !== false`.
 */
const stubCalls = [];
/**
 * Заглушка файла тумблеров — ОДИН объект, который мутируется: модули
 * захватывают ссылку при require, поэтому пересоздавать его нельзя.
 */
const stubSystems = {};
function setFlags(flags) {
  for (const key in stubSystems) delete stubSystems[key];
  const src = flags || {};
  for (const key in src) stubSystems[key] = src[key];
}

function makeStub(request) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") return undefined;
        return function () {
          stubCalls.push(request + "." + String(prop));
          return undefined;
        };
      },
    },
  );
}

const GEN_FLAGS = {};
for (const n of REQUIRED) {
  if (n.indexOf("fill") === 0 || n.indexOf("collect") === 0 || n === "repairStructures" ||
      n === "buildStructures" || n === "upgradeController") {
    GEN_FLAGS[n] = true;
  }
}

const spawnedRoles = [];
global.OK = 0;
global.Memory = {};
global.Game = { time: 1000 };

const ModuleLoad = require("module");
const origLoad = ModuleLoad._load;
ModuleLoad._load = function (request, parent, isMain) {
  if (request === "systems") return stubSystems;
  if (request === "./constants") {
    return {
      // REPAIR_INTERVAL: 1 — как в боевом constants/defense.js (пункт 1 плана
      // docs/REPAIR-PLAN.md:158). Проверок на это значение в файле нет, но
      // стенд не должен расходиться с боевыми константами.
      TOWER: { HOSTILE_CHECK_INTERVAL: 100, REPAIR_INTERVAL: 1, REPAIR_POWER: 800 },
      TASK_CONFIG: GEN_FLAGS,
      SPAWN_QUOTA: { worker: 1, miner: 1 },
      SPAWN: { SCAN_INTERVAL: 10 },
      PRESPAWN_THRESHOLD: { miner: 100 },
      MINERAL_MIN_AMOUNT_TO_SPAWN: 1000,
    };
  }
  if (request === "loadShed") {
    return { effectiveLevel: () => 0, overBudget: () => false };
  }
  if (request === "cpuMonitor") {
    return {
      trackRole: (role, cb) => {
        stubCalls.push("cpu." + role);
        cb();
      },
      verboseEnabled: () => false,
      acc: () => undefined,
    };
  }
  if (request === "creep.factory") {
    return {
      run: (spawn, role) => {
        spawnedRoles.push(role);
        return global.OK;
      },
    };
  }
  if (request.startsWith(".") || path.isAbsolute(request)) {
    return origLoad.call(this, request, parent, isMain);
  }
  return makeStub(request);
};

const roomManager = require(path.join(ROOT, "room.manager.js"));
const spawnManager = require(path.join(ROOT, "spawn.manager.js"));
ModuleLoad._load = origLoad;

function fakeRoomState(roomName, creeps) {
  return {
    roomName,
    room: {},
    creeps: creeps || [],
    towers: [],
    extensions: [],
    spawns: [],
    links: [],
    labs: [],
    constructionSites: [],
    sources: [],
    mineral: null,
  };
}

function runRoomWith(flags, creeps) {
  setFlags(flags);
  stubCalls.length = 0;
  roomManager.runRoom(fakeRoomState("E35S37", creeps));
  return stubCalls.slice();
}

const has = (list, entry) => list.indexOf(entry) !== -1;

const base = runRoomWith({});
check(
  "всё включено: подсистемы вызваны (защита от ложной зелени)",
  has(base, "lab.manager.run") && has(base, "spawn.manager.run") &&
    has(base, "linkManager.run") && has(base, "factory.manager.run") &&
    has(base, "powerSpawn.manager.run") && has(base, "cpu.towers") &&
    has(base, "task.generators.generateFillTowers"),
  base.join(","),
);

check(
  "labManager: false — не вызван, остальное работает",
  (function () {
    const r = runRoomWith({ labManager: false });
    return !has(r, "lab.manager.run") && has(r, "spawn.manager.run") && has(r, "cpu.towers");
  })(),
);
check(
  "towers: false — башни не запускаются, линки работают",
  (function () {
    const r = runRoomWith({ towers: false });
    return !has(r, "cpu.towers") && has(r, "linkManager.run");
  })(),
);
check(
  "linkManager: false — линки не запускаются",
  !has(runRoomWith({ linkManager: false }), "linkManager.run"),
);
check(
  "factoryManager/powerSpawnManager: false — оба не вызваны",
  (function () {
    const r = runRoomWith({ factoryManager: false, powerSpawnManager: false });
    return !has(r, "factory.manager.run") && !has(r, "powerSpawn.manager.run");
  })(),
);
check(
  "upgradeController/repairStructures: false — генераторы не вызваны",
  (function () {
    const r = runRoomWith({ upgradeController: false, repairStructures: false });
    return !has(r, "task.generators.generateUpgradeController") &&
      !has(r, "task.generators.generateRepairStructures") &&
      has(r, "task.generators.generateFillTowers");
  })(),
);

const creep = [{ memory: { role: "miner" } }];
check(
  "крип роли miner обслуживается (защита от ложной зелени)",
  (function () {
    const r = runRoomWith({}, creep);
    return has(r, "role.miner.run") && has(r, "boost.manager.run");
  })(),
);
check(
  "роль miner: false — роль не исполняется",
  !has(runRoomWith({ miner: false }, creep), "role.miner.run"),
);
check(
  "boostManager: false — буст не вызывается, роль работает",
  (function () {
    const r = runRoomWith({ boostManager: false }, creep);
    return !has(r, "boost.manager.run") && has(r, "role.miner.run");
  })(),
);
check(
  "creeps: false — логика крипов не запускается",
  (function () {
    const r = runRoomWith({ creeps: false }, creep);
    return !has(r, "role.miner.run") && !has(r, "boost.manager.run");
  })(),
);
check(
  "опечатка в имени (ключа нет) ничего не выключает",
  (function () {
    const r = runRoomWith({ towres: false });
    return has(r, "cpu.towers");
  })(),
);

const visited = [];
roomManager.buildAllRoomStates = () =>
  [fakeRoomState("E35S37"), fakeRoomState("E35S39")];
roomManager.runRoom = function (roomState) {
  visited.push(roomState.roomName);
};

setFlags({ E35S37: false });
roomManager.run();
check(
  "комната E35S37: false — комната не запускается",
  visited.length === 1 && visited[0] === "E35S39",
  visited.join(","),
);

setFlags({});
visited.length = 0;
roomManager.run();
check("без тумблеров запускаются все комнаты", visited.length === 2, visited.join(","));

/** Спавн: выключенная роль не спавнится. */
function runSpawnWith(flags) {
  setFlags(flags);
  global.__spawnGate = {};
  spawnedRoles.length = 0;
  global.Game.time = 1000;
  spawnManager.run({
    roomName: "E35S37",
    spawns: [{ id: "s1", spawning: null }],
    creeps: [],
    mineral: null,
  });
  return spawnedRoles.slice();
}

const spawnBase = runSpawnWith({});
check("спавн: первая роль с квотой спавнится", spawnBase.length === 1 && spawnBase[0] === "worker", spawnBase.join(","));
const spawnNoWorker = runSpawnWith({ worker: false });
check("worker: false — не спавнится, спавнится следующая роль",
  spawnNoWorker.length === 1 && spawnNoWorker[0] === "miner", spawnNoWorker.join(","));
check("worker и miner: false — не спавнится никто",
  runSpawnWith({ worker: false, miner: false }).length === 0);
check("система не-роль (towers: false) на спавн не влияет",
  runSpawnWith({ towers: false }).length === 1);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
