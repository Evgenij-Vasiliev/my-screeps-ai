"use strict";
/**
 * ===================================================
 * REMOTE.HANDOFF.TEST.JS — replacement handoff (жизненный цикл)
 * ===================================================
 * ЧТО ПРОВЕРЯЕМ
 * Новый дальний крип должен начать путь в свою удалённую комнату ДО смерти
 * предшественника, а не после. Раньше: pre-spawn ставил замену, замене не
 * доставалось свободной комнаты (квота 2 = комнат 2) → targetRoom = null →
 * замена стояла у спавна, пока предшественник не умрёт, и только потом шла
 * 82 тика (E35S38) до источника. Для remoteMiner это простой источника.
 *
 * Здесь прогоняется весь конвейер настоящим кодом:
 *   spawn.manager.run() → creep.factory (память замены + связка handoffTo)
 *   → remote.manager.run() (наследование targetRoom) → роль (travelTo)
 * и проверяется фактический порядок:
 *   spawn → targetRoom → travel → arrival → смерть предшественника → работа.
 *
 * Проверяются и негативные сценарии: два независимых крипа не получают одну
 * комнату, замена связывается только с уходящим своей роли, без связки
 * работает обычная выдача свободной комнаты, хэш-fallback отсутствует.
 *
 * Запуск: node tests/remote.handoff.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Разрешение bare-require в стиле Screeps ──────────────────────────────
const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Глобалы Screeps ──────────────────────────────────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.TOUGH = "tough";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";
global.CLAIM = "claim";
global.STRUCTURE_CONTAINER = "container";
global.FIND_STRUCTURES = 1;
global.FIND_DROPPED_RESOURCES = 2;
global.FIND_SOURCES = 3;
global.FIND_CONSTRUCTION_SITES = 4;

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  getRangeTo(target) {
    const p = target && target.pos ? target.pos : target;
    if (!p || p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  isEqualTo(target) {
    const p = target && target.pos ? target.pos : target;
    return this.x === p.x && this.y === p.y && this.roomName === p.roomName;
  }
  isNearTo(target) {
    return this.getRangeTo(target) <= 1;
  }
  findClosestByRange() {
    return null;
  }
}
global.RoomPosition = RoomPosition;

const STORE_CAPACITY = { remoteMiner: 100, remoteHauler: 400, reserver: 0 };

const WORLD = { objects: {} };
const ROOMS = {};

global.Game = {
  time: 100000,
  creeps: {},
  getObjectById: id => WORLD.objects[id] || null,
};
global._ = { some: () => false };

function makeRoom(name, energyAvailable) {
  const room = {
    name,
    memory: {},
    energyAvailable: energyAvailable === undefined ? 12600 : energyAvailable,
    energyCapacityAvailable: 12600,
    storage: null,
    terminal: null,
    controller: null,
    find: () => [],
  };
  ROOMS[name] = room;
  return room;
}

function makeSpawn(room, name) {
  const spawn = {
    id: "SP_" + name,
    name,
    room,
    spawning: null,
    store: { energy: 300, getFreeCapacity: () => 0 },
    spawned: [],
    failNext: false,
  };
  spawn.spawnCreep = function (body, creepName, opts) {
    if (this.failNext) return ERR_NOT_ENOUGH_ENERGY;
    this.spawned.push({ name: creepName, body, memory: opts.memory });
    return OK;
  };
  return spawn;
}

// ── Крипы ────────────────────────────────────────────────────────────────
const HOME = "E35S37";
const { REMOTE, PRESPAWN_THRESHOLD, CREEP_BODIES, SPAWN_QUOTA } = require("../constants");

// Слотов на комнату у роли: у хаулера их REMOTE.HAULERS_PER_ROOM (два хаулера на
// маршрут — иначе вывоз упирается в ёмкость линка 800 и источник не покрыт),
// у остальных дальних ролей — один.
const slotsInRoom = role => (role === "remoteHauler" ? REMOTE.HAULERS_PER_ROOM : 1);

// Длина маршрута «спавн E35S37 → рабочая цель удалённой комнаты» — замер по
// живому террейну shard3 (tests/live.dump.geometry.js): E35S38 = 82 тика
// (худший из спавнов домашней комнаты), E36S37 = 52.
// Куда идёт роль (худший из спавнов домашней комнаты, замер по живому
// террейну shard3 — tests/live.dump.geometry.js): miner и hauler — к рабочей
// клетке контейнера (82), резервер — к контроллеру (88: контроллер E35S38 на
// (19,39), маршрут до него длиннее).
const ROUTE = { remoteMiner: 82, remoteHauler: 82, reserver: 88 };
// Путь внутри интеграционного сценария (E35S38 — самая дальняя комната).
const ROUTE_TICKS = { E35S38: ROUTE.remoteMiner, E36S37: 52 };

let creepSeq = 0;

/**
 * @param {string} role
 * @param {number|undefined} ttl
 * @param {{spawning?: boolean, memory?: Object, room?: string}} [extra]
 */
function makeCreep(role, ttl, extra) {
  const e = extra || {};
  creepSeq++;
  const spawning = e.spawning === true;
  const roomName = e.room || HOME;
  const capacity = STORE_CAPACITY[role] === undefined ? 100 : STORE_CAPACITY[role];
  const storeEnergy = { value: 0 };

  return {
    name: `${role}_${HOME}_${creepSeq}`,
    pos: new RoomPosition(19, 8, roomName),
    // Как в движке: комната следует за позицией крипа.
    get room() {
      return ROOMS[this.pos.roomName] || ROOMS[HOME];
    },
    memory: Object.assign({ role, homeRoom: HOME }, e.memory || {}),
    spawning,
    ticksToLive: spawning ? undefined : ttl,
    store: {
      get energy() {
        return storeEnergy.value;
      },
      set energy(v) {
        storeEnergy.value = v;
      },
      getFreeCapacity: () => capacity - storeEnergy.value,
      getCapacity: () => capacity,
    },
    say() {},
    travelToCalls: [],
    travelTo(target) {
      this.travelToCalls.push(target);
      return OK;
    },
  };
}

function ofRole(creeps, role) {
  return creeps.filter(c => c.memory.role === role);
}

// ── Загрузка настоящих модулей ───────────────────────────────────────────
global.Memory = {
  rooms: {
    E35S37: {
      tasks: {},
      minerSpots: [
        { x: 18, y: 4 },
        { x: 29, y: 6 },
      ],
    },
  },
  creeps: {},
};

const spawnManager = require("../spawn.manager");
const remoteManager = require("../remote.manager");
const creepFactory = require("../creep.factory");
const handoff = require("../remote.handoff");

// ── Отчётность ───────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

/**
 * Полный штатный набор E35S37: все роли квоты закрыты с большим TTL, поэтому
 * в базовом состоянии спавнится только то, что мы сами сломаем.
 */
function baseCreeps() {
  return [
    makeCreep("linkWorker", 1000),
    makeCreep("miner", 1000),
    makeCreep("miner", 1000),
    makeCreep("worker", 1000),
    makeCreep("worker", 1000),
    makeCreep("reserver", 500),
    makeCreep("reserver", 500),
    makeCreep("remoteMiner", 1000, { memory: { targetRoom: "E35S38" } }),
    makeCreep("remoteMiner", 1000, { memory: { targetRoom: "E36S37" } }),
    makeCreep("remoteHauler", 1000, { memory: { targetRoom: "E35S38" } }),
    makeCreep("remoteHauler", 1000, { memory: { targetRoom: "E36S37" } }),
    makeCreep("labWorker", 1000),
  ];
}

/**
 * Как движок: все живые крипы лежат в Game.creeps по имени. Связка замены
 * (handoffFrom / handoffTo) держится именно на именах, поэтому карта должна
 * быть актуальной в КАЖДОМ вызове, а не только внутри remote.manager —
 * иначе activePairs не находит предшественника.
 * @param {Object[]} creeps
 */
function syncGameCreeps(creeps) {
  const map = {};
  for (const c of creeps) map[c.name] = c;
  Game.creeps = map;
}

/**
 * Вызов spawn.manager за один тик.
 * @param {Object[]} creeps
 * @param {(creeps: Object[], spawn: Object) => void} [mutate]
 * @returns {Object} spawn
 */
function runSpawn(creeps, mutate) {
  Game.time += 1;
  syncGameCreeps(creeps);
  const room = makeRoom(HOME);
  const spawn = makeSpawn(room, "Spawn1");
  if (mutate) mutate(creeps, spawn);
  spawnManager.run({
    roomName: HOME,
    room,
    spawns: [spawn],
    creeps,
    sources: [],
    extensions: [],
  });
  return spawn;
}

/**
 * Вызов remote.manager за один тик (кэш ролей сбрасывается, чтобы менеджер
 * видел ровно переданный состав).
 * @param {Object[]} creeps
 */
function runRemoteManager(creeps) {
  Game.time += 1;
  syncGameCreeps(creeps);
  delete global._remoteRoleCache;
  remoteManager.run();
}

/** Замену, которую вернул движок, превращаем в живого спавнящегося крипа. */
function newbornFrom(spawned, creeps) {
  const role = spawned.memory.role;
  const creep = makeCreep(role, undefined, { spawning: true });
  creep.name = spawned.name;
  Object.assign(creep.memory, spawned.memory);
  // Остаток спавна: движок тратит 3 тика на часть тела.
  const blueprint = CREEP_BODIES[role] || {};
  let parts = 0;
  for (const part of Object.keys(blueprint)) parts += blueprint[part];
  creep.spawnLeft = parts * 3;
  // Движок отдаёт крипа в Game.creeps сразу, ещё спавнящимся: связка замены
  // обязана быть живой с первого тика.
  Game.creeps[creep.name] = creep;
  creeps.push(creep);
  return creep;
}

function claims(creeps, role) {
  const map = {};
  for (const c of ofRole(creeps, role)) {
    if (c.memory.targetRoom) {
      map[c.memory.targetRoom] = (map[c.memory.targetRoom] || 0) + 1;
    }
  }
  return map;
}

console.log("\n1. Замена наследует targetRoom уходящего и идёт в путь");
for (const role of ["remoteMiner", "remoteHauler", "reserver"]) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const creeps = baseCreeps();

  // Уходящий: TTL на пороге, комната E35S38.
  const leaving = ofRole(creeps, role)[0];
  leaving.ticksToLive = threshold;
  leaving.memory.targetRoom = "E35S38";

  const spawn = runSpawn(creeps);
  check(
    `${role}: pre-spawn поставил ровно одну замену`,
    spawn.spawned.length === 1 && spawn.spawned[0].memory.role === role,
    spawn.spawned.map(s => s.memory.role).join(",") || "нет",
  );
  const spawned = spawn.spawned[0];
  check(
    `${role}: замена связана с уходящим (handoffFrom = ${leaving.name})`,
    spawned.memory.handoffFrom === leaving.name,
    String(spawned.memory.handoffFrom),
  );
  check(
    `${role}: уходящий помнит замену (handoffTo)`,
    leaving.memory.handoffTo === spawned.name,
    String(leaving.memory.handoffTo),
  );
  check(
    `${role}: targetRoom назначает не фабрика (политика — remote.manager)`,
    spawned.memory.targetRoom === null,
    String(spawned.memory.targetRoom),
  );

  // Замена вышла из спавна: теперь её видит remote.manager.
  const successor = newbornFrom(spawned, creeps);
  successor.spawning = false;
  successor.ticksToLive = 1500;
  runRemoteManager(creeps);

  check(
    `${role}: замена получила комнату уходящего (E35S38)`,
    successor.memory.targetRoom === "E35S38",
    String(successor.memory.targetRoom),
  );
  check(
    `${role}: уходящий сохранил свою комнату (пара держит одну на двоих)`,
    leaving.memory.targetRoom === "E35S38",
    String(leaving.memory.targetRoom),
  );
  check(
    `${role}: замена начала движение в тик назначения комнаты`,
    successor.travelToCalls.length > 0,
    String(successor.travelToCalls.length),
  );
  check(
    `${role}: замена НЕ стоит у спавна без цели (targetRoom не пуст)`,
    !!successor.memory.targetRoom,
  );
}

console.log("\n2. Уходящий вне окна: замены нет");
for (const role of ["remoteMiner", "remoteHauler", "reserver"]) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const creeps = baseCreeps();
  const leaving = ofRole(creeps, role)[0];
  leaving.ticksToLive = threshold + 1;
  leaving.memory.targetRoom = "E35S38";

  const spawn = runSpawn(creeps);
  // Добивка КВОТЫ (у хаулера теперь 4 слота) — это не замена: замену опознаём по
  // handoffFrom, который ставится только паре «уходящий → преемник».
  const replacements = spawn.spawned.filter(s => s.memory && s.memory.handoffFrom);
  check(
    `${role}: TTL ${threshold + 1} > порога → replacement нет`,
    replacements.length === 0,
    spawn.spawned.map(s => s.memory.role).join(",") || "нет",
  );
  check(
    `${role}: handoffTo не выставлен`,
    !leaving.memory.handoffTo,
    String(leaving.memory.handoffTo),
  );
}

console.log("\n3. У каждого уходящего — только одна замена");
for (const role of ["remoteMiner", "remoteHauler", "reserver"]) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const creeps = baseCreeps();
  const leaving = ofRole(creeps, role)[0];
  leaving.ticksToLive = threshold;
  leaving.memory.targetRoom = "E35S38";

  const first = runSpawn(creeps);
  check(`${role}: первая замена поставлена`, first.spawned.length === 1);
  const successor = newbornFrom(first.spawned[0], creeps); // ещё спавнится

  const second = runSpawn(creeps);
  // Считаем только ЗАМЕНЫ (handoffFrom): добивка квоты хаулера — не повторная замена.
  const secondReplacements = second.spawned.filter(
    s => s.memory && s.memory.handoffFrom,
  );
  check(
    `${role}: повторный спавн на том же уходящем не идёт`,
    secondReplacements.length === 0,
    second.spawned.map(s => s.memory.role).join(",") || "нет",
  );
  check(
    `${role}: связка не перезаписана второй заменой`,
    leaving.memory.handoffTo === successor.name,
    String(leaving.memory.handoffTo),
  );
  check(
    `${role}: уходящий без замены-дубля (handoffFrom у замены прежний)`,
    successor.memory.handoffFrom === leaving.name,
  );
}

console.log("\n4. Два независимых крипа не получают одну комнату");
for (const role of ["remoteMiner", "remoteHauler", "reserver"]) {
  const creeps = baseCreeps();
  // Оба старших крипа роли без комнат, комнат две — должны разойтись.
  const pair = ofRole(creeps, role);
  for (const c of pair) {
    c.ticksToLive = 1000;
    c.memory.targetRoom = null;
  }
  runRemoteManager(creeps);
  const slots = slotsInRoom(role);
  const used = claims(creeps, role);
  check(
    `${role}: две свободные комнаты → по одной на крипа`,
    used.E35S38 === 1 && used.E36S37 === 1,
    JSON.stringify(used),
  );

  // Третий независимый (без связки): у ролей с одним слотом комнаты не достаётся,
  // у хаулера слотов REMOTE.HAULERS_PER_ROOM — он ЗАКОННО занимает второй слот.
  const extra = makeCreep(role, 1000, { memory: { targetRoom: null } });
  creeps.push(extra);
  runRemoteManager(creeps);
  const after = claims(creeps, role);
  if (slots === 1) {
    check(
      `${role}: третий независимый крип не получает занятую комнату`,
      !extra.memory.targetRoom,
      String(extra.memory.targetRoom),
    );
    check(
      `${role}: дублей в комнатах нет`,
      after.E35S38 === 1 && after.E36S37 === 1,
      JSON.stringify(after),
    );
  } else {
    check(
      `${role}: третий крип занимает второй слот комнаты (слотов ${slots})`,
      !!extra.memory.targetRoom,
      String(extra.memory.targetRoom),
    );
    check(
      `${role}: сверх слотов дублей нет`,
      after.E35S38 <= slots && after.E36S37 <= slots,
      JSON.stringify(after),
    );
  }
}

console.log("\n5. Замена без пары — обычная выдача свободной комнаты");
for (const role of ["remoteMiner", "remoteHauler", "reserver"]) {
  const creeps = baseCreeps();
  const leaving = ofRole(creeps, role)[0];
  leaving.ticksToLive = PRESPAWN_THRESHOLD[role];
  leaving.memory.targetRoom = "E35S38";

  const spawn = runSpawn(creeps);
  const successor = newbornFrom(spawn.spawned[0], creeps);
  successor.spawning = false;
  successor.ticksToLive = 1500;

  // Уходящий умер, не дождавшись замены: пара распалась, но связка осталась
  // в памяти замены — она не должна воскреснуть и не должна мешать.
  delete Game.creeps[leaving.name];
  const alive = creeps.filter(c => c !== leaving);
  runRemoteManager(alive);

  check(
    `${role}: замену без пары не оставляем без разбирательства`,
    !alive[alive.indexOf(successor)].memory.handoffFrom ||
      alive[alive.indexOf(successor)].memory.handoffFrom === leaving.name,
  );
  check(
    `${role}: замене выдана удалённая комната из REMOTE.ROOMS`,
    REMOTE.ROOMS.indexOf(successor.memory.targetRoom) !== -1,
    String(successor.memory.targetRoom),
  );
  check(
    `${role}: в освободившейся комнате ровно один крип этой роли`,
    alive.filter(
      c => c.memory.role === role && c.memory.targetRoom === "E35S38",
    ).length === 1,
    String(
      alive.filter(
        c => c.memory.role === role && c.memory.targetRoom === "E35S38",
      ).length,
    ),
  );
  check(
    `${role}: замена двигается`,
    successor.travelToCalls.length > 0,
    String(successor.travelToCalls.length),
  );
}

console.log("\n6. Связка не воскрешает мёртвого предшественника");
{
  const creeps = baseCreeps();
  const leaving = ofRole(creeps, "remoteMiner")[0];
  leaving.ticksToLive = PRESPAWN_THRESHOLD.remoteMiner;
  leaving.memory.targetRoom = "E35S38";
  const spawn = runSpawn(creeps);
  const successor = newbornFrom(spawn.spawned[0], creeps);
  successor.spawning = false;
  successor.ticksToLive = 1500;

  delete Game.creeps[leaving.name];
  const alive = creeps.filter(c => c !== leaving);
  runRemoteManager(alive);
  check(
    "handoffFrom снят: связка с умершим не остаётся в памяти",
    !successor.memory.handoffFrom,
    String(successor.memory.handoffFrom),
  );
  check(
    "комната замены не потеряна",
    successor.memory.targetRoom === "E35S38",
    String(successor.memory.targetRoom),
  );
}

console.log("\n7. Висящая связка (спавн не удался) распускается по таймауту");
{
  const creeps = baseCreeps();
  const leaving = ofRole(creeps, "remoteMiner")[0];
  leaving.ticksToLive = PRESPAWN_THRESHOLD.remoteMiner;
  leaving.memory.targetRoom = "E35S38";

  // Спавн замены не удался (нет энергии) — связки быть не должно.
  const noEnergy = runSpawn(creeps, (cs, spawn) => {
    spawn.failNext = true;
  });
  check("спавн не удался → замены нет", noEnergy.spawned.length === 0);
  check(
    "неудачный спавн не оставил связки handoffTo",
    !leaving.memory.handoffTo,
    String(leaving.memory.handoffTo),
  );

  // Связка, поставленная раньше, но замены нет: по таймауту распускается.
  const handoffAt = Game.time;
  leaving.memory.handoffTo = "remoteMiner_E35S37_999999";
  leaving.memory.handoffAt = handoffAt;

  const soon = runSpawn(creeps);
  // Считаем спавны ТОЛЬКО роли уходящего: добивка квоты хаулера (4 слота) — не
  // повторная замена для него.
  const soonSameRole = soon.spawned.filter(s => s.memory.role === leaving.memory.role);
  check(
    "пока замена может ещё выйти из спавна — повторно не спавним",
    soonSameRole.length === 0,
    soon.spawned.map(s => s.memory.role).join(",") || "нет",
  );

  Game.time += PRESPAWN_THRESHOLD.remoteMiner * 2 + 1;
  const late = runSpawn(creeps);
  check(
    "висящая связка распущена → замена поставлена заново",
    late.spawned.filter(s => s.memory.role === leaving.memory.role).length === 1,
    late.spawned.map(s => s.memory.role).join(",") || "нет",
  );
}

console.log("\n8. Политика: комнату выбирает только remote.manager");
{
  const files = ["remote.miner.js", "remote.hauler.js", "remote.reserver.js"];
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    check(
      `${file}: нет хэш-fallback по имени`,
      !src.includes("charCodeAt"),
      "найден charCodeAt",
    );
    check(
      `${file}: нет записи targetRoom из REMOTE.ROOMS`,
      !/memory\.targetRoom\s*=\s*REMOTE\.ROOMS/.test(src),
      "роль сама выбирает комнату",
    );
    check(
      `${file}: targetRoom только читается`,
      !/memory\.targetRoom\s*=/.test(src),
      "роль пишет targetRoom",
    );
  }

  const managerSrc = fs.readFileSync(
    path.join(ROOT, "remote.manager.js"),
    "utf8",
  );
  check(
    "remote.manager.js: читает связку замены (activePairs)",
    managerSrc.includes("activePairs"),
  );
  check(
    "remote.manager.js: наследует комнату замене",
    /successor\.memory\.targetRoom\s*=/.test(managerSrc),
  );
  const handoffSrc = fs.readFileSync(
    path.join(ROOT, "remote.handoff.js"),
    "utf8",
  );
  check(
    "remote.handoff.js: связка ставится по имени, комнату не выбирает",
    !/memory\[?["']?targetRoom/.test(handoffSrc) &&
      !handoffSrc.includes("REMOTE.ROOMS"),
  );
}

console.log("\n9. Пороги пре-спавна: спавн + дорога + запас");
{
  function parts(role) {
    const bp = CREEP_BODIES[role] || {};
    let n = 0;
    for (const k of Object.keys(bp)) n += bp[k];
    return n;
  }
  for (const role of ["remoteMiner", "remoteHauler", "reserver"]) {
    const spawnTime = parts(role) * 3;
    const route = ROUTE[role];
    const expected = spawnTime + route + REMOTE.HANDOFF_SAFETY_MARGIN;
    check(
      `${role}: порог ${PRESPAWN_THRESHOLD[role]} = спавн ${spawnTime} + дорога ${route} + запас ${REMOTE.HANDOFF_SAFETY_MARGIN}`,
      PRESPAWN_THRESHOLD[role] === expected,
      `${PRESPAWN_THRESHOLD[role]} vs ${expected}`,
    );
    check(
      `${role}: порог покрывает спавн и дорогу (прибытие ≤ смерти)`,
      PRESPAWN_THRESHOLD[role] >= spawnTime + route,
      `${PRESPAWN_THRESHOLD[role]} vs ${spawnTime + route}`,
    );
    check(
      `${role}: запас не раздувает квоту (>50 % жизни)`,
      PRESPAWN_THRESHOLD[role] < 0.5 * (parts(role) === 6 ? 600 : 1500),
      String(PRESPAWN_THRESHOLD[role]),
    );
  }
  check(
    "пороги отличаются по ролям (не одно число на всех)",
    PRESPAWN_THRESHOLD.remoteMiner !== PRESPAWN_THRESHOLD.remoteHauler &&
      PRESPAWN_THRESHOLD.reserver !== PRESPAWN_THRESHOLD.remoteMiner,
  );
  check(
    "квоты дальних ролей не менялись (2/2/2)",
    SPAWN_QUOTA.remoteMiner === 2 &&
      SPAWN_QUOTA.remoteHauler === REMOTE.HAULERS_PER_ROOM * REMOTE.ROOMS.length &&
      SPAWN_QUOTA.reserver === 2,
  );
}

console.log("\n10. ИНТЕГРАЦИЯ: miner и hauler в E35S38 — полный цикл замены");
{
  // Мир: E35S38 недостижим «физически», но маршрут известен (82 тика).
  // Проверяем ПОРЯДОК событий, а не пиксели: spawn → targetRoom → travel →
  // arrival → смерть старого → работа замены.
  const creeps = baseCreeps();
  const miner = ofRole(creeps, "remoteMiner")[0];
  const hauler = ofRole(creeps, "remoteHauler")[0];
  const otherMiner = ofRole(creeps, "remoteMiner")[1];
  const otherHauler = ofRole(creeps, "remoteHauler")[1];
  otherMiner.memory.targetRoom = "E36S37";
  otherHauler.memory.targetRoom = "E36S37";

  const minerThreshold = PRESPAWN_THRESHOLD.remoteMiner;
  const haulerThreshold = PRESPAWN_THRESHOLD.remoteHauler;
  miner.ticksToLive = minerThreshold;
  hauler.ticksToLive = haulerThreshold;
  miner.memory.targetRoom = "E35S38";
  hauler.memory.targetRoom = "E35S38";

  const spawnedMiner = runSpawn(creeps);
  check(
    "miner: замена поставлена в окне пре-спавна",
    spawnedMiner.spawned.length === 1 &&
      spawnedMiner.spawned[0].memory.role === "remoteMiner",
    spawnedMiner.spawned.map(s => s.memory.role).join(",") || "нет",
  );
  const newMiner = newbornFrom(spawnedMiner.spawned[0], creeps);
  check(
    "miner: замена связана со старым (E35S38)",
    newMiner.memory.handoffFrom === miner.name,
  );

  const spawnedHauler = runSpawn(creeps);
  check(
    "hauler: замена поставлена в своём окне",
    spawnedHauler.spawned.length === 1 &&
      spawnedHauler.spawned[0].memory.role === "remoteHauler",
    spawnedHauler.spawned.map(s => s.memory.role).join(",") || "нет",
  );
  const newHauler = newbornFrom(spawnedHauler.spawned[0], creeps);

  // Спавн идёт: 54 тика у miner, 120 у hauler. Старый всё это время жив.
  let tick = 0;
  const log = [];
  const travel = { newMiner: null, newHauler: null };

  while (tick < 400) {
    tick++;
    Game.time += 1;

    // Старение: TTL уменьшается, спавн идёт.
    for (const c of creeps) {
      if (c.spawnLeft !== undefined) {
        c.spawnLeft -= 1;
        if (c.spawnLeft <= 0) {
          delete c.spawnLeft;
          c.spawning = false;
          c.ticksToLive = 1500;
          log.push(`${tick}: ${c.name} вышел из спавна`);
        }
        continue;
      }
      if (typeof c.ticksToLive === "number") c.ticksToLive -= 1;
    }

    // Роль: пока крип не в целевой комнате, он «едет» — считаем тики пути.
    for (const c of ofRole(creeps, "remoteMiner").concat(
      ofRole(creeps, "remoteHauler"),
    )) {
      if (c.spawning || !c.memory.targetRoom) continue;
      if (!c.traveling && !c.arrived) {
        c.traveling = true;
        c.pathLeft = ROUTE_TICKS[c.memory.targetRoom];
        if (c === newMiner) travel.newMiner = tick;
        if (c === newHauler) travel.newHauler = tick;
        log.push(`${tick}: ${c.name} начал путь в ${c.memory.targetRoom}`);
      } else if (c.traveling) {
        c.pathLeft -= 1;
        if (c.pathLeft <= 0) {
          delete c.traveling;
          c.arrived = true;
          log.push(`${tick}: ${c.name} прибыл в ${c.memory.targetRoom}`);
        }
      }
    }

    // remote.manager: назначение комнат и роли (в тот же тик, что и движок).
    runRemoteManager(creeps);

    // Смерть старого крипа: он исчезает из Game.creeps.
    for (const old of [miner, hauler]) {
      if (old.dead) continue;
      if (typeof old.ticksToLive === "number" && old.ticksToLive <= 0) {
        old.dead = true;
        delete Game.creeps[old.name];
        const idx = creeps.indexOf(old);
        if (idx !== -1) creeps.splice(idx, 1);
        log.push(`${tick}: СМЕРТЬ ${old.name}`);
      }
    }

    // Замена работает сразу, как только прибыла и старый умер.
    for (const n of [newMiner, newHauler]) {
      if (n.arrived && !n.working) {
        n.working = true;
        log.push(`${tick}: ${n.name} работает в ${n.memory.targetRoom}`);
      }
    }

    if (miner.dead && newMiner.working && hauler.dead && newHauler.working) {
      // Ещё два тика: связка с умершим предшественником снимается вызовом
      // remote.manager уже после его смерти.
      for (let k = 0; k < 2; k++) {
        Game.time += 1;
        runRemoteManager(creeps);
      }
      break;
    }
  }

  const timeline = name =>
    log.filter(l => l.includes(name)).map(l => Number(l.split(":")[0]));

  const newMinerStart = timeline(newMiner.name)[0];
  const newMinerArrival = newMinerStart + ROUTE_TICKS.E35S38;
  const minerDeath = timeline(miner.name).find(t => log.includes(`${t}: СМЕРТЬ ${miner.name}`));
  const newHaulerStart = timeline(newHauler.name)[0];
  const newHaulerArrival = newHaulerStart + ROUTE_TICKS.E35S38;
  const haulerDeath = timeline(hauler.name).find(t => log.includes(`${t}: СМЕРТЬ ${hauler.name}`));

  console.log("  ── хронология ──");
  for (const line of log) console.log(`     ${line}`);

  check(
    "miner: targetRoom назначен в тот же тик, что выход из спавна",
    !!newMinerStart,
    String(newMinerStart),
  );
  check(
    `miner: прибытие (${newMinerArrival}) раньше смерти старого (${minerDeath})`,
    newMinerArrival < minerDeath,
    `прибытие ${newMinerArrival} vs смерть ${minerDeath}`,
  );
  check(
    "miner: источник не простаивал (замена работала до/в момент смерти)",
    newMiner.working === true && newMinerArrival <= minerDeath,
    `работа с ${newMinerArrival}, смерть ${minerDeath}`,
  );
  check(
    `hauler: прибытие (${newHaulerArrival}) — не раньше смерти, но путь начат заранее`,
    newHaulerStart < haulerDeath,
    `старт ${newHaulerStart} vs смерть ${haulerDeath}`,
  );
  check(
    "hauler: НЕ стоял у спавна (движение началось до смерти старого)",
    newHaulerStart <= haulerDeath - 1,
    `старт ${newHaulerStart}, смерть ${haulerDeath}`,
  );
  check(
    "hauler: замена обслуживает ту же комнату (E35S38)",
    newHauler.memory.targetRoom === "E35S38",
    String(newHauler.memory.targetRoom),
  );
  check(
    "старый miner не оставил связку в памяти замены",
    !newMiner.memory.handoffFrom,
    String(newMiner.memory.handoffFrom),
  );
  check(
    "старый hauler не оставил связку в памяти замены",
    !newHauler.memory.handoffFrom,
    String(newHauler.memory.handoffFrom),
  );
  check(
    "постоянного дубля нет: в E35S38 по одному miner и hauler",
    claims(creeps, "remoteMiner").E35S38 === 1 &&
      claims(creeps, "remoteHauler").E35S38 === 1,
    JSON.stringify(claims(creeps, "remoteMiner")) +
      " / " +
      JSON.stringify(claims(creeps, "remoteHauler")),
  );
}

console.log("\n11. Фабрика: имя замены известно до спавна");
{
  Game.time = 123456;
  check(
    "creepFactory.creepName(role, room) = role_room_time",
    creepFactory.creepName("remoteMiner", HOME) ===
      `remoteMiner_${HOME}_123456`,
    creepFactory.creepName("remoteMiner", HOME),
  );
  const creeps = baseCreeps();
  const leaving = ofRole(creeps, "remoteMiner")[0];
  leaving.ticksToLive = PRESPAWN_THRESHOLD.remoteMiner;
  leaving.memory.targetRoom = "E35S38";
  Game.time = 222222;
  const spawn = runSpawn(creeps);
  check(
    "имя замены в handoffTo совпадает с фактическим именем крипа",
    leaving.memory.handoffTo === spawn.spawned[0].name,
    `${leaving.memory.handoffTo} vs ${spawn.spawned[0].name}`,
  );
  check(
    "handoffAt записан (нужен для таймаута висящей связки)",
    typeof leaving.memory.handoffAt === "number",
    String(leaving.memory.handoffAt),
  );
}

console.log("\n12. remote.handoff: контракт связи");
{
  check(
    "activePairs без связок возвращает пустые списки",
    (() => {
      const creeps = baseCreeps();
      const r = handoff.activePairs("remoteMiner", creeps);
      return r.pairs.length === 0 && r.unpaired.length === 0;
    })(),
  );

  check(
    "preSpawnCandidates сортирует по TTL (первым — тот, кто умрёт раньше)",
    (() => {
      const a = makeCreep("remoteMiner", PRESPAWN_THRESHOLD.remoteMiner);
      const b = makeCreep(
        "remoteMiner",
        PRESPAWN_THRESHOLD.remoteMiner - 20,
      );
      a.name = "zzz";
      b.name = "aaa";
      const list = handoff.preSpawnCandidates([a, b], "remoteMiner");
      return list.length === 2 && list[0] === b && list[1] === a;
    })(),
  );

  check(
    "candidates пропускают крипа с незавершённой связкой",
    (() => {
      const a = makeCreep("remoteMiner", PRESPAWN_THRESHOLD.remoteMiner);
      a.memory.handoffTo = "remoteMiner_E35S37_1";
      a.memory.handoffAt = Game.time;
      return handoff.preSpawnCandidates([a], "remoteMiner").length === 0;
    })(),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
