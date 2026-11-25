"use strict";
/**
 * ===================================================
 * REMOTE.MANAGER.TEST.JS — раздача targetRoom дальним ролям
 * ===================================================
 * Проверяем единственную точку назначения удалённой комнаты
 * (remote.manager.assignTargetRoom) и её стык со спавном (spawn.manager):
 *
 *   1) порог пре-спавна дальних ролей = спавн + маршрут + запас (инвариант
 *      constants.js: смена тела без пересчёта порога — красный тест, а не
 *      тихая поломка доставки замены);
 *   2) 2 майнера → по одной комнате;
 *   3) 4 хаулера → 2 + 2 (у хаулера REMOTE.HAULERS_PER_ROOM слотов);
 *   4) 3 майнера → третий ждёт с targetRoom = null;
 *   5) невалидная комната сбрасывается (её нет в REMOTE.ROOMS);
 *   6) handoff-пара наследует комнату уходящего и занимает ОДИН слот;
 *   7) без handoff дубль вытесняется (побеждает тот, кому раньше умирать);
 *   8) битая связка (уходящий умер) — замена распределяется как обычный крип;
 *   9) висячая связка (замена не вышла из спавна) снимается по таймауту;
 *  10) run() собирает три списка одним проходом по Game.creeps;
 *  11) спавн: дальние роли НЕ спавнятся вне REMOTE.HOME_ROOM;
 *  12) спавн: замена получает handoffFrom, уходящий — handoffTo (bindHandoff);
 *  13) спавн: пока пара занимает слот, третьего крипа не ставят.
 *
 * Моки — обычные объекты, без фреймворка (стиль tests/spawn.count.test.js).
 * Запуск: node tests/remote.manager.test.js
 */

/* ── Шим разрешения модулей (как на шарде: require("remote.manager")) ────── */
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
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.TOUGH = "tough";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.ATTACK = "attack";
global.RANGED_ATTACK = "ranged_attack";
global.HEAL = "heal";
global.CLAIM = "claim";
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
  rooms: {},
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
};

const {
  REMOTE,
  SPAWN_QUOTA,
  CREEP_BODIES,
  PRESPAWN_THRESHOLD,
} = require("../constants");
const remoteManager = require("../remote.manager");
const { bindHandoff, isRemoteRole } = require("../remote.handoff");
const spawnManager = require("../spawn.manager");

const HOME = REMOTE.HOME_ROOM;
const ROOM_A = REMOTE.ROOMS[0];
const ROOM_B = REMOTE.ROOMS[1];

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

/** Крип-мок: только то, что читают remote.manager и spawn.manager. */
function mk(name, role, ticksToLive, memory) {
  return {
    name,
    ticksToLive,
    memory: Object.assign(
      { role, homeRoom: HOME, targetRoom: null },
      memory || {},
    ),
  };
}

/** Регистрирует крипов в Game.creeps — по нему ищет уходящего activePairs. */
function register(creeps) {
  global.Game.creeps = {};
  for (let i = 0; i < creeps.length; i++) {
    global.Game.creeps[creeps[i].name] = creeps[i];
  }
  return creeps;
}

/** Число крипов с каждой комнатой: {комната: количество}. */
function byRoom(creeps) {
  const out = {};
  for (let i = 0; i < creeps.length; i++) {
    const room = creeps[i].memory.targetRoom;
    const key = room === null ? "null" : room;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

console.log("1. Порог пре-спавна = спавн + маршрут + запас");
/**
 * Маршруты (тиков) от спавна E35S37 до рабочей цели — замер по живому террейну
 * shard3 из рабочей реализации (REMOTE_ROUTE_TICKS). Держим их фикстурой:
 * числа в constants.js посчитаны из них, и тест сверяет равенство, а не
 * переписывает константу.
 */
const ROUTE_TICKS = { reserver: 88, remoteMiner: 82, remoteHauler: 82 };

function bodyParts(body) {
  let n = 0;
  for (const part in body) n += body[part];
  return n;
}

function bodyPrice(body) {
  let sum = 0;
  for (const part in body) sum += body[part] * global.BODYPART_COST[part];
  return sum;
}

for (const role of ["reserver", "remoteMiner", "remoteHauler"]) {
  const body = CREEP_BODIES[role];
  const parts = bodyParts(body);
  // 3 тика на часть тела — SPAWN_CREEP_TIME.
  const expected = parts * 3 + ROUTE_TICKS[role] + REMOTE.HANDOFF_SAFETY_MARGIN;
  check(
    `${role}: порог ${PRESPAWN_THRESHOLD[role]} = ${parts * 3} + ${ROUTE_TICKS[role]} + ${REMOTE.HANDOFF_SAFETY_MARGIN}`,
    PRESPAWN_THRESHOLD[role] === expected,
    `ожидалось ${expected}`,
  );
  check(`${role}: тело стоит 1400`, bodyPrice(body) === 1400, String(bodyPrice(body)));
}

check("reserver: 6 частей", bodyParts(CREEP_BODIES.reserver) === 6);
check("remoteMiner: 18 частей", bodyParts(CREEP_BODIES.remoteMiner) === 18);
check("remoteHauler: 28 частей", bodyParts(CREEP_BODIES.remoteHauler) === 28);
check(
  "квоты 2/2/4 в порядке for...in",
  SPAWN_QUOTA.reserver === 2 &&
    SPAWN_QUOTA.remoteMiner === 2 &&
    SPAWN_QUOTA.remoteHauler === 4,
  `${SPAWN_QUOTA.reserver}/${SPAWN_QUOTA.remoteMiner}/${SPAWN_QUOTA.remoteHauler}`,
);
check(
  "дальние роли стоят перед attacker",
  Object.keys(SPAWN_QUOTA).indexOf("remoteHauler") <
    Object.keys(SPAWN_QUOTA).indexOf("attacker"),
);
check(
  "дальние роли стоят после mineralMiner",
  Object.keys(SPAWN_QUOTA).indexOf("reserver") >
    Object.keys(SPAWN_QUOTA).indexOf("mineralMiner"),
);
check("isRemoteRole знает все три роли", isRemoteRole("reserver") && isRemoteRole("remoteMiner") && isRemoteRole("remoteHauler"));
check("isRemoteRole не считает дальним miner", !isRemoteRole("miner"));

console.log("\n2. Два майнера — по одной комнате");
{
  const a = mk("miner_1", "remoteMiner", 1200);
  const b = mk("miner_2", "remoteMiner", 1200);
  const creeps = register([a, b]);
  remoteManager.assignTargetRoom("remoteMiner", creeps);
  check(`оба получили комнату`, a.memory.targetRoom && b.memory.targetRoom, JSON.stringify(byRoom(creeps)));
  check("комнаты разные", a.memory.targetRoom !== b.memory.targetRoom, `${a.memory.targetRoom}/${b.memory.targetRoom}`);
  check("обе из REMOTE.ROOMS", REMOTE.ROOMS.indexOf(a.memory.targetRoom) !== -1 && REMOTE.ROOMS.indexOf(b.memory.targetRoom) !== -1);
}

console.log("\n3. Четыре хаулера — 2 + 2");
{
  const creeps = [];
  for (let i = 1; i <= 4; i++) creeps.push(mk("hauler_" + i, "remoteHauler", 1200));
  register(creeps);
  remoteManager.assignTargetRoom("remoteHauler", creeps);
  const dist = byRoom(creeps);
  check(`в первой комнате 2`, dist[ROOM_A] === 2, JSON.stringify(dist));
  check(`во второй комнате 2`, dist[ROOM_B] === 2, JSON.stringify(dist));
  check("без null", dist.null === undefined, JSON.stringify(dist));
}

console.log("\n4. Три майнера — один ждёт");
{
  const creeps = [];
  for (let i = 1; i <= 3; i++) creeps.push(mk("m3_" + i, "remoteMiner", 1200));
  register(creeps);
  remoteManager.assignTargetRoom("remoteMiner", creeps);
  const dist = byRoom(creeps);
  check("один targetRoom = null", dist.null === 1, JSON.stringify(dist));
  check("по одному в каждой комнате", dist[ROOM_A] === 1 && dist[ROOM_B] === 1, JSON.stringify(dist));
}

console.log("\n5. Невалидная комната сбрасывается");
{
  const a = mk("bad_1", "remoteMiner", 1200, { targetRoom: "E99S99" });
  const b = mk("bad_2", "remoteMiner", 1200);
  const creeps = register([a, b]);
  remoteManager.assignTargetRoom("remoteMiner", creeps);
  check("старая комната не осталась", a.memory.targetRoom !== "E99S99", String(a.memory.targetRoom));
  const dist = byRoom(creeps);
  check("вакантная комната досталась ей", dist[ROOM_A] === 1 && dist[ROOM_B] === 1, JSON.stringify(dist));

  // Список комнат пуст (контур выключен) — все остаются без комнаты, деления на
  // ноль и Infinity в слотах быть не должно.
  const saved = REMOTE.ROOMS;
  REMOTE.ROOMS = [];
  const c = mk("bad_3", "remoteMiner", 1200, { targetRoom: ROOM_A });
  remoteManager.assignTargetRoom("remoteMiner", [c]);
  REMOTE.ROOMS = saved;
  check("пустой список комнат — targetRoom = null", c.memory.targetRoom === null, String(c.memory.targetRoom));
}

console.log("\n6. Handoff-пара наследует комнату и занимает один слот");
{
  // Уходящий в окне пре-спавна (ttl 100 при пороге 166), замена уже в игре.
  const leaving = mk("hm_1", "remoteMiner", 100, {
    targetRoom: ROOM_A,
    handoffTo: "hm_2",
    handoffAt: global.Game.time,
  });
  const successor = mk("hm_2", "remoteMiner", 1500, {
    targetRoom: null,
    handoffFrom: "hm_1",
    handoffAt: global.Game.time,
  });
  // Вторая комната занята обычным майнером.
  const other = mk("hm_3", "remoteMiner", 1200, { targetRoom: ROOM_B });
  const creeps = register([leaving, successor, other]);
  remoteManager.assignTargetRoom("remoteMiner", creeps);

  check(
    "замена унаследовала комнату уходящего",
    successor.memory.targetRoom === ROOM_A,
    String(successor.memory.targetRoom),
  );
  check("уходящий остался на своей комнате", leaving.memory.targetRoom === ROOM_A);
  check("пара не заняла вторую комнату", other.memory.targetRoom === ROOM_B, String(other.memory.targetRoom));
  check("дубля нет: пары считается за один слот", byRoom(creeps)[ROOM_A] === 2 && byRoom(creeps)[ROOM_B] === 1, JSON.stringify(byRoom(creeps)));
}

console.log("\n7. Без handoff дубль вытесняется");
{
  // Двое на первой комнате без связки. Право держать комнату — у того, кому
  // раньше умирать (после его смерти комната всё равно освободится).
  const a = mk("d_1", "remoteMiner", 1200, { targetRoom: ROOM_A });
  const b = mk("d_2", "remoteMiner", 700, { targetRoom: ROOM_A });
  const c = mk("d_3", "remoteMiner", 1100, { targetRoom: ROOM_B });
  const creeps = register([a, b, c]);
  remoteManager.assignTargetRoom("remoteMiner", creeps);

  check("комнату держит тот, кому раньше умирать", b.memory.targetRoom === ROOM_A, String(b.memory.targetRoom));
  check("дубль освобождён", a.memory.targetRoom === null, String(a.memory.targetRoom));
  check("вторая комната не тронута", c.memory.targetRoom === ROOM_B, String(c.memory.targetRoom));
  check(`по одному хозяину на комнату`, byRoom(creeps)[ROOM_A] === 1 && byRoom(creeps)[ROOM_B] === 1, JSON.stringify(byRoom(creeps)));
}

console.log("\n8. Битая связка: замена распределяется как обычный крип");
{
  // Предшественник уже умер — handoffFrom указывает в пустоту.
  const successor = mk("broken_1", "remoteMiner", 1500, {
    targetRoom: null,
    handoffFrom: "dead_creep",
  });
  const other = mk("broken_2", "remoteMiner", 1200, { targetRoom: ROOM_B });
  const creeps = register([successor, other]);
  remoteManager.assignTargetRoom("remoteMiner", creeps);

  check("handoffFrom снят", successor.memory.handoffFrom === undefined, String(successor.memory.handoffFrom));
  check("комната выдана как обычному крипу", successor.memory.targetRoom === ROOM_A, String(successor.memory.targetRoom));
}

console.log("\n9. Висячая связка снимается по таймауту");
{
  // handoffTo указывает на имя, которого нет в игре, и поставлен давно.
  const leaving = mk("stale_1", "remoteMiner", 1200, {
    targetRoom: ROOM_A,
    handoffTo: "never_born",
    handoffAt: global.Game.time - PRESPAWN_THRESHOLD.remoteMiner * 2 - 1,
  });
  const creeps = register([leaving]);
  remoteManager.assignTargetRoom("remoteMiner", creeps);

  check("висячая связка удалена", leaving.memory.handoffTo === undefined, String(leaving.memory.handoffTo));
  check("и тик связки тоже", leaving.memory.handoffAt === undefined, String(leaving.memory.handoffAt));

  // Свежая связка на спавнящуюся замену НЕ снимается: спавн ещё идёт.
  const fresh = mk("stale_2", "remoteMiner", 1200, {
    targetRoom: ROOM_A,
    handoffTo: "spawning_now",
    handoffAt: global.Game.time,
  });
  register([fresh]);
  remoteManager.assignTargetRoom("remoteMiner", [fresh]);
  check("свежая связка сохранена", fresh.memory.handoffTo === "spawning_now", String(fresh.memory.handoffTo));
}

console.log("\n10. run(): один проход по Game.creeps, три роли");
{
  const r = mk("run_res", "reserver", 600);
  const m = mk("run_min", "remoteMiner", 1200);
  const h = mk("run_hau", "remoteHauler", 1200);
  const w = mk("run_worker", "worker", 1200, { targetRoom: null });
  register([r, m, h, w]);
  remoteManager.run();
  check("резерверу выдана комната", r.memory.targetRoom !== null, String(r.memory.targetRoom));
  check("майнеру выдана комната", m.memory.targetRoom !== null, String(m.memory.targetRoom));
  check("хаулеру выдана комната", h.memory.targetRoom !== null, String(h.memory.targetRoom));
  check("чужая роль не тронута", w.memory.targetRoom === null, String(w.memory.targetRoom));
}

console.log("\n11-13. Спавн дальних ролей (гейт, handoffFrom, защита от третьего)");
{
  /**
   * Полный состав флота, КРОМЕ перечисленных ролей: так цикл spawn.manager
   * доходит до дальних ролей, а не упирается в домашние. mineralMiner держим
   * заблокированным (amount 0) — иначе он заберёт единственный спавн.
   */
  function fleetExcept(skip) {
    const out = [];
    for (const role in SPAWN_QUOTA) {
      if (skip[role]) continue;
      for (let i = 0; i < SPAWN_QUOTA[role]; i++) {
        out.push(mk(role + "_x" + i, role, 1200, { homeRoom: HOME }));
      }
    }
    return out;
  }

  function makeSpawn() {
    const calls = [];
    const spawn = {
      spawning: null,
      room: {
        name: HOME,
        energyAvailable: 6000,
        energyCapacityAvailable: 6000,
      },
      spawnCreep(body, name, opts) {
        calls.push({ body: body, name: name, memory: opts && opts.memory });
        return global.OK;
      },
    };
    return { spawn: spawn, calls: calls };
  }

  function makeState(creeps, spawn) {
    return {
      roomName: HOME,
      room: spawn.room,
      spawns: [spawn],
      creeps: creeps,
      mineral: { id: "min1", extractorId: "ex1", amount: 0 },
    };
  }

  const REMOTE_SKIP = { reserver: true, remoteMiner: true, remoteHauler: true };

  // 11. Вне домашней комнаты дальние роли не спавнятся ни при каком недоборе.
  Memory.rooms = { E36S38: { minerSpots: [{ x: 10, y: 10 }] } };
  {
    const s = makeSpawn();
    s.spawn.room.name = "E36S38";
    // Именно БЕЗ дальних ролей: иначе их квота была бы набрана фикстурой, и
    // тест не проверял бы гейт «дальние роли только в HOME» (ложная зелень).
    const state = makeState(fleetExcept(REMOTE_SKIP), s.spawn);
    state.roomName = "E36S38";
    delete global.__spawnGate;
    spawnManager.run(state);
    const remoteSpawns = s.calls.filter(c => isRemoteRole(c.memory.role));
    check("вне HOME дальних ролей не спавнят", remoteSpawns.length === 0, JSON.stringify(s.calls.map(c => c.memory.role)));
  }

  // 12. В домашней комнате замена получает handoffFrom, уходящий — handoffTo.
  Memory.rooms = { E35S37: { minerSpots: [{ x: 10, y: 10 }] } };
  {
    const s = makeSpawn();
    const leaving = mk("leave_1", "reserver", 100, { homeRoom: HOME });
    const fleet = fleetExcept(REMOTE_SKIP);
    fleet.push(leaving);
    const state = makeState(fleet, s.spawn);
    delete global.__spawnGate;
    spawnManager.run(state);

    const spawned = s.calls[0];
    check("заспавнен резервер", spawned && spawned.memory.role === "reserver", spawned && spawned.memory.role);
    check(
      "handoffFrom = имя уходящего",
      spawned && spawned.memory.handoffFrom === "leave_1",
      spawned && String(spawned.memory.handoffFrom),
    );
    check(
      "handoffAt = Game.time",
      spawned && spawned.memory.handoffAt === global.Game.time,
      spawned && String(spawned.memory.handoffAt),
    );
    check(
      "уходящему записан handoffTo тем же именем",
      leaving.memory.handoffTo === spawned.name,
      `${leaving.memory.handoffTo} против ${spawned.name}`,
    );
    check("homeRoom в памяти замены", spawned.memory.homeRoom === HOME, spawned.memory.homeRoom);
    check("targetRoom = null до раздачи", spawned.memory.targetRoom === null, String(spawned.memory.targetRoom));
  }

  // 13. Пара «уходящий + спавнящаяся замена» занимает слот: третьего не ставят.
  {
    const s = makeSpawn();
    const leaving = mk("pair_leave", "reserver", 100, {
      homeRoom: HOME,
      handoffTo: "pair_succ",
      handoffAt: global.Game.time,
    });
    const successor = mk("pair_succ", "reserver", undefined, {
      homeRoom: HOME,
      handoffFrom: "pair_leave",
    });
    const fleet = fleetExcept(REMOTE_SKIP);
    fleet.push(leaving, successor);
    register([leaving, successor]);
    const state = makeState(fleet, s.spawn);
    delete global.__spawnGate;
    spawnManager.run(state);

    const reservers = s.calls.filter(c => c.memory.role === "reserver");
    check("третий резервер не заспавнен", reservers.length === 0, JSON.stringify(s.calls.map(c => c.memory.role)));
  }

  // bindHandoff — прямой вызов (единица поведения, используется в spawn.manager).
  {
    const leaving = mk("bind_1", "remoteMiner", 100);
    bindHandoff(leaving, "successor_name");
    check("bindHandoff пишет имя", leaving.memory.handoffTo === "successor_name");
    check("bindHandoff пишет тик", leaving.memory.handoffAt === global.Game.time, String(leaving.memory.handoffAt));
    const nothing = {};
    bindHandoff(nothing, "x");
    check("без memory связка не пишется", nothing.memory === undefined);
  }
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
