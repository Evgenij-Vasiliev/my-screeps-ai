"use strict";
/**
 * ===================================================
 * SHARD.STATE.TEST.JS — состояние шарда в Memory (аудит п. 10 / задача 12)
 * ===================================================
 * Контракт shard.state.js:
 *   1) без Memory.empire все аксессоры отдают ТЕКУЩИЕ значения constants
 *      (REMOTE / EMPIRE) — первый деплой поведения не меняет;
 *   2) ensure() заводит Memory.empire с этими значениями, КОПИРУЯ их (правка
 *      Memory не мутирует конфиг) и НЕ перезаписывая правки владельца;
 *   3) значения из Memory.empire имеют приоритет над constants;
 *   4) битые типы в Memory не роняют аксессоры, а откатываются на default;
 *   5) порог пре-спавна дальних ролей считается от НАСТРОЕННЫХ комнат и
 *      маршрутов, а отсутствие маршрута даёт один явный лог (warnOnce).
 *
 * Запуск: node tests/shard.state.test.js
 */

// Глобалы движка, нужные constants/* при загрузке.
global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.OK = 0;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.Game = { time: 1, rooms: {} };
global.Memory = {};

const shardState = require("../shard.state");
const { REMOTE, EMPIRE, PRESPAWN_THRESHOLD } = require("../constants");

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
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── 0. Захват console.log (warnOnce) ─────────────────────────────────────
const realLog = console.log;
const captured = [];
function captureLogs() {
  captured.length = 0;
  console.log = (...args) => captured.push(args.join(" "));
}
function releaseLogs() {
  console.log = realLog;
}

// ── 1. Defaults без Memory.empire ────────────────────────────────────────
console.log("\n1. Без Memory.empire аксессоры отдают текущие значения constants");
check("homeRoom = REMOTE.HOME_ROOM", shardState.homeRoom() === REMOTE.HOME_ROOM);
check(
  "remoteRooms = REMOTE.ROOMS",
  shardState.remoteRooms() === REMOTE.ROOMS,
);
check(
  "remoteLink(E35S38) = REMOTE.ROOM_TO_LINK.E35S38",
  shardState.remoteLink("E35S38") === REMOTE.ROOM_TO_LINK.E35S38,
);
check(
  "remoteLink неизвестной комнаты = null",
  shardState.remoteLink("E99S99") === null,
);
check(
  "remoteContainerPos(E35S38) = REMOTE.ROOM_TO_CONTAINER_POS.E35S38",
  deepEqual(
    shardState.remoteContainerPos("E35S38"),
    REMOTE.ROOM_TO_CONTAINER_POS.E35S38,
  ),
);
check(
  "observerScanRooms = EMPIRE.OBSERVER_SCAN_ROOMS",
  shardState.observerScanRooms() === EMPIRE.OBSERVER_SCAN_ROOMS,
);
check(
  "highRiskRooms = EMPIRE.HIGH_RISK_ROOMS",
  shardState.highRiskRooms() === EMPIRE.HIGH_RISK_ROOMS,
);
check(
  "remoteScanRooms = EMPIRE.REMOTE_SCAN_ROOMS",
  shardState.remoteScanRooms() === EMPIRE.REMOTE_SCAN_ROOMS,
);
check(
  "rally = EMPIRE.RALLY",
  deepEqual(shardState.rally(), EMPIRE.RALLY),
);

// ── 2. ensure(): копия дефолтов, а не ссылка ─────────────────────────────
console.log("\n2. ensure() заполняет Memory.empire копиями текущих значений");
global.Memory = {};
shardState.ensure();
const stateObj = global.Memory.empire;
check("Memory.empire создан", !!stateObj && typeof stateObj === "object");
check("version = STATE_VERSION", stateObj.version === shardState.STATE_VERSION);
check(
  "homeRoom/remoteRooms/remoteLinks/… заполнены",
  stateObj.homeRoom === REMOTE.HOME_ROOM &&
    deepEqual(stateObj.remoteRooms, REMOTE.ROOMS) &&
    deepEqual(stateObj.remoteLinks, REMOTE.ROOM_TO_LINK) &&
    deepEqual(stateObj.remoteContainerPos, REMOTE.ROOM_TO_CONTAINER_POS) &&
    deepEqual(stateObj.remoteRouteTicks, require("../constants/creeps").REMOTE_ROUTE_TICKS) &&
    deepEqual(stateObj.observerScanRooms, EMPIRE.OBSERVER_SCAN_ROOMS) &&
    deepEqual(stateObj.highRiskRooms, EMPIRE.HIGH_RISK_ROOMS) &&
    deepEqual(stateObj.remoteScanRooms, EMPIRE.REMOTE_SCAN_ROOMS) &&
    deepEqual(stateObj.rally, EMPIRE.RALLY),
);
// Правка Memory НЕ должна мутировать конфиг (иначе default «портится»).
stateObj.remoteRooms.push("E99S99");
stateObj.remoteLinks.E99S99 = "deadbeef";
check(
  "правка Memory.empire не мутирует constants.REMOTE",
  REMOTE.ROOMS.indexOf("E99S99") === -1 &&
    REMOTE.ROOM_TO_LINK.E99S99 === undefined,
);

// ── 3. Приоритет Memory над constants ────────────────────────────────────
console.log("\n3. Значения Memory.empire имеют приоритет над constants");
global.Memory = {
  empire: {
    remoteRooms: ["E99S99"],
    remoteLinks: { E99S99: "aaaabbbbccccddddeeeeffff" },
    remoteContainerPos: { E99S99: { x: 7, y: 8 } },
    observerScanRooms: ["E98S98"],
    highRiskRooms: ["E97S97"],
    remoteScanRooms: ["E96S96"],
    rally: { room: "E99S99", x: 1, y: 2 },
  },
};
check(
  "remoteRooms из Memory",
  deepEqual(shardState.remoteRooms(), ["E99S99"]),
);
check(
  "remoteLink из Memory",
  shardState.remoteLink("E99S99") === "aaaabbbbccccddddeeeeffff",
);
check(
  "remoteContainerPos из Memory",
  deepEqual(shardState.remoteContainerPos("E99S99"), { x: 7, y: 8 }),
);
check(
  "observerScanRooms из Memory",
  deepEqual(shardState.observerScanRooms(), ["E98S98"]),
);
check(
  "highRiskRooms из Memory",
  deepEqual(shardState.highRiskRooms(), ["E97S97"]),
);
check(
  "remoteScanRooms из Memory",
  deepEqual(shardState.remoteScanRooms(), ["E96S96"]),
);
check(
  "rally из Memory",
  deepEqual(shardState.rally(), { room: "E99S99", x: 1, y: 2 }),
);
// Пустой список комнат — легальное «выключить дальний контур».
global.Memory.empire.remoteRooms = [];
check(
  "пустой remoteRooms разрешён (не подменяется default)",
  deepEqual(shardState.remoteRooms(), []),
);

// ── 4. Битые типы — откат на default ─────────────────────────────────────
console.log("\n4. Битые значения в Memory не роняют аксессоры");
global.Memory = {
  empire: {
    homeRoom: 42,
    remoteRooms: "не массив",
    remoteLinks: null,
    remoteContainerPos: "нет",
    remoteRouteTicks: 0,
    observerScanRooms: {},
    highRiskRooms: "нет",
    remoteScanRooms: null,
    rally: { x: 1 },
  },
};
check("homeRoom битый → default", shardState.homeRoom() === REMOTE.HOME_ROOM);
check(
  "remoteRooms битый → default",
  shardState.remoteRooms() === REMOTE.ROOMS,
);
check(
  "remoteLink битый → default",
  shardState.remoteLink("E35S38") === REMOTE.ROOM_TO_LINK.E35S38,
);
check(
  "observerScanRooms битый → default",
  shardState.observerScanRooms() === EMPIRE.OBSERVER_SCAN_ROOMS,
);
check(
  "rally без комнаты → default",
  deepEqual(shardState.rally(), EMPIRE.RALLY),
);

// ── 5. ensure() не перезаписывает правки владельца ───────────────────────
console.log("\n5. ensure() идемпотентна и не затирает правки владельца");
global.Memory = { empire: { homeRoom: "W1N1", remoteRooms: ["W2N2"] } };
shardState.ensure();
check(
  "homeRoom владельца сохранён",
  global.Memory.empire.homeRoom === "W1N1",
);
check(
  "remoteRooms владельца сохранён",
  deepEqual(global.Memory.empire.remoteRooms, ["W2N2"]),
);
check(
  "остальные ключи дозаполнены",
  deepEqual(global.Memory.empire.observerScanRooms, EMPIRE.OBSERVER_SCAN_ROOMS),
);
shardState.ensure();
shardState.ensure();
check(
  "повторный ensure() не создаёт дублей/не портит список",
  deepEqual(global.Memory.empire.remoteRooms, ["W2N2"]),
);

// ── 6. Порог пре-спавна считается от настроенных комнат/маршрутов ─────────
console.log("\n6. preSpawnThreshold зависит от Memory, а не только от constants");
global.Memory = {};
check(
  "default remoteMiner = constants.PRESPAWN_THRESHOLD",
  shardState.preSpawnThreshold("remoteMiner") ===
    PRESPAWN_THRESHOLD.remoteMiner,
);
check(
  "default reserver = constants.PRESPAWN_THRESHOLD",
  shardState.preSpawnThreshold("reserver") === PRESPAWN_THRESHOLD.reserver,
);
check(
  "default remoteHauler = constants.PRESPAWN_THRESHOLD",
  shardState.preSpawnThreshold("remoteHauler") ===
    PRESPAWN_THRESHOLD.remoteHauler,
);
check(
  "не дальняя роль: worker — плоская константа",
  shardState.preSpawnThreshold("worker") === PRESPAWN_THRESHOLD.worker,
);
const creeps = require("../constants/creeps");
const baseRoutes = creeps.REMOTE_ROUTE_TICKS;
const minerSpawn = 54; // 10+2+6 частей × 3 тика
shardState.ensure();
global.Memory.empire.remoteRouteTicks.remoteMiner.E35S38 = 200;
check(
  "маршрут из Memory поднял порог (54 + 200 + 30)",
  shardState.preSpawnThreshold("remoteMiner") === minerSpawn + 200 + 30,
  String(shardState.preSpawnThreshold("remoteMiner")),
);
global.Memory.empire.remoteRooms = ["E36S37", "E35S38"];
global.Memory.empire.remoteRouteTicks.remoteMiner.E36S37 = 400;
check(
  "берётся МАКСИМУМ по настроенным комнатам",
  shardState.preSpawnThreshold("remoteMiner") === minerSpawn + 400 + 30,
  String(shardState.preSpawnThreshold("remoteMiner")),
);
check(
  "default-таблица маршрутов не мутирована",
  baseRoutes.remoteMiner.E35S38 === 82,
);

// ── 7. warnOnce: отсутствующий маршрут — один явный лог ──────────────────
console.log("\n7. warnOnce печатает один раз на ключ");
global.Memory = { empire: { remoteRooms: ["E77S77"], remoteRouteTicks: {} } };
delete global._shardStateWarned;
captureLogs();
shardState.preSpawnThreshold("remoteMiner");
shardState.preSpawnThreshold("remoteMiner");
releaseLogs();
check(
  "отсутствующий маршрут залогирован ровно один раз",
  captured.length === 1 && captured[0].includes("нет маршрута"),
  JSON.stringify(captured),
);
captureLogs();
shardState.warnOnce("k", "первое");
shardState.warnOnce("k", "второе");
releaseLogs();
check(
  "warnOnce: второй вызов с тем же ключом молчит",
  captured.length === 1 && captured[0] === "первое",
  JSON.stringify(captured),
);

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
