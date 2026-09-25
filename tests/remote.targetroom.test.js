"use strict";
/**
 * ===================================================
 * REMOTE.TARGETROOM.TEST.JS — назначение targetRoom дальним ролям
 * ===================================================
 * Инцидент на живом shard3 (19.09.2026): в E35S38 не осталось ни одного
 * remoteHauler, оба хайлера работали в E36S37, контейнер E35S38 был полон
 * (2000/2000), майнер простаивал.
 *
 * Причина: pre-spawn ставит замену за 220 тиков ДО смерти предшественника,
 * поэтому в группе временно оказывается 3 крипа при 2 комнатах (квота 2 =
 * число комнат 2). assignTargetRoom() не находил свободной комнаты и оставлял
 * targetRoom пустым, после чего срабатывал хэш-fallback по имени
 * (remote.hauler.js / remote.reserver.js) и выдавал комнату вслепую — оба
 * имени дали индекс 1 → E36S37. Поскольку непустой targetRoom в
 * remote.manager не пересматривался, ошибка закрепилась на всю жизнь крипов.
 *
 * Проверяем:
 *   1) хэш-fallback удалён из hauler и reserver (поведенчески и по исходнику);
 *   2) роль без targetRoom не выбирает комнату сама и не двигается;
 *   3) две комнаты / две штатные роли → по одной комнате на крипа;
 *   4) pre-spawn третьего крипа при занятых комнатах → он ждёт без комнаты;
 *   5) комната освободилась → ожидающий получает именно её;
 *   6) испорченное распределение (двое в одной комнате, вторая свободна)
 *      исправляется автоматически;
 *   7) property-тест: не бывает дубля в комнате, пока другая комната свободна,
 *      назначение идемпотентно (нет churn) и не выходит за REMOTE.ROOMS;
 *   8) remoteMiner не сломан: ждёт так же, а с комнатой — работает;
 *   9) рабочий путь hauler/reserver с назначенной комнатой сохранён.
 *
 * Запуск: node tests/remote.targetroom.test.js
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

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  getRangeTo(t) {
    const p = t && t.pos ? t.pos : t;
    if (!p || p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
}
global.RoomPosition = RoomPosition;

const WORLD = { objects: {} };
global.Game = {
  time: 1000,
  creeps: {},
  getObjectById: id => WORLD.objects[id] || null,
};

global.Memory = { creeps: {}, rooms: {} };

// ── Крипы ────────────────────────────────────────────────────────────────
const HOME = "E35S37";

/**
 * @param {string} name
 * @param {string} role
 * @param {string|null|undefined} targetRoom
 */
function makeCreep(name, role, targetRoom) {
  const creep = {
    name,
    room: { name: HOME },
    pos: new RoomPosition(10, 10, HOME),
    store: {
      energy: 0,
      getFreeCapacity: () => 100,
      getUsedCapacity: () => 0,
      getCapacity: () => 100,
    },
    memory: {
      role,
      homeRoom: HOME,
      // creep.factory создаёт дальние роли именно с targetRoom: null
      targetRoom: targetRoom === undefined ? null : targetRoom,
    },
    spawning: false,
    ticksToLive: 1000,
    travelToCalls: [],
    travelTo(target) {
      this.travelToCalls.push(target);
      return OK;
    },
  };
  return creep;
}

// ── Загрузка проверяемых модулей ─────────────────────────────────────────
const remoteManager = require("../remote.manager");
const roleRemoteHauler = require("../remote.hauler");
const roleRemoteMiner = require("../remote.miner");
const roleReserver = require("../remote.reserver");
const { REMOTE, SPAWN_QUOTA, PRESPAWN_THRESHOLD } = require("../constants");

const HAULER = "remoteHauler";
const MINER = "remoteMiner";
const RESERVER = "reserver";

/**
 * Прогон настоящего remote.manager.run() с заданным составом Game.creeps.
 * Кэш ролей сбрасывается, чтобы менеджер видел ровно переданный состав.
 * @param {Object[]} creeps
 */
function runManager(creeps) {
  Game.time += 1;
  Game.creeps = {};
  for (const c of creeps) Game.creeps[c.name] = c;
  delete global._remoteRoleCache;
  remoteManager.run();
  return creeps;
}

function ofRole(creeps, role) {
  return creeps.filter(c => c.memory.role === role);
}

/** Карта «комната → сколько крипов на неё претендует». */
function claims(creeps, role) {
  const map = {};
  for (const c of ofRole(creeps, role)) {
    const room = c.memory.targetRoom;
    if (room) map[room] = (map[room] || 0) + 1;
  }
  return map;
}

function assigned(creeps, role) {
  return ofRole(creeps, role).filter(c => c.memory.targetRoom);
}

function freeRooms(creeps, role) {
  const used = claims(creeps, role);
  return REMOTE.ROOMS.filter(r => !used[r]);
}

function doubledRooms(creeps, role) {
  const used = claims(creeps, role);
  return REMOTE.ROOMS.filter(r => (used[r] || 0) > 1);
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

// ── 1. Fallback удалён (по исходникам) ───────────────────────────────────
{
  console.log("\n1. Хэш-fallback по имени удалён из дальних ролей");

  for (const file of ["remote.hauler.js", "remote.reserver.js", "remote.miner.js"]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    check(
      `${file}: нет распределения комнаты по хэшу имени`,
      !src.includes("charCodeAt"),
      "найден charCodeAt",
    );
    check(
      `${file}: нет записи creep.memory.targetRoom = REMOTE.ROOMS[...]`,
      !/creep\.memory\.targetRoom\s*=\s*REMOTE\.ROOMS/.test(src),
    );
  }

  const managerSrc = fs.readFileSync(path.join(ROOT, "remote.manager.js"), "utf8");
  // Единственная точка политики: targetRoom пишет ТОЛЬКО remote.manager.
  // Записи по делу: наследование комнаты уходящего заменой и выдача
  // свободной комнаты ожидающему. Сбросы в null (битая память, комната не
  // досталась) — это не назначение комнаты, поэтому не считаем.
  const roomWrites = (managerSrc.match(/memory\.targetRoom\s*=/g) || [])
    .length;
  const managerWithoutComments = managerSrc
    .split("\n")
    .filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
  const nullWrites = (
    managerWithoutComments.match(/memory\.targetRoom\s*=\s*null/g) || []
  ).length;
  check(
    "remote.manager.js: назначает комнату только он (наследование + свободная)",
    roomWrites - nullWrites === 2,
    `всего записей ${roomWrites}, из них сбросов в null ${nullWrites}`,
  );
  check(
    "remote.manager.js: наследует комнату уходящего по связке handoff",
    managerSrc.includes("activePairs") &&
      managerSrc.includes("successor.memory.targetRoom"),
  );
  check(
    "REMOTE.ROOMS сохранён (2 комнаты)",
    REMOTE.ROOMS.length === 2 && REMOTE.ROOMS[0] === "E35S38" && REMOTE.ROOMS[1] === "E36S37",
    JSON.stringify(REMOTE.ROOMS),
  );
  check(
    "квоты дальних ролей: miner/reserver по 2, хаулер — слоты на комнату",
    SPAWN_QUOTA[MINER] === 2 &&
      SPAWN_QUOTA[RESERVER] === 2 &&
      SPAWN_QUOTA[HAULER] === REMOTE.HAULERS_PER_ROOM * REMOTE.ROOMS.length,
  );
  check(
    "pre-spawn сохранён (пороги заданы)",
    PRESPAWN_THRESHOLD[MINER] > 0 &&
      PRESPAWN_THRESHOLD[RESERVER] > 0 &&
      PRESPAWN_THRESHOLD[HAULER] > 0,
  );
}

// ── 2. Роль без targetRoom ничего не делает и НЕ выбирает комнату ────────
{
  console.log("\n2. Крип без targetRoom ждёт (fallback не выбирает комнату)");

  const roles = [
    ["remoteHauler", roleRemoteHauler],
    ["reserver", roleReserver],
    ["remoteMiner", roleRemoteMiner],
  ];
  for (const [role, mod] of roles) {
    for (const initial of [null, undefined]) {
      const creep = makeCreep(`${role}_E35S37_100`, role, initial);
      if (initial === undefined) delete creep.memory.targetRoom;
      mod.run(creep);
      check(
        `${role}: targetRoom не появился сам (было ${String(initial)})`,
        !creep.memory.targetRoom,
        String(creep.memory.targetRoom),
      );
      check(
        `${role}: крип не двигается без комнаты`,
        creep.travelToCalls.length === 0,
        String(creep.travelToCalls.length),
      );
    }
  }
}

// ── 3. Две комнаты, две штатные роли ─────────────────────────────────────
for (const role of [HAULER, RESERVER, MINER]) {
  console.log(`\n3. ${role}: две замены без комнат → по одной комнате каждой`);

  const creeps = runManager([
    makeCreep(`${role}_E35S37_101`, role, null),
    makeCreep(`${role}_E35S37_102`, role, null),
  ]);

  const used = claims(creeps, role);
  check(
    "обе замены получили комнаты",
    assigned(creeps, role).length === 2,
    JSON.stringify(used),
  );
  check(
    "комнаты разные",
    Object.keys(used).length === 2,
    JSON.stringify(used),
  );
  check(
    "назначены ровно REMOTE.ROOMS",
    REMOTE.ROOMS.every(r => used[r] === 1),
    JSON.stringify(used),
  );
}

// ── 4. Pre-spawn: третий крип, свободных комнат нет ──────────────────────
for (const role of [HAULER, RESERVER, MINER]) {
  console.log(`\n4. ${role}: pre-spawn третьего крипа при занятых комнатах`);

  const creeps = runManager([
    makeCreep(`${role}_E35S37_201`, role, REMOTE.ROOMS[0]),
    makeCreep(`${role}_E35S37_202`, role, REMOTE.ROOMS[1]),
    makeCreep(`${role}_E35S37_203`, role, null), // замена, родившаяся до смерти старого
  ]);

  const spare = ofRole(creeps, role)[2];
  const slots = role === HAULER ? REMOTE.HAULERS_PER_ROOM : 1;
  if (slots === 1) {
    check(
      "замена НЕ получила случайную комнату",
      !spare.memory.targetRoom,
      String(spare.memory.targetRoom),
    );
    check(
      "замена не двигается (ждёт освобождения комнаты)",
      spare.travelToCalls.length === 0,
      String(spare.travelToCalls.length),
    );
  } else {
    // У хаулера в комнате два слота: третий крип ЗАКОННО занимает второй слот —
    // именно так на маршруте появляется второй хаулер.
    check(
      "третий хаулер занял второй слот комнаты",
      !!spare.memory.targetRoom,
      String(spare.memory.targetRoom),
    );
  }
  check(
    "штатные крипы сохранили свои комнаты",
    ofRole(creeps, role)[0].memory.targetRoom === REMOTE.ROOMS[0] &&
      ofRole(creeps, role)[1].memory.targetRoom === REMOTE.ROOMS[1],
  );
  check(
    "квота не разрастается: крипов не больше, чем слотов",
    assigned(creeps, role).length <= REMOTE.ROOMS.length * slots,
    String(assigned(creeps, role).length),
  );
}

// ── 5. Комната освободилась → ожидающий получает именно её ───────────────
for (const role of [HAULER, RESERVER, MINER]) {
  console.log(`\n5. ${role}: освободившаяся комната достаётся ожидающему`);

  const first = makeCreep(`${role}_E35S37_301`, role, REMOTE.ROOMS[0]);
  const second = makeCreep(`${role}_E35S37_302`, role, REMOTE.ROOMS[1]);
  const spare = makeCreep(`${role}_E35S37_303`, role, null);

  runManager([first, second, spare]);
  if (role === HAULER) {
    // У хаулера в комнате слотов REMOTE.HAULERS_PER_ROOM (3 крипа на 2 комнаты =
    // 4 слота), поэтому третий ЗАКОННО занимает второй слот, а не ждёт.
    check(
      "третий хаулер занял второй слот комнаты",
      !!spare.memory.targetRoom,
      String(spare.memory.targetRoom),
    );
  } else {
    check("до освобождения замена ждёт", !spare.memory.targetRoom);
  }

  // Первый крип умер — его комната освободилась.
  runManager([second, spare]);
  check(
    `замена получила освободившуюся ${REMOTE.ROOMS[0]}`,
    spare.memory.targetRoom === REMOTE.ROOMS[0],
    String(spare.memory.targetRoom),
  );
  check(
    "вторая комната осталась за своим крипом",
    second.memory.targetRoom === REMOTE.ROOMS[1],
    String(second.memory.targetRoom),
  );
  check(
    "после назначения замена начала работать",
    spare.travelToCalls.length > 0,
    String(spare.travelToCalls.length),
  );
}

// ── 6. Испорченное распределение исправляется ────────────────────────────
for (const role of [HAULER, RESERVER, MINER]) {
  console.log(`\n6. ${role}: двое в одной комнате при свободной второй — лечится`);

  // Ровно живая ситуация с shard3: оба крипа закреплены за E36S37,
  // E35S38 пуста.
  const a = makeCreep(`${role}_E35S37_401`, role, REMOTE.ROOMS[1]);
  const b = makeCreep(`${role}_E35S37_402`, role, REMOTE.ROOMS[1]);
  const pair = [a, b];
  runManager(pair);

  const used = claims(pair, role);
  check(
    "дубль устранён",
    doubledRooms(pair, role).length === 0,
    JSON.stringify(used),
  );
  check(
    "обе комнаты покрыты",
    REMOTE.ROOMS.every(r => used[r] === 1),
    JSON.stringify(used),
  );
  check(
    "один крип остался в исходной комнате",
    a.memory.targetRoom === REMOTE.ROOMS[1] || b.memory.targetRoom === REMOTE.ROOMS[1],
  );
}

// ── 7. Property-тест инварианта назначения ───────────────────────────────
{
  console.log("\n7. Инвариант: дубль невозможен, пока есть свободная комната");

  const VARIANTS = [null, undefined, REMOTE.ROOMS[0], REMOTE.ROOMS[1]];
  let states = 0;
  let badCoverage = 0;
  let badRoom = 0;
  let churn = 0;

  for (const role of [HAULER, RESERVER, MINER]) {
    for (let n = 0; n <= 3; n++) {
      const combos = Math.pow(VARIANTS.length, n);
      for (let k = 0; k < combos; k++) {
        let rest = k;
        const creeps = [];
        for (let i = 0; i < n; i++) {
          const variant = VARIANTS[rest % VARIANTS.length];
          rest = Math.floor(rest / VARIANTS.length);
          const c = makeCreep(`${role}_E35S37_5${i}_${k}`, role, variant);
          if (variant === undefined) delete c.memory.targetRoom;
          creeps.push(c);
        }

        runManager(creeps);
        states++;

        // (a) покрытие: если комната задвоена, свободных комнат быть не должно
        if (doubledRooms(creeps, role).length > 0 && freeRooms(creeps, role).length > 0) {
          badCoverage++;
        }
        // (b) назначены только комнаты из REMOTE.ROOMS
        for (const c of ofRole(creeps, role)) {
          if (c.memory.targetRoom && REMOTE.ROOMS.indexOf(c.memory.targetRoom) === -1) {
            badRoom++;
          }
        }
        // (c) идемпотентность: повторный прогон ничего не меняет (нет churn)
        const snapshot = ofRole(creeps, role).map(c => c.memory.targetRoom);
        runManager(creeps);
        const after = ofRole(creeps, role).map(c => c.memory.targetRoom);
        if (snapshot.join("|") !== after.join("|")) churn++;
      }
    }
  }

  check(`перебрано состояний: ${states}`, states === 3 * (1 + 4 + 16 + 64));
  check("нет дубля при свободной комнате", badCoverage === 0, String(badCoverage));
  check("назначаются только комнаты REMOTE.ROOMS", badRoom === 0, String(badRoom));
  check("назначение идемпотентно (нет churn)", churn === 0, String(churn));
}

// ── 8. Рабочий путь ролей сохранён ───────────────────────────────────────
{
  console.log("\n8. С назначенной комнатой роли работают как раньше");

  const hauler = makeCreep("remoteHauler_E35S37_601", HAULER, REMOTE.ROOMS[0]);
  WORLD.objects["cont1"] = {
    id: "cont1",
    structureType: STRUCTURE_CONTAINER,
    room: { name: REMOTE.ROOMS[0] },
    pos: new RoomPosition(37, 32, REMOTE.ROOMS[0]),
    store: { energy: 500 },
  };
  hauler.memory.containerId = "cont1";
  roleRemoteHauler.run(hauler);
  check(
    "remoteHauler с комнатой двигается к известной цели",
    hauler.travelToCalls.length === 1,
    String(hauler.travelToCalls.length),
  );

  const miner = makeCreep("remoteMiner_E35S37_602", MINER, REMOTE.ROOMS[0]);
  roleRemoteMiner.run(miner);
  check(
    "remoteMiner с комнатой двигается в целевую комнату",
    miner.travelToCalls.length === 1,
    String(miner.travelToCalls.length),
  );
  check(
    "remoteMiner не потерял targetRoom",
    miner.memory.targetRoom === REMOTE.ROOMS[0],
    String(miner.memory.targetRoom),
  );

  const reserver = makeCreep("reserver_E35S37_603", RESERVER, REMOTE.ROOMS[1]);
  roleReserver.run(reserver);
  check(
    "reserver с комнатой двигается к контроллеру",
    reserver.travelToCalls.length === 1,
    String(reserver.travelToCalls.length),
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
