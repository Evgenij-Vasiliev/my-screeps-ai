"use strict";
/**
 * ===================================================
 * BOOST.ENERGY.TEST.JS — регресс живой аварии 02.10.2026
 * ===================================================
 * ЧТО БЫЛО (shard3, E37S37/E37S38). В буст-лабах лежал буст-минерал (XKH2O 330
 * и 480), но energy = 10. Буст одной части стоит ПАРУ «30 минерала + 20 энергии»
 * (BOOST_PER_PART / BOOST_ENERGY_PER_PART, движковые LAB_BOOST_MINERAL и
 * LAB_BOOST_ENERGY), причём энергия списывается ИЗ ЛАБЫ. Итог: lab.boostCreep
 * возвращал ERR_NOT_ENOUGH_RESOURCES (= ERR_NOT_ENOUGH_ENERGY, -6) при 0
 * оплаченных частях, ветка этого кода в boost.manager считала код признаком
 * «часть частей уже выдана», стирала память процедуры и возвращала true —
 * то есть роль крипа не вызывалась вовсе (room.manager.js: `if (boosting)
 * return;`). Следующий тик повторял то же самое, потому что boostWait на этом
 * пути не ставился: linkWorker не разгружал линк (799/800 стояли минутами),
 * worker не доливал спавны, labWorker не доливал энергию в саму буст-лабу —
 * цикл не мог разомкнуться сам.
 *
 * ЧТО ПРОВЕРЯЕТСЯ (boost.manager.runBoost, гейт «лаба не оплатит ни одной части»):
 *   1) лаба с минералом и energy < 20 → роль НЕ подавлена (run вернул false),
 *      lab.boostCreep не вызван, есть троттлинг boostWait;
 *   2) граница: energy ровно 20 (одна часть) → буст идёт как раньше;
 *   3) крипа НЕ подзывают к лабе, которая не платит (moveTo не вызывается);
 *   4) троттлинг: повторный вызов внутри RETRY_INTERVAL не трогает лабу вовсе;
 *   5) контроль: лаба с энергией бустит, run возвращает true (роль подавлена
 *      законно — выдача состоялась);
 *   6) метрика: отказ виден в Memory.__boostMetric («нет оплаты части …»).
 *
 * Запуск: node tests/boost.energy.test.js
 * ===================================================
 */

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_FULL = -8;
global.ERR_TIRED = -11;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";

// Движковая BOOSTS нужна resourceToPart(): «ресурс буста → тип части тела».
// Ключ work ОДИН: дубликат ключа в литерале затирается последним (так и было —
// UO пропадал, resourceToPart не находил ресурс, partsOfType возвращал 0, и
// политика miner считалась полностью закрытой).
global.BOOSTS = {
  work: {
    UO: { harvest: 3 },
    XUHO2: { harvest: 5 },
  },
  move: { XZHO2: { fatigue: 3 } },
};

let NOW = 83372500;
global.Game = {
  get time() {
    return NOW;
  },
  getObjectById: () => null,
};
global.Memory = {};

const mod = require("../boost.manager");
const { LAB_BOOST } = require("../constants");

/* ── Store как в игре: ресурсы — перечисляемые ключи, методы — нет ────── */
function storeUsed(t) {
  let used = 0;
  for (const k of Object.keys(t)) used += t[k];
  return used;
}
function Store(capacity, contents) {
  const target = {};
  for (const k of Object.keys(contents || {})) target[k] = contents[k];
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "getFreeCapacity") return () => capacity - storeUsed(t);
      if (prop === "getUsedCapacity") return r => (r ? t[r] || 0 : storeUsed(t));
      if (prop === "getCapacity") return () => capacity;
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
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  isNearTo(t) {
    return this.getRangeTo(t) <= 1;
  }
}

/* ── Стенд: буст-лаба, крип-линкер, roomState ─────────────────────────── */
// Лаба фикстуры = UO-буст-лаба комнаты из конфигурации: selectBoost ищет лабу
// по ресурсу строки политики (miner -> UO), поэтому id должен совпадать.
const LAB_ID = LAB_BOOST.BOOST_LAB.E37S38.UO;
let boostCreepCalls = [];
let moveToCalls = [];
let dropCalls = [];

function makeLab(mineral, energy) {
  return {
    id: LAB_ID,
    structureType: "lab",
    pos: new RoomPosition(13, 14, "E37S38"),
    mineralType: mineral ? "UO" : null,
    store: Store(3000, Object.assign({ energy }, mineral ? { UO: mineral } : {})),
    boostCreep(creep, n) {
      boostCreepCalls.push({ name: creep.name, n });
      return global.OK;
    },
  };
}

/** Крип-майнер: политика miner (UO, parts 12), бустов на теле нет. */
function makeCreep(x, y, storeContents, room) {
  const creep = {
    name: "miner_E37S38_83371433",
    my: true,
    spawning: false,
    room, // boost.manager.run: `if (creep.room.name !== room.name) return false`
    memory: { role: "miner", homeRoom: "E37S38" },
    body: [],
    store: Store(800, storeContents || {}),
    pos: new RoomPosition(x, y, "E37S38"),
    moveTo(target) {
      moveToCalls.push(target && target.id);
      return global.OK;
    },
    drop(resource) {
      dropCalls.push(resource);
      return global.OK;
    },
  };
  for (let i = 0; i < 12; i++) creep.body.push({ type: "work" });
  for (let i = 0; i < 7; i++) creep.body.push({ type: "carry" });
  for (let i = 0; i < 8; i++) creep.body.push({ type: "move" });
  return creep;
}

/** roomState с одной буст-лабой; комната с полной энергией (порог 50% не мешает). */
function makeRoomState(lab) {
  const room = {
    name: "E37S38",
    memory: { boostLabs: { UO: LAB_ID } },
    energyAvailable: 10600,
    energyCapacityAvailable: 10600,
    storage: null,
    terminal: null,
  };
  return { roomName: "E37S38", room, labs: [lab], storage: null, terminal: null };
}

function reset() {
  boostCreepCalls = [];
  moveToCalls = [];
  dropCalls = [];
  delete global._boostManager; // heap-кэш индекса лабы между случаями
  Memory.__boostMetric = undefined;
  NOW += 1000;
}

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? " → " + detail : ""}`);
  }
}

/* ── 1. ЖИВОЙ СЛУЧАЙ: минерал есть, энергии нет ───────────────────────── */
{
  console.log("\n1. Живая авария: KH 480 + energy 10 (0 оплаченных частей)");
  reset();
  const lab = makeLab(480, 10);
  const rs = makeRoomState(lab);
  const creep = makeCreep(12, 15, null, rs.room); // вплотную к лабе (13,14) — как в аварии

  const res = mod.run(rs, creep);

  check("роль НЕ подавлена (run → false)", res === false, String(res));
  check("lab.boostCreep НЕ вызван", boostCreepCalls.length === 0, JSON.stringify(boostCreepCalls));
  check("moveTo не вызывался (крип уже у лабы)", moveToCalls.length === 0, JSON.stringify(moveToCalls));
  check(
    "троттлинг boostWait = время + RETRY_INTERVAL",
    creep.memory.boostWait === NOW + LAB_BOOST.RETRY_INTERVAL,
    String(creep.memory.boostWait),
  );
  check("память процедуры не осталась", creep.memory.boostTask === undefined && creep.memory.boostSince === undefined);
  check(
    "отказ виден в метрике",
    String(Memory.__boostMetric && Memory.__boostMetric.E37S38).indexOf("нет оплаты части") === 0,
    JSON.stringify(Memory.__boostMetric),
  );
}

/* ── 2. ГРАНИЦА: энергии ровно на одну часть ──────────────────────────── */
{
  console.log("\n2. Граница: energy = 20 (ровно одна часть) — буст идёт как раньше");
  reset();
  const lab = makeLab(480, 20);
  const rs = makeRoomState(lab);
  const creep = makeCreep(12, 15, null, rs.room);

  const res = mod.run(rs, creep);

  check("lab.boostCreep вызван", boostCreepCalls.length === 1, JSON.stringify(boostCreepCalls));
  check("cap = 12 (parts строки политики miner)", boostCreepCalls[0] && boostCreepCalls[0].n === 12);
  check("роль подавлена законно (run → true, выдача состоялась)", res === true, String(res));
}

/* ── 3. НЕ ПОДЗЫВАЕМ к лабе, которая не платит ───────────────────────── */
{
  console.log("\n3. Крип в 7 клетках от «мёртвой» лабы: moveTo не вызывается");
  reset();
  const lab = makeLab(480, 10);
  const rs = makeRoomState(lab);
  const creep = makeCreep(20, 20, null, rs.room);

  const res = mod.run(rs, creep);

  check("роль НЕ подавлена (run → false)", res === false, String(res));
  check("крипа не повели к лабе (moveTo не вызван)", moveToCalls.length === 0, JSON.stringify(moveToCalls));
  check(
    "троттлинг поставлен",
    creep.memory.boostWait === NOW + LAB_BOOST.RETRY_INTERVAL,
    String(creep.memory.boostWait),
  );
}

/* ── 4. ТРОТТЛИНГ: внутри RETRY_INTERVAL лабу не трогаем ─────────────── */
{
  console.log("\n4. Повторный вызов внутри RETRY_INTERVAL не трогает лабу");
  reset();
  const lab = makeLab(480, 10);
  const rs = makeRoomState(lab);
  const creep = makeCreep(12, 15, null, rs.room);

  mod.run(rs, creep);
  const waitAfterFirst = creep.memory.boostWait;
  const callsAfterFirst = boostCreepCalls.length;

  NOW += 1; // внутри окна ожидания
  const res2 = mod.run(rs, creep);

  check("второй вызов → false", res2 === false, String(res2));
  check("boostCreep не вызывался ни разу", boostCreepCalls.length === callsAfterFirst);
  check("boostWait не переписан (ждём окно)", creep.memory.boostWait === waitAfterFirst, String(creep.memory.boostWait));

  NOW = waitAfterFirst; // окно истекло — попытка возобновляется
  mod.run(rs, creep);
  check(
    "после окна попытка возобновилась (boostWait обновлён)",
    creep.memory.boostWait === NOW + LAB_BOOST.RETRY_INTERVAL,
    String(creep.memory.boostWait),
  );
  check("и снова без вызова boostCreep (частей по-прежнему 0)", boostCreepCalls.length === 0);
}

/* ── 5. КОНТРОЛЬ: лаба с энергией бустит ─────────────────────────────── */
{
  console.log("\n5. Контроль: energy 1000 — буст выдаётся, роль подавлена");
  reset();
  const lab = makeLab(480, 1000);
  const rs = makeRoomState(lab);
  const creep = makeCreep(12, 15, null, rs.room);

  const res = mod.run(rs, creep);

  check("lab.boostCreep вызван один раз", boostCreepCalls.length === 1, JSON.stringify(boostCreepCalls));
  check("cap = 12", boostCreepCalls[0] && boostCreepCalls[0].n === 12);
  check("run → true (действия крипа сделаны бустом)", res === true, String(res));
  check("груз буста не сбрасывался", dropCalls.length === 0, JSON.stringify(dropCalls));
}

/* ── Итог ─────────────────────────────────────────────────────────────── */
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
