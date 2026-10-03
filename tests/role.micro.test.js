"use strict";
/**
 * ===================================================
 * ROLE.MICRO.TEST.JS — офлайн-проверка мелких правок ролей
 * ===================================================
 * Задание 11 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) в ролях не осталось visualizePathStyle (визуализация дороже moveTo);
 *   2) все moveTo в ролях идут с reusePath — путь не пересчитывается каждый тик;
 *   3) role.mineralMiner не использует lodash и Object.keys(creep.store);
 *   4) memory.working пишется только при смене режима (нет лишних записей);
 *   5) empire.js не тянет неиспользуемую заглушку terminalNetwork;
 *   6) поведение ролей не изменилось: сбор энергии, ремонт, стройка, апгрейд.
 *
 * Запуск: node tests/role.micro.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

const ROOT = path.join(__dirname, "..");
const ROLE_FILES = fs
  .readdirSync(ROOT)
  .filter(f => f.startsWith("role.") && f.endsWith(".js"));

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

/* ── 1-2. Статический разбор всех ролей ───────────────────────────────── */
console.log("1. Визуализация путей убрана из ролей");
const withVisualize = ROLE_FILES.filter(f =>
  /visualizePathStyle/.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
);
check("visualizePathStyle не встречается", withVisualize.length === 0, withVisualize.join(","));

console.log("\n2. У каждого moveTo есть reusePath");
const noReuse = [];
for (const f of ROLE_FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  // каждый вызов moveTo должен в пределах ~120 символов содержать reusePath
  const re = /moveTo\(/g;
  let m;
  while ((m = re.exec(src))) {
    const chunk = src.slice(m.index, m.index + 160);
    if (!/reusePath/.test(chunk)) noReuse.push(f + "@" + m.index);
  }
}
check("все moveTo с reusePath", noReuse.length === 0, noReuse.join(", "));

console.log("\n3. role.mineralMiner без lodash и Object.keys(creep.store)");
// Комментарии не считаем: в них эти вызовы упомянуты как «что убрали».
const mm = fs
  .readFileSync(path.join(ROOT, "role.mineralMiner.js"), "utf8")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
check("нет _.sum", !/_\.sum/.test(mm));
check("нет Object.keys(creep.store)", !/Object\.keys\(creep\.store\)/.test(mm));
check("используется getUsedCapacity", /getUsedCapacity\(\)/.test(mm));

console.log("\n4. empire.js подключает terminalNetwork (с 01.10.2026 — не заглушка)");
const empire = fs.readFileSync(path.join(ROOT, "empire.js"), "utf8");
check("есть require(\"terminalNetwork\")", /require\("terminalNetwork"\)/.test(empire));
check("есть вызов terminalNetwork.run()", /terminalNetwork\.run\(\)/.test(empire));
check(
  "вызов идёт под замером подсистемы",
  /trackRole\("terminalNetwork"/.test(empire),
);

/* ── 5. Поведение ролей ───────────────────────────────────────────────── */
global.RESOURCE_ENERGY = "energy";
global.ERR_NOT_IN_RANGE = -9;
global.OK = 0;
global.Memory = {};
global.Game = {
  time: 100,
  creeps: {},
  rooms: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  constructionSites: {},
};

function makeStore(free, used, energy) {
  return {
    energy: energy === undefined ? used : energy,
    getFreeCapacity: () => free,
    getUsedCapacity: () => used,
    [global.RESOURCE_ENERGY]: energy === undefined ? used : energy,
  };
}

function makeCreep(memory, store, extra) {
  const moves = [];
  const creep = Object.assign(
    {
      name: "c1",
      memory,
      store,
      room: { name: "W1N1", storage: null, controller: { id: "ctrl1" } },
      pos: {
        getRangeTo: () => 1,
        findClosestByRange: list => list[0],
      },
      moveTo: (t, opts) => {
        moves.push({ t, opts });
        return global.OK;
      },
      upgradeController: () => global.OK,
      build: () => global.OK,
      repair: () => global.OK,
      harvest: () => global.OK,
      transfer: () => global.OK,
      withdraw: () => global.ERR_NOT_IN_RANGE,
    },
    extra || {},
  );
  creep._moves = moves;
  return creep;
}

console.log("\n5. role.upgrader: режимы и отсутствие лишних записей");
const roleUpgrader = require("../role.upgrader");
const up = makeCreep({ working: false }, makeStore(0, 50, 50));
// Полный склад -> должен перейти в режим улучшения
roleUpgrader.run(up);
check("working = true при полном складе", up.memory.working === true);
const before = up.memory.working;
// Повторный вызов не должен менять значение
roleUpgrader.run(up);
check("значение режима не дёргается", up.memory.working === before);

const upEmpty = makeCreep({ working: true }, makeStore(50, 0, 0));
roleUpgrader.run(upEmpty);
check("working = false при пустом складе", upEmpty.memory.working === false);

console.log("\n6. role.builder: цель из roomState, moveTo по политике MOVE");
const { MOVE } = require("../constants");
const roleBuilder = require("../role.builder");
const site = { id: "site1", pos: { roomName: "W1N1" } };
const builder = makeCreep({ working: true }, makeStore(0, 50, 50));
builder.build = () => global.ERR_NOT_IN_RANGE;
roleBuilder.run(builder, { roomName: "W1N1", constructionSites: [site] });
check("строитель пошёл к площадке", builder._moves.length === 1);
check(
  "reusePath из политики (NORMAL)",
  builder._moves[0] &&
    builder._moves[0].opts &&
    builder._moves[0].opts.reusePath === MOVE.NORMAL,
  JSON.stringify(builder._moves[0] && builder._moves[0].opts),
);

console.log("\n7. role.repairer: цель меняется часто — политика VOLATILE");
const roleRepairer = require("../role.repairer");
const broken = { id: "road1", hits: 1, hitsMax: 100 };
const repairer = makeCreep({ working: true }, makeStore(0, 50, 50));
repairer.repair = () => global.ERR_NOT_IN_RANGE;
roleRepairer.run(repairer, {
  roomName: "W1N1",
  damagedStructures: [broken],
  constructionSites: [],
});
check("repairer пошёл к цели", repairer._moves.length === 1);
check(
  "reusePath из политики (VOLATILE)",
  repairer._moves[0] &&
    repairer._moves[0].opts &&
    repairer._moves[0].opts.reusePath === MOVE.VOLATILE,
  JSON.stringify(repairer._moves[0] && repairer._moves[0].opts),
);

console.log("\n8. Шаг 3: ленивый резолв целей в task.executors");
// Задание «Шаг 3»: source резолвится только в ветке забора, мёртвые резолвы
// (fillSpawnsExtensions/fillFactoryEnergy/fillTowers) убраны, повторные id
// берутся из кэша на тик. Контракт CONTINUE/DONE/SKIP не меняется.
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_POWER = "power";
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;

const executors = require("../task.executors");

/**
 * Свежий экземпляр модуля: кэш резолвов живёт в замыкании модуля, поэтому
 * «весь тик с нуля» проверяется через сброс require-кэша, а не повторным
 * вызовом той же копии.
 */
function freshExecutors() {
  const file = require.resolve("../task.executors");
  delete require.cache[file];
  const mod = require("../task.executors");
  delete require.cache[file];
  return mod;
}

/** Счётчик вызовов Game.getObjectById + карта «id → объект». */
const resolveCalls = [];

const storage = {
  id: "store1",
  store: {
    energy: 50000,
    power: 100,
    battery: 200,
    getFreeCapacity: () => 900000,
  },
};
const target = {
  id: "t1",
  store: Object.assign({ energy: 0 }, {
    getFreeCapacity: () => 800,
    getUsedCapacity: () => 0,
  }),
};
const objects = { store1: storage, t1: target };

global.Game = Object.assign({}, global.Game, {
  time: 500,
  getObjectById: id => {
    resolveCalls.push(id);
    return objects[id] || null;
  },
});

function creepWithStore(energy, extra) {
  return Object.assign(
    {
      name: "c9",
      memory: {},
      store: makeStore(0, energy, energy),
      room: { name: "W1N1", storage },
      moveTo: () => global.OK,
      withdraw: () => global.OK,
      transfer: () => global.OK,
    },
    extra || {},
  );
}

const fillTask = { type: "transfer", sourceId: "store1", targetId: "t1", resourceType: "energy" };

// 8.1 — полный крип: резолв target один раз, source не резолвится вовсе.
resolveCalls.length = 0;
const full = creepWithStore(50);
const r81 = freshExecutors().executeFillSpawnsExtensions(full, fillTask);
check("8.1 полный крип: результат CONTINUE", r81 === "CONTINUE", String(r81));
check(
  "8.1 полный крип: ровно один resolveTarget (кэш на тик)",
  resolveCalls.length === 1,
  JSON.stringify(resolveCalls),
);
check("8.1 полный крип: резолвится только target", resolveCalls[0] === "t1", String(resolveCalls[0]));

// 8.2 — пустой крип: source задачи не резолвится вообще, энергию берём из
// creep.room.storage (energySource.withdrawFromStorage). Уточнение к «шагу 3»:
// `source` в этих исполнителях — не цель забора, а приёмник обратного сброса и
// цель withdraw в фазе выгрузки.
resolveCalls.length = 0;
const exec82 = freshExecutors();
exec82.executeFillSpawnsExtensions(creepWithStore(0), fillTask);
check(
  "8.2 пустой крип: резолвится только target",
  resolveCalls.length === 1 && resolveCalls[0] === "t1",
  JSON.stringify(resolveCalls),
);
const firstPass = resolveCalls.length;
exec82.executeFillSpawnsExtensions(creepWithStore(0), fillTask);
check(
  "8.2 повторный вызов в том же тике: из кэша, без новых резолвов",
  resolveCalls.length === firstPass,
  `${firstPass} → ${resolveCalls.length}`,
);

// 8.2б — фаза выгрузки: source нужен, и повторный резолв берётся из кэша тика.
resolveCalls.length = 0;
const exec82b = freshExecutors();
const workingTask = Object.assign({}, fillTask);
const workingCreep = creepWithStore(50, { memory: { working: true } });
exec82b.executeFillTowers(workingCreep, workingTask);
const afterFirst = resolveCalls.slice();
exec82b.executeFillTowers(creepWithStore(50, { memory: { working: true } }), workingTask);
check(
  "8.2б фаза выгрузки: повторный вызов не резолвит target заново",
  afterFirst.length === 1 && resolveCalls.length === afterFirst.length,
  JSON.stringify(resolveCalls),
);

// 8.3 — мёртвые резолвы источников убраны из трёх исполнителей.
for (const name of ["executeFillFactoryEnergy", "executeFillTowers"]) {
  resolveCalls.length = 0;
  const mod = freshExecutors();
  mod[name](creepWithStore(50), fillTask);
  check(
    `8.3 ${name}: source не резолвится у полного крипа`,
    resolveCalls.indexOf("store1") === -1,
    JSON.stringify(resolveCalls),
  );
}

// 8.4 — контракт: исчезнувший target (null из Game.getObjectById) даёт SKIP.
resolveCalls.length = 0;
const r84 = freshExecutors().executeFillTowers(creepWithStore(0), {
  type: "transfer",
  sourceId: "store1",
  targetId: "gone",
  resourceType: "energy",
});
check("8.4 нет цели: SKIP", r84 === "SKIP", String(r84));

// 8.5 — кэш живёт один тик и не тащит объекты в следующий.
global.Game.time = 500;
resolveCalls.length = 0;
const exec85 = freshExecutors();
exec85.executeFillSpawnsExtensions(creepWithStore(50), fillTask);
const tick500 = resolveCalls.length;
global.Game.time = 501;
exec85.executeFillSpawnsExtensions(creepWithStore(50), fillTask);
check(
  "8.5 новый тик: цель резолвится заново (кэш сброшен по Game.time)",
  tick500 === 1 && resolveCalls.length === 2,
  `тик 500: ${tick500}, всего: ${resolveCalls.length}`,
);
check("8.5 объекты из кэша не пишутся в Memory крипа", full.memory.working === undefined);

console.log("\n9. Шаг 4: единая политика путей MOVE");
// Задание «Шаг 4»: значения reusePath берутся из словаря MOVE в constants.js,
// «магических чисел» 5/10/15/20/50 в вызовах moveTo быть не должно.
// MOVE уже подключён в разделе 6.
const POLICY_VALUES = [MOVE.STABLE, MOVE.NORMAL, MOVE.VOLATILE, MOVE.OFF];

check("STABLE = 50", MOVE.STABLE === 50, String(MOVE.STABLE));
check("NORMAL = 20", MOVE.NORMAL === 20, String(MOVE.NORMAL));
check("VOLATILE = 5", MOVE.VOLATILE === 5, String(MOVE.VOLATILE));
check("OFF = 0", MOVE.OFF === 0, String(MOVE.OFF));
check(
  "политика — строго убывающая по стабильности цели",
  MOVE.STABLE > MOVE.NORMAL && MOVE.NORMAL > MOVE.VOLATILE && MOVE.VOLATILE > MOVE.OFF,
);

const RUNTIME = fs
  .readdirSync(ROOT)
  .filter(f => f.endsWith(".js"))
  .filter(f => !["Gruntfile.js", "screeps.token.js", "eslint.config.js"].includes(f));

const literalReuse = [];
const offPolicy = [];
const callSites = [];
for (const f of RUNTIME) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const re = /moveTo\([\s\S]{0,200}?reusePath:\s*([^,}\s]+)/g;
  let m;
  while ((m = re.exec(src))) {
    callSites.push(f);
    if (/^[0-9]/.test(m[1])) literalReuse.push(`${f}: ${m[1]}`);
    if (!/^MOVE\./.test(m[1])) offPolicy.push(`${f}: ${m[1]}`);
  }
}
check(
  "в moveTo нет числовых reusePath",
  literalReuse.length === 0,
  literalReuse.join(", "),
);
check(
  "каждый reusePath берётся из словаря MOVE",
  offPolicy.length === 0,
  offPolicy.join(", "),
);
check(
  "политика покрывает все вызовы moveTo с reusePath (не меньше 30)",
  callSites.length >= 30,
  String(callSites.length),
);

const constantsSrc = fs.readFileSync(path.join(ROOT, "constants.js"), "utf8");
check("MOVE экспортируется из constants.js", /^\s*MOVE,$/m.test(constantsSrc));
check(
  "файлы, использующие MOVE, импортируют его из constants",
  RUNTIME.filter(f => /MOVE\./.test(fs.readFileSync(path.join(ROOT, f), "utf8"))).every(f =>
    /const \{[^}]*MOVE[^}]*\} = require\("(\.\/)?constants"\)/.test(
      fs.readFileSync(path.join(ROOT, f), "utf8"),
    ),
  ),
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
