"use strict";
/**
 * ===================================================
 * SPAWN.COUNT.TEST.JS — офлайн-проверка счёта ролей в один проход
 * ===================================================
 * Задание 8 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) список крипов проходится РОВНО ОДИН раз (раньше — девять);
 *   2) результат совпадает с прежней реализацией на фильтрах
 *      (эталон ниже повторяет старый countRole один в один);
 *   3) роли с нулевой квотой не считаются;
 *   4) крип ниже PRESPAWN_THRESHOLD не считается;
 *   5) run() не трогает Game.getObjectById по минералу, когда квота
 *      mineralMiner уже набрана, и вообще не спавнит, когда все квоты полны;
 *   6) состав и порядок спавнов не изменились.
 *
 * Запуск: node tests/spawn.count.test.js
 */

/* ── Шим разрешения модулей (как на шарде: require("creep.factory")) ───── */
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

/* ── Игровые глобалы ──────────────────────────────────────────────────── */
global.OK = 0;
global.ERR_INVALID_ARGS = -5;
global.TOUGH = "tough";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
// На шарде lodash доступен как глобал _ — в Node его нужно подставить.
// creep.factory.blueprints.miner использует _.some.
global._ = {
  some: (collection, predicate) => Object.keys(collection).some(k => predicate(collection[k])),
};
global.Memory = { rooms: {} };
global.Game = {
  time: 1000,
  creeps: {},
  rooms: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};

const {
  SPAWN_QUOTA,
  SPAWN,
  PRESPAWN_THRESHOLD,
  MINERAL_MIN_AMOUNT_TO_SPAWN,
} = require("../constants");
const spawnManager = require("../spawn.manager");
const { countRoles } = spawnManager;

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

/* ── Эталон: прежняя реализация, один в один ──────────────────────────── */
function legacyCountRole(creeps, role) {
  return creeps.filter(c => {
    if (c.memory.role !== role) return false;
    const threshold = PRESPAWN_THRESHOLD[role];
    if (
      threshold !== undefined &&
      c.ticksToLive !== undefined &&
      c.ticksToLive < threshold
    ) {
      return false;
    }
    return true;
  }).length;
}

/* ── Фикстура ─────────────────────────────────────────────────────────── */
function creep(role, ticksToLive) {
  return { memory: { role }, ticksToLive };
}

const creeps = [
  creep("worker", 1200),
  creep("worker", 900),
  creep("miner", 1400),
  creep("miner", 50), // ниже PRESPAWN_THRESHOLD.miner (100) — «уходящий»
  creep("linkWorker", 20), // ниже порога 30
  creep("linkWorker", 800),
  creep("mineralMiner", 1000),
  creep("harvester", 1000), // квота 0
  creep("builder", 1000), // квота 0
  creep("upgrader", 1000), // квота 0
  creep("repairer", 1000), // квота 0
  creep("towerSupplier", 1000), // квота 0
  creep("unknownRole", 1000), // роли нет в квотах
];

console.log("1. Результат совпадает с прежней реализацией");
// Сравниваем только роли с ненулевой квотой: именно их счёт влияет на решение
// о спавне. Для нулевых квот значение счётчика не используется вообще
// (и прежний код сравнивал его с нулём, и новый просто пропускает роль) —
// это и есть суть оптимизации. Отсутствие спавна у таких ролей проверяет п.7.
let mismatch = null;
let compared = 0;
for (const role in SPAWN_QUOTA) {
  if (!SPAWN_QUOTA[role]) continue;
  compared++;
  const now = countRoles(creeps)[role] || 0;
  const before = legacyCountRole(creeps, role);
  if (now !== before) mismatch = `${role}: было ${before}, стало ${now}`;
}
check("по всем спавнящимся ролям счёт совпал", mismatch === null, mismatch);
check("сравнено 5 ролей с квотой > 0", compared === 5, String(compared));

console.log("\n2. Роли с нулевой квотой и чужие роли не считаются");
const counts = countRoles(creeps);
for (const role of [
  "harvester",
  "builder",
  "upgrader",
  "repairer",
  "towerSupplier",
  "unknownRole",
]) {
  check(`${role} отсутствует в счётчиках`, counts[role] === undefined, String(counts[role]));
}

console.log("\n3. Порог PRESPAWN_THRESHOLD учитывается в том же проходе");
check("worker: 2", counts.worker === 2, String(counts.worker));
check("miner: 1 (уходящий не считается)", counts.miner === 1, String(counts.miner));
check("linkWorker: 1 (уходящий не считается)", counts.linkWorker === 1, String(counts.linkWorker));
check("mineralMiner: 1", counts.mineralMiner === 1, String(counts.mineralMiner));

console.log("\n4. Список проходится ровно один раз");
let reads = 0;
const proxied = new Proxy(creeps, {
  get(target, prop) {
    if (typeof prop === "string" && /^[0-9]+$/.test(prop)) reads++;
    return target[prop];
  },
});
reads = 0;
countRoles(proxied);
const onePass = reads;
check("обращений к элементам = длине списка", onePass === creeps.length, String(onePass));

// Для сравнения: столько же обращений делала прежняя схема (9 проходов).
let legacyReads = 0;
const proxied2 = new Proxy(creeps, {
  get(target, prop) {
    if (typeof prop === "string" && /^[0-9]+$/.test(prop)) legacyReads++;
    return target[prop];
  },
});
for (const role in SPAWN_QUOTA) legacyCountRole(proxied2, role);
check(
  "прежняя схема читала список в 9 раз больше",
  legacyReads === onePass * Object.keys(SPAWN_QUOTA).length,
  `${legacyReads} против ${onePass}`,
);

/**
 * ШЛЮЗ ПРОВЕРОК (правка 30.09.2026). run() помнит в heap (`global.__spawnGate`)
 * тик, раньше которого комнате нечего перепроверять: комната без недобора
 * считается раз в SPAWN.SCAN_INTERVAL тиков, комната с недобором — каждый тик.
 * Game.time в тесте стоит на месте, поэтому перед каждой проверкой решения
 * шлюз снимается — иначе второй вызов run() в том же тике просто ничего не
 * сделает (это проверяет п.11).
 */
function resetGate() {
  delete global.__spawnGate;
}
/** Пропустить тики: шлюз отпускает комнату по Game.time. */
function skipTicks(n) {
  global.Game.time += n;
}
/** Proxy, считающий обращения к элементам массива (как в п.4). */
function countingArray(arr, counter) {
  return new Proxy(arr, {
    get(target, prop) {
      if (typeof prop === "string" && /^[0-9]+$/.test(prop)) counter.n++;
      return target[prop];
    },
  });
}

console.log("\n5. run(): минерал не резолвится, когда квота набрана");
let mineralLookups = 0;
global.Game.getObjectById = () => {
  mineralLookups++;
  return { mineralAmount: 99999 };
};

/**
 * Полный состав флота по текущим квотам: по SPAWN_QUOTA[role] крипов каждой
 * роли. Так фикстура не устаревает при изменении квот.
 */
function fullFleet() {
  const out = [];
  for (const role in SPAWN_QUOTA) {
    for (let i = 0; i < SPAWN_QUOTA[role]; i++) out.push(creep(role, 1000));
  }
  return out;
}

const spawnCalls = [];
const spawn = {
  room: { name: "W1N1" },
  spawning: null,
  spawnCreep(body, name, opts) {
    spawnCalls.push(name.split("_")[0]);
    return global.OK;
  },
};

const roomState = {
  roomName: "W1N1",
  room: { controller: { ticksToDowngrade: 50000 } },
  spawns: [spawn],
  // Все ненулевые квоты набраны — спавнить некого. Состав собран ПО КВОТАМ из
  // constants.js, а не руками: квоты меняются (01.10.2026 miner 2 -> 1,
  // worker 2 -> 1), и рукописный список молча устаревает.
  creeps: fullFleet(),
  // Минерал богат, но квота mineralMiner уже набрана — резолвить его незачем.
  mineral: { id: "min1", extractorId: "ex1", amount: 99999 },
};

resetGate();
spawnManager.run(roomState);
check("getObjectById по минералу не вызывался", mineralLookups === 0, String(mineralLookups));
check("спавнов не было (все квоты набраны)", spawnCalls.length === 0, spawnCalls.join(","));

console.log("\n6. run(): спавнит ровно того, кого не хватает");
// Убираем майнеров целиком: при квоте 1 это недобор -> должен спавниться miner.
roomState.creeps = roomState.creeps.filter(c => c.memory.role !== "miner");
Memory.rooms.W1N1 = { minerSpots: [{ x: 10, y: 10 }] };
resetGate();
spawnManager.run(roomState);
check("заспавнен miner", spawnCalls.length === 1 && spawnCalls[0] === "miner", spawnCalls.join(","));

console.log("\n7. Роль с нулевой квотой не спавнится никогда");
spawnCalls.length = 0;
roomState.creeps = []; // вообще никого — все квоты пусты
Memory.rooms.W1N1 = { minerSpots: [{ x: 10, y: 10 }] };
resetGate();
spawnManager.run(roomState);
check(
  "первым заспавнен не harvester/builder/upgrader",
  spawnCalls.length === 1 && SPAWN_QUOTA[spawnCalls[0]] > 0,
  spawnCalls.join(","),
);

/**
 * Правка 30.09.2026 (снижение нагрузки spawnManager): свободный спавн ищется
 * циклом, а не `spawns.find(s => !s.spawning)`, и ЛЕНИВО — только когда роль
 * действительно недобрана. Проверяем, что выбор спавна не изменился.
 */
console.log("\n8. Берётся ПЕРВЫЙ свободный спавн, а не любой");
const freeSpawnLabel = [];
const busy = {
  room: { name: "W1N1" },
  spawning: { name: "worker_W1N1_1" },
  spawnCreep() {
    freeSpawnLabel.push("busy");
    return global.OK;
  },
};
const free = {
  room: { name: "W1N1" },
  spawning: null,
  spawnCreep() {
    freeSpawnLabel.push("free");
    return global.OK;
  },
};
const savedSpawns = roomState.spawns;
roomState.spawns = [busy, free];
roomState.creeps = [];
resetGate();
spawnManager.run(roomState);
check(
  "спавн ушёл на свободный спавн",
  freeSpawnLabel.length === 1 && freeSpawnLabel[0] === "free",
  freeSpawnLabel.join(","),
);
roomState.spawns = [busy];
roomState.creeps = [];
freeSpawnLabel.length = 0;
resetGate();
spawnManager.run(roomState);
check("все спавны заняты — run выходит без спавна", freeSpawnLabel.length === 0);
roomState.spawns = savedSpawns;

console.log("\n9. Ленивый find: при полных квотах список спавнов не читается");
const spawnReads = { n: 0 };
const savedSpawns2 = roomState.spawns;
roomState.spawns = countingArray([spawn], spawnReads);
// Состав берём ПО КВОТАМ (fullFleet), а не списком: 01.10.2026 добавилась роль
// labWorker с квотой 1, и жёсткий список перестал закрывать все квоты —
// проверка «список спавнов не читается» падала на живом недоборе курьера.
roomState.creeps = fullFleet();
roomState.mineral = { id: "min1", extractorId: "ex1", amount: 0 }; // заблокирован
resetGate();
spawnReads.n = 0;
spawnManager.run(roomState);
check("квоты полны — элементы списка спавнов не читались", spawnReads.n === 0, String(spawnReads.n));

roomState.creeps = []; // все квоты пусты -> спавн искать придётся
roomState.mineral = { id: "min1", extractorId: "ex1", amount: 0 };
spawnCalls.length = 0;
resetGate();
spawnReads.n = 0;
spawnManager.run(roomState);
check("недобор есть — спавн найден и прочитан", spawnReads.n > 0, String(spawnReads.n));
check("и крип заспавнен", spawnCalls.length === 1, spawnCalls.join(","));
roomState.spawns = savedSpawns2;

console.log("\n10. Шлюз: комната без недобора не считает роли до срока");
roomState.creeps = fullFleet();
roomState.mineral = { id: "min1", extractorId: "ex1", amount: 0 }; // mineralMiner заблокирован
const creepReads = { n: 0 };
resetGate();
spawnManager.run(roomState); // первый скан: квоты полны, недобора нет -> шлюз
const dueTick = global.__spawnGate[roomState.roomName];
check(
  "шлюз выставил срок в будущем",
  dueTick > global.Game.time && dueTick <= global.Game.time + SPAWN.SCAN_INTERVAL,
  `${dueTick} при Game.time ${global.Game.time}`,
);
roomState.creeps = countingArray(roomState.creeps, creepReads);

skipTicks(dueTick - global.Game.time - 1); // за тик до срока — внутри интервала
creepReads.n = 0;
spawnManager.run(roomState);
check("внутри интервала роли не считались", creepReads.n === 0, String(creepReads.n));

skipTicks(1); // срок наступил
creepReads.n = 0;
spawnManager.run(roomState);
check(
  "срок прошёл — счёт ролей снова идёт",
  creepReads.n === roomState.creeps.length,
  `${creepReads.n} из ${roomState.creeps.length}`,
);

console.log("\n11. Шлюз: при недоборе проверка идёт каждый тик");
// Недобор по майнеру: квота miner = 1, а майнеров ноль.
roomState.creeps = fullFleet().filter(c => c.memory.role !== "miner");
spawnCalls.length = 0;
resetGate();
spawnManager.run(roomState);
check("недобор закрыт спавном", spawnCalls.length === 1 && spawnCalls[0] === "miner", spawnCalls.join(","));
const creepReads2 = { n: 0 };
roomState.creeps = countingArray(roomState.creeps, creepReads2);
skipTicks(1);
spawnManager.run(roomState);
check("следующий тик — роли снова посчитаны", creepReads2.n === roomState.creeps.length, String(creepReads2.n));

console.log("\n12. Шлюз: нет спавнов — считать нечего, роли не читаются");
roomState.spawns = [];
roomState.creeps = countingArray([creep("worker", 1200)], creepReads);
resetGate();
skipTicks(0);
creepReads.n = 0;
spawnManager.run(roomState);
skipTicks(1);
spawnManager.run(roomState);
check("без спавнов роли не читались ни разу", creepReads.n === 0, String(creepReads.n));
roomState.spawns = savedSpawns2;

/**
 * ТОЧКА ОТКАТА шлюза, заявленная в комментарии к SPAWN (constants.js):
 * SPAWN.SCAN_INTERVAL = 1 возвращает проверку каждый тик — и это можно сделать
 * из консоли без выгрузки, потому что spawn.manager держит ссылку на объект
 * SPAWN, а не на число. Здесь это и проверяется.
 */
console.log("\n13. Откат: SPAWN.SCAN_INTERVAL = 1 — проверка каждый тик");
const savedInterval = SPAWN.SCAN_INTERVAL;
SPAWN.SCAN_INTERVAL = 1;
roomState.spawns = [spawn];
roomState.creeps = [
  creep("mineralMiner", 1000),
  creep("miner", 1400),
  creep("miner", 1400),
  creep("linkWorker", 800),
  creep("worker", 1200),
  creep("worker", 1100),
];
roomState.mineral = { id: "min1", extractorId: "ex1", amount: 0 };
const rollbackReads = { n: 0 };
roomState.creeps = countingArray(roomState.creeps, rollbackReads);
resetGate();
spawnManager.run(roomState);
skipTicks(1);
rollbackReads.n = 0;
spawnManager.run(roomState);
check(
  "с интервалом 1 роли считаются каждый тик",
  rollbackReads.n === roomState.creeps.length,
  `${rollbackReads.n} из ${roomState.creeps.length}`,
);
SPAWN.SCAN_INTERVAL = savedInterval;
resetGate();

/**
 * Профиль частей run() включается флагом Memory.cpuSpawnProfile (A патча
 * 30.09.2026). Без флага замер не должен стоить ни одного Game.cpu.getUsed,
 * иначе «оптимизация» сама станет расходом на каждой комнате каждый тик.
 */
console.log("\n14. Профиль по флагу: без флага замер не тратит getUsed");
let usedCalls = 0;
global.Game.cpu.getUsed = () => {
  usedCalls++;
  return 0;
};
roomState.creeps = [];
delete Memory.cpuSpawnProfile;
spawnCalls.length = 0;
resetGate();
spawnManager.run(roomState);
check("флаг не задан — Game.cpu.getUsed не вызывался", usedCalls === 0, String(usedCalls));
const spawnsWithoutProfile = spawnCalls.slice();

usedCalls = 0;
spawnCalls.length = 0;
Memory.cpuSpawnProfile = true;
resetGate();
spawnManager.run(roomState);
check("флаг включён — замер идёт", usedCalls > 0, String(usedCalls));
check(
  "решение при включённом профиле то же",
  spawnCalls.join(",") === spawnsWithoutProfile.join(","),
  `${spawnCalls.join(",")} против ${spawnsWithoutProfile.join(",")}`,
);
delete Memory.cpuSpawnProfile;
resetGate();

/**
 * 15. Порог минерала (правка 02.10.2026): роль выходит на МАЛОМ остатке.
 *
 * Замер shard3 (node scripts/measure.mineral.js shard3, Game.time 83376031):
 * amount = 130/300/810/380/415 при extractor.cooldown = 0 и живых
 * mineralMiner 0 — все пять комнат были ниже прежнего порога 1500, и добыча
 * не шла вовсе (global.__spawnGate показывал ветку простоя).
 *
 * Значение 130 — МИНИМУМ замера, а не «на глаз»: если проверка проходит на
 * нём, она проходит и на остальных четырёх комнатах. Возврат порога к 1500
 * (или любое значение > 130) роняет п.15.
 */
console.log("\n15. mineralMiner выходит на малом остатке минерала (замер: 130)");
roomState.creeps = fullFleet().filter(c => c.memory.role !== "mineralMiner");
roomState.mineral = { id: "min1", extractorId: "ex1", amount: 130 };
spawnCalls.length = 0;
resetGate();
spawnManager.run(roomState);
check(
  "amount 130 выше порога — mineralMiner заспавнен",
  spawnCalls.length === 1 && spawnCalls[0] === "mineralMiner",
  `порог ${MINERAL_MIN_AMOUNT_TO_SPAWN}, спавны: ${spawnCalls.join(",") || "(нет)"}`,
);

console.log("\n16. Исчерпанный минерал по-прежнему не спавнит (amount 0)");
roomState.creeps = fullFleet().filter(c => c.memory.role !== "mineralMiner");
roomState.mineral = { id: "min1", extractorId: "ex1", amount: 0 };
spawnCalls.length = 0;
resetGate();
spawnManager.run(roomState);
check(
  "amount 0 — mineralMiner не спавнится",
  spawnCalls.length === 0,
  spawnCalls.join(",") || "(нет)",
);

console.log("\n17. Без экстрактора mineralMiner не спавнится");
roomState.creeps = fullFleet().filter(c => c.memory.role !== "mineralMiner");
roomState.mineral = { id: "min1", extractorId: null, amount: 99999 };
spawnCalls.length = 0;
resetGate();
spawnManager.run(roomState);
check(
  "extractorId = null — mineralMiner не спавнится",
  spawnCalls.length === 0,
  spawnCalls.join(",") || "(нет)",
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
