"use strict";
/**
 * ===================================================
 * REMOTE.PRESPAWN.TEST.JS — пре-спавн дальних ролей
 * ===================================================
 * Дефект (подтверждён на живом shard3 19.09.2026): в countRole()
 * (spawn.manager.js) для reserver/remoteMiner/remoteHauler стоял ранний
 * return — счёт по homeRoom. Из-за него фильтр по PRESPAWN_THRESHOLD
 * (строки ниже) был недостижим для этих трёх ролей, поэтому умирающий
 * дальний крип держал квоту до самого исчезновения из Game.creeps, и замена
 * начинала спавниться только после его смерти. Удалённая комната оставалась
 * без работника на время спавна плюс дорогу (замер: 150–200 тиков для
 * remoteMiner; для reserver — 88 тиков от смерти предшественника до входа
 * в целевую комнату). Дополнительно: у reserver и remoteHauler порог вообще
 * не был задан, то есть пре-спавн не работал бы даже без раннего return.
 *
 * Здесь проверяется, что после правки:
 *   1) конфиг: порог задан у всех трёх дальних ролей и не меньше времени
 *      спавна (3 тика на часть тела) — иначе замена не успеет встать;
 *   2) TTL выше порога        → нового крипа нет;
 *   3) TTL равен порогу       → замена разрешена;
 *   4) TTL ниже порога        → замена разрешена;
 *   5) два живых крипа с большим TTL → дополнительных спавнов нет;
 *   6) спавнящийся крип держит квоту (нет дубля на каждом тике спавна);
 *   7) замена + уходящий одновременно → квота не разрастается;
 *   8) старый исчез → система вернулась к штатной квоте;
 *   9) превышение квоты всегда равно числу уходящих крипов (не постоянно);
 *  10) дальние роли по-прежнему спавнятся только из E35S37;
 *  11) память/тело/blueprint заспавненного крипа не изменились;
 *  12) обычные (не дальние) роли работают как раньше.
 *  13) роль отсутствует полностью (0 живых) → подъём с нуля обычным спавном
 *      без связки handoff; роль есть, но порог пре-спавна не наступил →
 *      недостающий слот квоты добирается обычным спавном.
 *  14) восстановление ПОЛНОЙ квоты между тиками: 0 → 1 → 2 и стоп, без
 *      2 → 3 → 4; спавнящийся крип учитывается как занятый слот.
 *  15) штатный pre-spawn/handoff при 2 живых не подменяется восстановлением
 *      слота: замена по-прежнему требует уходящего крипа.
 *
 * Запуск: node tests/remote.prespawn.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Разрешение bare-require в стиле Screeps (как в игре: от корня проекта) ──
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
global.ERR_NO_BODYPART = -12;
global.RESOURCE_ENERGY = "energy";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.TOUGH = "tough";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";
global.CLAIM = "claim";

const BODY_COST = {
  tough: 10,
  work: 100,
  carry: 50,
  move: 50,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
};
function bodyCost(body) {
  let cost = 0;
  for (const part of body) cost += BODY_COST[part] || 0;
  return cost;
}

function Store(capacity, contents) {
  const target = {};
  for (const k of Object.keys(contents || {})) target[k] = contents[k];
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "getFreeCapacity") {
        return () => {
          let used = 0;
          for (const k of Object.keys(t)) used += t[k];
          return capacity - used;
        };
      }
      if (typeof prop === "symbol") return t[prop];
      if (prop in t) return t[prop];
      return 0;
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
  });
}

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  getRangeTo(t) {
    const p = t && t.pos ? t.pos : t;
    if (p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
}
global.RoomPosition = RoomPosition;

const WORLD = { objects: {} };
const ROOMS = {};

global.Game = {
  time: 1000,
  creeps: {},
  getObjectById: id => WORLD.objects[id] || null,
};
global._ = { some: () => false };

function makeRoom(name, energyAvailable) {
  const room = {
    name,
    memory: {},
    energyAvailable,
    energyCapacityAvailable: 12600,
    storage: null,
    terminal: null,
    controller: null,
  };
  ROOMS[name] = room;
  return room;
}

function makeSpawn(room, name, energy) {
  const spawn = {
    id: "SP_" + name,
    name,
    room,
    spawning: null,
    store: new Store(300, { energy }),
    spawned: [],
  };
  spawn.spawnCreep = function (body, creepName, opts) {
    const cost = bodyCost(body);
    if (cost > this.room.energyAvailable) return ERR_NOT_ENOUGH_ENERGY;
    this.spawned.push({ name: creepName, body, memory: opts.memory, cost });
    return OK;
  };
  return spawn;
}

// ── Крипы ────────────────────────────────────────────────────────────────
const HOME = "E35S37";

let creepSeq = 0;

/**
 * @param {string} role
 * @param {number|undefined} ttl
 * @param {{spawning?: boolean, homeRoom?: string, memory?: Object}} [extra]
 */
function makeCreep(role, ttl, extra) {
  const e = extra || {};
  creepSeq++;
  const spawning = e.spawning === true;
  return {
    name: `${role}_${HOME}_${creepSeq}`,
    pos: new RoomPosition(10, 10, HOME),
    store: new Store(100, {}),
    room: ROOMS[e.homeRoom || HOME],
    memory: Object.assign(
      { role, homeRoom: e.homeRoom || HOME },
      e.memory || {},
    ),
    spawning,
    // Как в движке: у спавнящегося крипа ticksToLive не определён.
    ticksToLive: spawning ? undefined : ttl,
  };
}

/**
 * Полный «здоровый» набор крипов E35S37: каждая роль SPAWN_QUOTA закрыта с
 * запасом по TTL, поэтому в базовом состоянии не спавнится никто — и в тесте
 * видно ровно реакцию на изменение TTL интересующей роли.
 * @returns {Object[]}
 */
function baseCreeps() {
  // Хаулеров в фикстуре — РОВНО по квоте (REMOTE.HAULERS_PER_ROOM × ROOMS = 4).
  // Иначе spawn.manager в каждом сценарии добивает квоту, и счётчики спавнов
  // перестают означать пре-спавн (после роста квоты с 2 до 4 это и случилось).
  const haulers = [];
  for (let i = 0; i < SPAWN_QUOTA.remoteHauler; i++) {
    haulers.push(makeCreep("remoteHauler", 1000));
  }
  return [
    makeCreep("linkWorker", 1000),
    makeCreep("miner", 1000),
    makeCreep("miner", 1000),
    makeCreep("worker", 1000),
    makeCreep("worker", 1000),
    makeCreep("reserver", 500),
    makeCreep("reserver", 500),
    makeCreep("remoteMiner", 1000),
    makeCreep("remoteMiner", 1000),
    ...haulers,
    // labWorker — тоже РОВНО по квоте, по той же причине, что и хаулеры выше:
    // квота выросла 1 → 2, фикстура перестала закрывать роль, и в каждом
    // сценарии появлялся лишний спавн labWorker (37 упавших проверок).
    ...Array.from({ length: SPAWN_QUOTA.labWorker }, () =>
      makeCreep("labWorker", 1000),
    ),
  ];
}

function ofRole(creeps, role) {
  return creeps.filter(c => c.memory.role === role);
}

// ── Загрузка проверяемых модулей ─────────────────────────────────────────
global.Memory = {
  rooms: { E35S37: { tasks: {}, minerSpots: [{ x: 18, y: 4 }, { x: 29, y: 6 }] } },
  creeps: {},
};

const spawnManager = require("../spawn.manager");
const constants = require("../constants");
const {
  SPAWN_QUOTA,
  CREEP_BODIES,
  PRESPAWN_THRESHOLD,
  ROOM_SPAWN_QUOTA_OVERRIDES,
  REMOTE,
} = constants;

// Дальние роли проекта (remote.reserver / remote.miner / remote.hauler).
const REMOTE_ROLES = ["reserver", "remoteMiner", "remoteHauler"];

// Время спавна в движке: 3 тика на часть тела.
function partsCount(role) {
  const bp = CREEP_BODIES[role] || {};
  let n = 0;
  for (const k of Object.keys(bp)) n += bp[k];
  return n;
}
function spawnTime(role) {
  return partsCount(role) * 3;
}

// Жизнь крипа: CLAIM-части укорачивают её до 600 тиков (reserver).
function lifetime(role) {
  const bp = CREEP_BODIES[role] || {};
  return bp.claim ? 600 : 1500;
}

// ── Прогон spawn.manager за один тик ─────────────────────────────────────
function runSpawn(mutate, roomName) {
  const name = roomName || HOME;
  const room = makeRoom(name, 12600);
  const spawn = makeSpawn(room, "Spawn1", 300);

  const creeps = baseCreeps();
  if (mutate) mutate(creeps);

  const roomState = {
    roomName: name,
    room,
    spawns: [spawn],
    creeps,
    sources: [],
    extensions: [],
  };

  spawnManager.run(roomState);
  return { spawn, creeps, spawned: spawn.spawned };
}

function spawnedRoles(spawn) {
  return spawn.spawned.map(s => s.memory.role).join(",") || "нет";
}

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

// ── 1. Конфиг пре-спавна дальних ролей ───────────────────────────────────
{
  console.log("\n1. Конфиг: порог задан у всех дальних ролей и покрывает спавн");

  for (const role of REMOTE_ROLES) {
    const threshold = PRESPAWN_THRESHOLD[role];
    check(
      `${role}: порог задан (PRESPAWN_THRESHOLD.${role})`,
      typeof threshold === "number" && threshold > 0,
      String(threshold),
    );
    check(
      `${role}: порог ${threshold} >= времени спавна ${spawnTime(role)} (3 тика × ${partsCount(role)} частей)`,
      threshold >= spawnTime(role),
      `${threshold} vs ${spawnTime(role)}`,
    );
    check(
      `${role}: порог меньше жизни крипа (${lifetime(role)}) — квота не будет открыта всегда`,
      threshold < lifetime(role),
      `${threshold} vs ${lifetime(role)}`,
    );
    check(
      `${role}: квота в SPAWN_QUOTA = слоты на комнату (хаулер ${constants.REMOTE.HAULERS_PER_ROOM})`,
      role === "remoteHauler"
        ? SPAWN_QUOTA[role] ===
            constants.REMOTE.HAULERS_PER_ROOM * constants.REMOTE.ROOMS.length
        : SPAWN_QUOTA[role] === 2,
      String(SPAWN_QUOTA[role]),
    );
  }

  // Порог считается от РЕАЛЬНОГО времени спавна тела (3 тика × частей), поэтому
  // проверяем формулу, а не литерал: после пересмотра тел под бусты remoteMiner
  // стал 13 частей (было 18) и порог опустился до 151.
  check(
    `remoteMiner: порог = спавн ${spawnTime("remoteMiner")} + дорога 82 + запас 30`,
    PRESPAWN_THRESHOLD.remoteMiner === spawnTime("remoteMiner") + 82 + 30,
    `${PRESPAWN_THRESHOLD.remoteMiner} vs ${spawnTime("remoteMiner") + 82 + 30}`,
  );
  check(
    "дальние роли не переопределены в ROOM_SPAWN_QUOTA_OVERRIDES",
    REMOTE_ROLES.every(
      role =>
        !ROOM_SPAWN_QUOTA_OVERRIDES[HOME] ||
        ROOM_SPAWN_QUOTA_OVERRIDES[HOME][role] === undefined,
    ),
    JSON.stringify(ROOM_SPAWN_QUOTA_OVERRIDES[HOME]),
  );
  check(
    "домашняя комната дальних ролей — E35S37",
    REMOTE.HOME_ROOM === HOME,
    String(REMOTE.HOME_ROOM),
  );
}

// ── 2. Сценарии пре-спавна по каждой дальней роли ────────────────────────
for (const role of REMOTE_ROLES) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const quota = SPAWN_QUOTA[role];

  // Спавны ТОЛЬКО тестируемой роли: квота хаулера выросла до 4 (два хаулера на
  // маршрут — REMOTE.HAULERS_PER_ROOM), поэтому в сценариях других ролей идёт
  // добивка его квоты, и это не ошибка пре-спавна.
  const spawnsOf = r => r.spawned.filter(s => s.memory && s.memory.role === role);

  console.log(`\n2. ${role}: пре-спавн (порог ${threshold}, квота ${quota})`);

  // 2.1 TTL выше порога — нового крипа нет
  {
    const r = runSpawn(cs => {
      ofRole(cs, role)[0].ticksToLive = threshold + 1;
    });
    check(
      `TTL ${threshold + 1} > порога → нового крипа нет`,
      spawnsOf(r).length === 0,
      spawnedRoles(r.spawn),
    );
  }

  // 2.2 TTL равен порогу — замена разрешена
  {
    const r = runSpawn(cs => {
      ofRole(cs, role)[0].ticksToLive = threshold;
    });
    const s = spawnsOf(r)[0];
    check(
      `TTL ${threshold} == порога → замена разрешена`,
      spawnsOf(r).length === 1 && s.memory.role === role,
      spawnedRoles(r.spawn),
    );
    check(
      "замена поставлена ровно одна (не больше одного крипа за тик)",
      spawnsOf(r).length === 1,
      String(spawnsOf(r).length),
    );
  }

  // 2.3 TTL ниже порога — замена разрешена
  {
    const r = runSpawn(cs => {
      ofRole(cs, role)[0].ticksToLive = 5;
    });
    check(
      "TTL 5 < порога → замена разрешена",
      spawnsOf(r).length === 1 && spawnsOf(r)[0].memory.role === role,
      spawnedRoles(r.spawn),
    );
  }

  // 2.4 Два обычных живых крипа с большим TTL — спавнов нет
  {
    const r = runSpawn();
    check(
      `два живых ${role} с TTL 1000 → дополнительных спавнов нет`,
      spawnsOf(r).length === 0,
      spawnedRoles(r.spawn),
    );
  }

  // 2.5 Спавнящийся крип держит квоту (нет дубля на каждом тике спавна)
  {
    const r = runSpawn(cs => {
      const c = ofRole(cs, role)[0];
      c.spawning = true;
      c.ticksToLive = undefined;
    });
    check(
      "спавнящийся крип (ticksToLive === undefined) держит квоту → дубля нет",
      spawnsOf(r).length === 0,
      spawnedRoles(r.spawn),
    );
  }

  // 2.6 Замена + уходящий одновременно — квота не разрастается
  {
    const first = runSpawn(cs => {
      ofRole(cs, role)[0].ticksToLive = 10;
    });
    const replacement = first.spawned.filter(s => s.memory && s.memory.role === role)[0];
    check(
      "первый тик: замена уходящего поставлена",
      !!replacement && replacement.memory.role === role,
      spawnedRoles(first.spawn),
    );

    const second = runSpawn(cs => {
      ofRole(cs, role)[0].ticksToLive = 9; // старый ещё жив
      cs.push(
        makeCreep(role, undefined, { spawning: true, memory: { homeRoom: HOME } }),
      ); // замена ещё спавнится
    });
    const alive = ofRole(second.creeps, role).length;
    check(
      "второй тик: уходящий + спавнящаяся замена → второго спавна нет",
      second.spawned.filter(s => s.memory && s.memory.role === role).length === 0,
      spawnedRoles(second.spawn),
    );
    check(
      `живых ${alive} = квота ${quota} + 1 уходящий`,
      alive === quota + 1,
      String(alive),
    );
  }

  // 2.7 Старый исчез — вернулись к штатной квоте
  {
    const r = runSpawn(cs => {
      const leaving = ofRole(cs, role)[0];
      cs.splice(cs.indexOf(leaving), 1); // старый умер
      cs.push(makeCreep(role, lifetime(role) - 100)); // замена вошла в работу
    });
    check(
      "старый исчез, замена работает → спавнов нет (штатная квота)",
      spawnsOf(r).length === 0,
      spawnedRoles(r.spawn),
    );
    const alive = ofRole(r.creeps, role).length;
    check(`живых ${alive} == квота ${quota}`, alive === quota, String(alive));
  }

  // 2.8 Память/тело заспавненного крипа не изменились
  {
    const r = runSpawn(cs => {
      ofRole(cs, role)[0].ticksToLive = 1;
    });
    const s = spawnsOf(r)[0];
    check("роль заспавненного крипа совпадает", !!s && s.memory.role === role);
    check(
      `homeRoom = ${HOME} (спавн только из домашней комнаты)`,
      !!s && s.memory.homeRoom === HOME,
      s ? String(s.memory.homeRoom) : "нет",
    );
    check(
      "targetRoom = null (назначает remote.manager, как и раньше)",
      !!s && s.memory.targetRoom === null,
      s ? String(s.memory.targetRoom) : "нет",
    );
    check(
      "blueprint/body не изменились",
      !!s && bodyCost(s.body) === bodyCost(expectedBody(role)),
      s ? `${bodyCost(s.body)} vs ${bodyCost(expectedBody(role))}` : "нет",
    );
    check(
      "стоимость тела совпадает с CREEP_BODIES",
      !!s && s.body.length === partsCount(role),
      s ? `${s.body.length} vs ${partsCount(role)}` : "нет",
    );
  }
}

// Тело, которое обязан собрать creep.factory: TOUGH → WORK → CARRY →
// RANGED_ATTACK → HEAL → CLAIM → MOVE (см. prepareBody).
function expectedBody(role) {
  const bp = CREEP_BODIES[role] || {};
  const body = [];
  const order = [
    "tough",
    "work",
    "carry",
    "ranged_attack",
    "heal",
    "claim",
    "move",
  ];
  for (const part of order) {
    for (let i = 0; i < (bp[part] || 0); i++) body.push(part);
  }
  return body;
}

// ── 3. Вытеснение: замена есть только у уходящего и только одна ───────────
for (const role of REMOTE_ROLES) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const quota = SPAWN_QUOTA[role];

  console.log(`\n3. ${role}: замены только у уходящих, и у каждого — одна`);

  const staggered = simulate(role, [threshold, lifetime(role) - 200], 900);
  check(
    "живых никогда не больше «квота + уходящие»",
    staggered.maxOverQuota <= 0,
    `max(живых − квота − уходящих) = ${staggered.maxOverQuota}`,
  );
  check(
    "пре-спавн действительно сработал (в симуляции были спавны)",
    staggered.spawns >= 1,
    String(staggered.spawns),
  );
  check(
    "система возвращается к штатной квоте (был тик ровно с квотой)",
    staggered.sawExactQuota,
  );
  check(
    "каждая замена поставлена уходящему крипу той же роли (связка)",
    staggered.spawnedWithoutPair === 0,
    `спавнов без связки: ${staggered.spawnedWithoutPair}`,
  );
  check(
    "у одного уходящего крипа не больше одной замены",
    Object.keys(staggered.replacementOf).every(
      name => staggered.replacementOf[name] === 1,
    ),
    JSON.stringify(staggered.replacementOf),
  );
  check(
    "работающих (вне окна пре-спавна) никогда не больше квоты",
    staggered.maxWorking <= quota,
    `${staggered.maxWorking} vs ${quota}`,
  );

  const simultaneous = simulate(role, [threshold, threshold], 900);
  check(
    "оба уходящих сразу → живых не больше «квота + 2 уходящих»",
    simultaneous.maxAlive <= quota + 2,
    String(simultaneous.maxAlive),
  );
  check(
    "после спада окна живых не больше «квота + уходящие»",
    simultaneous.alive <= quota + simultaneous.leavingAtEnd,
    `${simultaneous.alive} vs ${quota} + ${simultaneous.leavingAtEnd}`,
  );
}

/**
 * Симуляция N тиков: крипы роли стареют, спавнер вызывается каждый тик.
 * Филлеры остальных ролей бессмертны, умирает только целевая роль.
 *
 * Модель движка соблюдена в той части, от которой зависит связка замены:
 *  - у каждого крипа уникальное имя (creep.factory собирает его из Game.time);
 *  - Game.creeps содержит всех живых, включая спавнящихся;
 *  - память заспавненного крипа (handoffFrom) и связка уходящего (handoffTo)
 *    записываются в тот же тик и на те же объекты, что видит движок.
 *
 * @param {string} role
 * @param {number[]} startTtls TTL двух стартовых крипов роли
 * @param {number} ticks
 * @param {() => Object[]} [startCreeps] стартовый состав комнаты. По умолчанию
 *        baseCreeps() с TTL из startTtls. Передаётся, когда стартовое состояние
 *        отличается от «здоровой» комнаты, — например роль отсутствует
 *        полностью (проверка восстановления квоты с нуля).
 */
function simulate(role, startTtls, ticks, startCreeps) {
  const threshold = PRESPAWN_THRESHOLD[role];
  const quota = SPAWN_QUOTA[role];
  makeRoom(HOME, 12600);
  let creeps = startCreeps ? startCreeps() : baseCreeps();
  if (!startCreeps) {
    ofRole(creeps, role).forEach((c, i) => {
      c.ticksToLive = startTtls[i];
    });
  }

  // Как в движке: все живые крипы лежат в Game.creeps по имени — связка замены
  // читается именно оттуда (remote.handoff.activePairs).
  Game.creeps = {};
  for (const c of creeps) Game.creeps[c.name] = c;

  const stats = {
    spawns: 0,
    maxAlive: 0,
    maxWorking: 0,
    maxOverQuota: 0,
    spawnedWithoutPair: 0,
    sawExactQuota: false,
    // Спавны роли без связки (восстановление слота квоты) и со связкой
    // (штатная замена уходящего) — их важно различать.
    restorationSpawns: 0,
    pairedSpawns: 0,
    // Сколько замен поставлено каждому уходящему крипу за всю симуляцию:
    // у одного предшественника замена может быть только одна.
    replacementOf: {},
    // Тик → сколько крипов роли было в комнате на момент вызова спавнера и
    // сколько он поставил. Нужно, чтобы проверить состояние квоты МЕЖДУ
    // последовательными тиками, а не только итог.
    history: [],
  };

  for (let t = 0; t < ticks; t++) {
    // Тик движка идёт вперёд: имена крипов в игре уникальны, а связка замены
    // (memory.handoffFrom / handoffTo) держится на уникальном имени.
    Game.time += 1;
    const room = makeRoom(HOME, 12600);
    const spawn = makeSpawn(room, "Spawn1", 300);
    spawnManager.run({
      roomName: HOME,
      room,
      spawns: [spawn],
      creeps,
      sources: [],
      extensions: [],
    });

    // Состояние на момент вызова спавнера: сколько крипов роли уже числится за
    // комнатой (включая спавнящихся) и что спавнер поставил в этом тике.
    stats.history.push({
      tick: Game.time,
      aliveBefore: ofRole(creeps, role).length,
      spawned: spawn.spawned.filter(s => s.memory.role === role).length,
      paired: spawn.spawned.filter(
        s => s.memory.role === role && s.memory.handoffFrom,
      ).length,
    });

    for (let i = 0; i < spawn.spawned.length; i++) {
      const spawned = spawn.spawned[i];
      const newborn = makeCreep(role, undefined, { spawning: true });
      newborn.name = spawned.name;
      const leavingName = spawned.memory && spawned.memory.handoffFrom;
      if (leavingName) newborn.memory.handoffFrom = leavingName;

      // Движок отдаёт крипа в Game.creeps сразу, ещё спавнящимся.
      Game.creeps[newborn.name] = newborn;
      newborn.spawnLeft = spawnTime(role);
      creeps.push(newborn);
      stats.spawns++;

      if (!leavingName) {
        stats.spawnedWithoutPair++;
        if (spawned.memory.role === role) stats.restorationSpawns++;
        continue;
      }
      stats.pairedSpawns++;
      const leaving = Game.creeps[leavingName];
      if (leaving) leaving.memory.handoffTo = newborn.name;
      stats.replacementOf[leavingName] =
        (stats.replacementOf[leavingName] || 0) + 1;
    }

    for (const c of creeps) {
      if (c.memory.role !== role) continue;
      if (c.spawnLeft !== undefined) {
        c.spawnLeft -= 1;
        if (c.spawnLeft <= 0) {
          delete c.spawnLeft;
          c.spawning = false;
          c.ticksToLive = lifetime(role);
        }
        continue;
      }
      c.ticksToLive -= 1;
    }

    creeps = creeps.filter(c => {
      const dead =
        c.memory.role === role &&
        !c.spawning &&
        typeof c.ticksToLive === "number" &&
        c.ticksToLive <= 0;

      // Умерший крип исчезает и из Game.creeps (движок) — иначе связка замены
      // выглядела бы живой, когда предшественника уже нет.
      if (dead) delete Game.creeps[c.name];
      return !dead;
    });

    const alive = ofRole(creeps, role).length;
    // Уходящие за тик до старения (как их видит спавнер на своём вызове).
    const leaving = ofRole(creeps, role).filter(
      c =>
        typeof c.ticksToLive === "number" && c.ticksToLive + 1 <= threshold,
    ).length;
    const working = alive - leaving;

    stats.maxAlive = Math.max(stats.maxAlive, alive);
    stats.maxWorking = Math.max(stats.maxWorking, working);
    // Инвариант: «держащих квоту» никогда не больше квоты, поэтому любое
    // превышение объясняется ровно уходящими крипами.
    stats.maxOverQuota = Math.max(stats.maxOverQuota, alive - quota - leaving);
    if (alive === quota) stats.sawExactQuota = true;
  }

  stats.alive = ofRole(creeps, role).length;
  stats.leavingAtEnd = ofRole(creeps, role).filter(
    c => typeof c.ticksToLive === "number" && c.ticksToLive + 1 <= threshold,
  ).length;
  return stats;
}

// ── 4. Дальние роли спавнятся только из E35S37 ───────────────────────────
{
  console.log("\n4. Дальние роли по-прежнему спавнятся только из E35S37");

  for (const roomName of ["E35S39", "E36S38", "E37S37"]) {
    const r = runSpawn(cs => {
      for (const role of REMOTE_ROLES) {
        for (const c of ofRole(cs, role)) c.ticksToLive = 1;
      }
    }, roomName);
    // В этих комнатах штатно может спавниться attacker — проверяем именно
    // отсутствие спавна дальних ролей.
    const remoteSpawned = r.spawned.filter(
      s => REMOTE_ROLES.indexOf(s.memory.role) !== -1,
    );
    check(
      `${roomName}: уходящие дальние крипы → спавнов дальних ролей нет`,
      remoteSpawned.length === 0,
      spawnedRoles(r.spawn),
    );
  }

  const home = runSpawn(cs => {
    for (const role of REMOTE_ROLES) {
      for (const c of ofRole(cs, role)) c.ticksToLive = 1;
    }
  });
  check(
    "E35S37: те же уходящие крипы → замены поставлены",
    home.spawned.length > 0,
    spawnedRoles(home.spawn),
  );
}

// ── 5. Обычные (не дальние) роли работают как раньше ─────────────────────
{
  console.log("\n5. Обычные роли: квота и порог пре-спавна не сломаны");

  const minerHigh = runSpawn(cs => {
    ofRole(cs, "miner")[0].ticksToLive = PRESPAWN_THRESHOLD.miner + 1;
  });
  check(
    "miner: TTL выше порога → спавнов нет",
    minerHigh.spawned.length === 0,
    spawnedRoles(minerHigh.spawn),
  );

  const minerLow = runSpawn(cs => {
    ofRole(cs, "miner")[0].ticksToLive = PRESPAWN_THRESHOLD.miner;
  });
  check(
    "miner: TTL на пороге → замена поставлена",
    minerLow.spawned.length === 1 &&
      minerLow.spawned[0].memory.role === "miner",
    spawnedRoles(minerLow.spawn),
  );

  const linkHigh = runSpawn(cs => {
    ofRole(cs, "linkWorker")[0].ticksToLive =
      PRESPAWN_THRESHOLD.linkWorker + 1;
  });
  check(
    "linkWorker: TTL выше порога → спавнов нет",
    linkHigh.spawned.length === 0,
    spawnedRoles(linkHigh.spawn),
  );

  const linkLow = runSpawn(cs => {
    ofRole(cs, "linkWorker")[0].ticksToLive = PRESPAWN_THRESHOLD.linkWorker;
  });
  check(
    "linkWorker: TTL на пороге → замена поставлена",
    linkLow.spawned.length === 1 &&
      linkLow.spawned[0].memory.role === "linkWorker",
    spawnedRoles(linkLow.spawn),
  );

  const workerHigh = runSpawn(cs => {
    for (const c of ofRole(cs, "worker")) {
      c.ticksToLive = PRESPAWN_THRESHOLD.worker + 1;
    }
  });
  check(
    "worker: TTL выше порога → спавнов нет",
    workerHigh.spawned.length === 0,
    spawnedRoles(workerHigh.spawn),
  );

  const workerLow = runSpawn(cs => {
    for (const c of ofRole(cs, "worker")) {
      c.ticksToLive = PRESPAWN_THRESHOLD.worker;
    }
  });
  check(
    "worker: TTL на пороге → замена поставлена",
    workerLow.spawned.length === 1 &&
      workerLow.spawned[0].memory.role === "worker",
    spawnedRoles(workerLow.spawn),
  );

  // Роли без порога пре-спавна не должны его получить случайно.
  const noThreshold = runSpawn(cs => {
    ofRole(cs, "labWorker")[0].ticksToLive = 1;
  });
  check(
    "labWorker (порога нет): умирающий крип держит квоту, спавнов нет",
    noThreshold.spawned.length === 0,
    spawnedRoles(noThreshold.spawn),
  );
}

// ── 6. Подъём дальней роли с нуля (роль отсутствует полностью) ───────────
// Дефект (подтверждён на живом shard3 21.09.2026): pre-spawn дальней роли
// требовал живого уходящего крипа. При 0 живых крипов роли preSpawnCandidates
// возвращал пустой список, leaving оставался null, и роль пропускалась
// НАВСЕГДА — дальняя добыча не могла возродиться: на шарде было
// 0 × reserver/remoteMiner/remoteHauler при квоте 2 у каждой, спавны
// простаивали с полной энергией 12600/12600.
//
// Здесь проверяется, что роль с нуля поднимается обычным спавном, и при этом
// НЕ ломается штатное правило: роль есть, но до порога пре-спавна далеко →
// дубль не ставится.
{
  console.log("\n6. Подъём с нуля: 0 живых крипов роли");

  // Проверяем именно вызов creepFactory.run, а не только его побочный эффект.
  const creepFactory = require("../creep.factory");
  const origRun = creepFactory.run;
  let runCalls = [];
  creepFactory.run = function (...args) {
    runCalls.push(args);
    return origRun.apply(this, args);
  };

  try {
    for (const role of REMOTE_ROLES) {
      const threshold = PRESPAWN_THRESHOLD[role];
      const quota = SPAWN_QUOTA[role];

      // ── 6.1 Роль вычищена полностью — как на живом шарде ────────────────
      runCalls = [];
      const zero = runSpawn(cs => {
        for (let i = cs.length - 1; i >= 0; i--) {
          if (cs[i].memory.role === role) cs.splice(i, 1);
        }
      });

      check(
        `${role}: 0 живых → роль не пропущена, creepFactory.run вызван`,
        runCalls.length === 1 && runCalls[0][1] === role,
        runCalls.map(a => a[1]).join(",") || "run не вызван",
      );
      check(
        `${role}: 0 живых → крип создан с нуля (квота ${quota})`,
        zero.spawned.length === 1 && zero.spawned[0].memory.role === role,
        spawnedRoles(zero.spawn),
      );
      check(
        `${role}: подъём с нуля идёт без связки handoff (handoffFrom пуст)`,
        zero.spawned.length === 1 &&
          (zero.spawned[0].memory.handoffFrom === null ||
            zero.spawned[0].memory.handoffFrom === undefined),
        zero.spawned.length
          ? String(zero.spawned[0].memory.handoffFrom)
          : "нет спавна",
      );
      check(
        `${role}: targetRoom = null — комнату выдаст remote.manager новому крипу`,
        zero.spawned.length === 1 && zero.spawned[0].memory.targetRoom === null,
        zero.spawned.length
          ? String(zero.spawned[0].memory.targetRoom)
          : "нет спавна",
      );
      check(
        `${role}: за один тик поставлен ровно один крип`,
        zero.spawned.length === 1,
        spawnedRoles(zero.spawn),
      );

      // ── 6.2 Роль есть (1 живой), но замены пока нет ─────────────────────
      // Квота не набрана, заменять некого: это ВОССТАНОВЛЕНИЕ недостающего
      // слота, а не замена, поэтому оно не должно требовать уходящего крипа.
      const oneAlive = cs => {
        const mine = ofRole(cs, role);
        for (let i = cs.length - 1; i >= 0; i--) {
          if (cs[i].memory.role === role && cs[i] !== mine[0]) cs.splice(i, 1);
        }
        return mine[0];
      };

      const partial = runSpawn(cs => {
        oneAlive(cs).ticksToLive = threshold + 1;
      });
      check(
        `${role}: 1 живой, TTL ${threshold + 1} > порога → недостающий слот квоты добран`,
        partial.spawned.length === 1 && partial.spawned[0].memory.role === role,
        spawnedRoles(partial.spawn),
      );
      check(
        `${role}: добор слота идёт без связки (handoffFrom пуст)`,
        partial.spawned.length === 1 &&
          !partial.spawned[0].memory.handoffFrom,
        partial.spawned.length
          ? String(partial.spawned[0].memory.handoffFrom)
          : "нет спавна",
      );

      const partialLow = runSpawn(cs => {
        oneAlive(cs).ticksToLive = threshold;
      });
      check(
        `${role}: 1 живой на пороге ${threshold} → замена поставлена`,
        partialLow.spawned.length === 1 &&
          partialLow.spawned[0].memory.role === role,
        spawnedRoles(partialLow.spawn),
      );
      check(
        `${role}: замена связана с уходящим (handoffFrom = его имя)`,
        partialLow.spawned.length === 1 &&
          typeof partialLow.spawned[0].memory.handoffFrom === "string" &&
          partialLow.spawned[0].memory.handoffFrom.indexOf(role) === 0,
        partialLow.spawned.length
          ? String(partialLow.spawned[0].memory.handoffFrom)
          : "нет спавна",
      );
    }
  } finally {
    creepFactory.run = origRun;
  }
}

// ── 7. Восстановление полной квоты с нуля: 0 → 1 → 2 → стоп ──────────────
// Проверяется состояние квоты МЕЖДУ последовательными тиками на «движковом»
// симуляторе (Game.creeps, реальный спавн с spawnTime, старение, смерть).
//
// Ключевая развилка: восстановление недостающего слота квоты и штатная замена
// уходящего — разные случаи. Недостающий слот не требует уходящего крипа, но
// спавнящийся крип занимает слот СРАЗУ, поэтому 2 → 3 → 4 невозможно.
for (const role of REMOTE_ROLES) {
  const quota = SPAWN_QUOTA[role];
  const threshold = PRESPAWN_THRESHOLD[role];

  console.log(`\n7. ${role}: восстановление квоты ${quota} с нуля (0 → 1 → 2)`);

  const noRoleCreeps = () => baseCreeps().filter(c => c.memory.role !== role);

  // ── 7.1 Роль отсутствует полностью — состояние A → B → C ───────────────
  const zero = simulate(role, [], 300, noRoleCreeps);
  const h = zero.history;

  check(
    "тик 1: 0 живых → поставлен 1-й крип",
    h[0].spawned === 1 && h[0].aliveBefore === 0,
    JSON.stringify(h[0]),
  );
  check(
    "тик 2: 1 крип (ещё спавнится) → поставлен 2-й крип",
    h[1].spawned === 1 && h[1].aliveBefore === 1,
    JSON.stringify(h[1]),
  );
  check(
    `тик ${quota + 1}: квота ${quota} набрана → новых крипов нет`,
    h[quota].spawned === 0 && h[quota].aliveBefore === quota,
    JSON.stringify(h[quota]),
  );
  check(
    `дальше спавнов нет до конца симуляции (квота ${quota} достигнута)`,
    h.slice(quota).every(x => x.spawned === 0),
    `спавнов после тика ${quota}: ${h.slice(quota).reduce((s, x) => s + x.spawned, 0)}`,
  );
  check(
    `восстановлено ровно ${quota} слота (не больше квоты)`,
    zero.restorationSpawns === quota,
    String(zero.restorationSpawns),
  );
  check(
    "восстановление шло без связок handoff (заменять было некого)",
    zero.pairedSpawns === 0,
    String(zero.pairedSpawns),
  );
  check(
    `живых/спавнящихся никогда не больше квоты (${quota})`,
    zero.maxAlive === quota,
    String(zero.maxAlive),
  );
  check(
    `в конце ровно ${quota} крипа роли`,
    zero.alive === quota,
    String(zero.alive),
  );

  // ── 7.2 Состояние B: один живой, вне окна пре-спавна ───────────────────
  const oneHealthy = () =>
    baseCreeps()
      .filter(c => c.memory.role !== role)
      .concat([makeCreep(role, 300)]);

  const b = simulate(role, [], 200, oneHealthy);
  check(
    `1 живой вне окна → добор остальных слотов обычным спавном (${quota - 1})`,
    b.restorationSpawns === quota - 1,
    String(b.restorationSpawns),
  );
  check(
    `квота соблюдена: живых не больше «квота + уходящие»`,
    b.maxOverQuota <= 0,
    `max(живых − ${quota} − уходящих) = ${b.maxOverQuota}`,
  );

  // ── 7.3 Состояние с занятым слотом у спавнящегося крипа ────────────────
  const oneSpawning = () =>
    baseCreeps()
      .filter(c => c.memory.role !== role)
      .concat([makeCreep(role, undefined, { spawning: true })]);

  const sp = simulate(role, [], 10, oneSpawning);
  check(
    "1 спавнящийся крип → добор недостающего слота",
    sp.history[0].spawned === 1,
    JSON.stringify(sp.history[0]),
  );
  check(
    `добор до квоты ${quota} = ${quota - 1} спавнов, дальше тишина`,
    sp.history.filter(x => x.spawned === 1).length === quota - 1 &&
      sp.history.slice(quota).every(x => x.spawned === 0),
    JSON.stringify(sp.history.map(x => x.spawned)),
  );
  check(
    `спавнящийся крип учтён как занятый слот (всего ${quota})`,
    sp.maxAlive === quota,
    String(sp.maxAlive),
  );

  // ── 7.4 Состояние D: штатный pre-spawn/handoff не сломан ───────────────
  const d = simulate(role, [threshold, lifetime(role) - 200], 400);
  check(
    "2 живых, один на пороге → замена идёт СО связкой (handoff)",
    d.pairedSpawns >= 1,
    String(d.pairedSpawns),
  );
  check(
    "штатная замена не подменяется восстановлением слота",
    d.restorationSpawns === 0,
    String(d.restorationSpawns),
  );
  check(
    "каждая замена поставлена уходящему крипу той же роли (связка цела)",
    d.spawnedWithoutPair === 0,
    `спавнов без связки: ${d.spawnedWithoutPair}`,
  );
  check(
    "у одного уходящего крипа не больше одной замены",
    Object.keys(d.replacementOf).every(name => d.replacementOf[name] === 1),
    JSON.stringify(d.replacementOf),
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
