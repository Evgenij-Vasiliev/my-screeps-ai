"use strict";
/**
 * ===================================================
 * LAB.WORKER.TEST.JS — офлайн-проверка роли lab.worker (v5, CPU)
 * ===================================================
 * Проверяет то, что даёт выигрыш по CPU (docs/LAB-WORKER-CPU-OPTIMIZATION.md):
 *   1) гистерезис дозаправки: рейс начинается только при дефиците >= рюкзака;
 *   2) за рейс крип берёт полный рюкзак (amount = min(дефицит, источник, свободно));
 *   3) если крип уже везёт реагент — задача на сдачу даётся всегда;
 *   4) действие не вызывается «в молоко»: пока крип далеко, только travelTo;
 *   5) перебор конфигов без задачи — не чаще IDLE_SCAN_INTERVAL тиков;
 *   6) порог выгрузки продукта PRODUCT_UNLOAD_AT;
 *   7) round-robin порядок троек сохранён, room.memory.labWorkerIndex не пишется.
 *
 * Запуск: node tests/lab.worker.test.js
 */

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
// Константа движка: нужна findSource — энергия теперь берётся только из склада
// (единый источник энергии для всех крипов), и ветка сравнивает ресурс с ней.
global.RESOURCE_ENERGY = "energy";

function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

/**
 * Store как в игре: ресурсы — собственные перечисляемые ключи, методы — не
 * перечисляются, а обращение к отсутствующему ресурсу возвращает 0
 * (`for..in`/`Object.keys` при этом видят только реально лежащие ресурсы,
 * именно на это опирается поиск «чужого ресурса» в lab.worker).
 */
function Store(capacity, contents) {
  const target = {};
  for (const k of Object.keys(contents || {})) target[k] = contents[k];
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "getFreeCapacity") return () => capacity - storeUsed(t);
      if (prop === "getUsedCapacity") return () => storeUsed(t);
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
    if (p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  isNearTo(t) {
    return this.getRangeTo(t) <= 1;
  }
  toString() {
    return `[room ${this.roomName} pos ${this.x},${this.y}]`;
  }
}

global.RoomPosition = RoomPosition;

const WORLD = { objects: {} };
const ROOMS = {};

global.Game = {
  time: 1000,
  cpu: { getUsed: () => 0 },
  getObjectById: id => WORLD.objects[id] || null,
};

function makeStruct(id, x, y, roomName, capacity, contents) {
  const s = {
    id,
    pos: new RoomPosition(x, y, roomName),
    store: new Store(capacity, contents),
  };
  WORLD.objects[id] = s;
  return s;
}

/**
 * Комната с одной тройкой: lab1(reagent1) + lab2(reagent2) + reactor(product).
 * Лабы в (10..12,10), storage в (10,20) с большим запасом обоих реагентов.
 */
function makeRoom(name, levels) {
  const room = { name, memory: {}, terminal: null, storage: null };
  ROOMS[name] = room;

  const lab1 = makeStruct("L1", 10, 10, name, 3000, { [levels.rc1]: levels.l1 });
  const lab2 = makeStruct("L2", 11, 10, name, 3000, { [levels.rc2]: levels.l2 });
  const reactor = makeStruct("R1", 12, 10, name, 3000, {
    [levels.product]: levels.prod,
  });
  room.memory.labs = {
    lab1: lab1.id,
    lab2: lab2.id,
    reactor: reactor.id,
    reagent1: levels.rc1,
    reagent2: levels.rc2,
    product: levels.product,
  };
  room.storage = makeStruct("ST", 10, 20, name, 1000000, {
    [levels.rc1]: 100000,
    [levels.rc2]: 100000,
  });
  return room;
}

// ── Крип ────────────────────────────────────────────────────────────────
class Creep {
  constructor(name, x, y, roomName, capacity, contents) {
    this.name = name;
    this.pos = new RoomPosition(x, y, roomName);
    this.store = new Store(capacity, contents || {});
    this.room = ROOMS[roomName];
    this.memory = { role: "labWorker", homeRoom: roomName };
    this.said = 0;
    this.travelToCalls = [];
    this.withdrawCalls = [];
    this.transferCalls = [];
  }
  say() {
    this.said++;
  }
  travelTo(target) {
    this.travelToCalls.push(target.id);
    // «Дошёл» за один вызов: встаём рядом с целью.
    this.pos = new RoomPosition(
      target.pos.x,
      target.pos.y + 1,
      target.pos.roomName,
    );
    return OK;
  }
  withdraw(target, resource, amount) {
    const near = this.pos.isNearTo(target);
    this.withdrawCalls.push({ id: target.id, resource, amount, near });
    if (!near) return ERR_NOT_IN_RANGE;
    const room = Math.min(
      target.store[resource] || 0,
      amount === undefined ? Infinity : amount,
      this.store.getFreeCapacity(),
    );
    if (room <= 0) return ERR_FULL;
    target.store[resource] -= room;
    this.store[resource] = (this.store[resource] || 0) + room;
    return OK;
  }
  transfer(target, resource) {
    const near = this.pos.isNearTo(target);
    this.transferCalls.push({ id: target.id, resource, near });
    if (!near) return ERR_NOT_IN_RANGE;
    const move = Math.min(
      this.store[resource] || 0,
      target.store.getFreeCapacity(),
    );
    if (move <= 0) return ERR_FULL;
    this.store[resource] -= move;
    target.store[resource] = (target.store[resource] || 0) + move;
    return OK;
  }
}

// ── Загрузка модуля и микро-фреймворк ───────────────────────────────────
const mod = require("../lab.worker");
const { LAB_WORKER } = require("../constants");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log("  ok — " + label);
  } else {
    failed++;
    console.log("  FAIL — " + label + (extra ? " :: " + extra : ""));
  }
}

function resetHeap() {
  delete global._labWorker;
}

function newCreep(roomName, capacity, contents) {
  // Далёкая от хранилища (10,20) и лаб (10..12,10) клетка: чтобы «дошёл»
  // происходил через travelTo, а не «повезло стоять рядом».
  const c = new Creep(
    "labWorker_test",
    10,
    30,
    roomName,
    capacity,
    contents,
  );
  return c;
}

// ── 1. Гистерезис: дефицит < рюкзака — рейс не начинается ───────────────
{
  console.log("\n1. Гистерезис дозаправки (дефицит 5 < рюкзака 500)");
  resetHeap();
  makeRoom("T1", { rc1: "O", rc2: "H", product: "OH", l1: 2995, l2: 3000, prod: 0 });
  const creep = newCreep("T1", 500, {});
  mod.run(creep);
  check("задача не создана", !creep.memory.task, `task=${creep.memory.task}`);
  check("рейс не начат (travelTo 0 раз)", creep.travelToCalls.length === 0);
}

// ── 2. Большой дефицит — рейс с полным рюкзаком, действие только рядом ──
{
  console.log("\n2. Рейс с полным рюкзаком (дефицит 600 >= 500)");
  resetHeap();
  makeRoom("T2", { rc1: "O", rc2: "H", product: "OH", l1: 2400, l2: 3000, prod: 0 });
  const creep = newCreep("T2", 500, {});
  mod.run(creep);
  check("задача load_lab1", creep.memory.task === "load_lab1", creep.memory.task);
  check("amount = 500 (полный рюкзак)", creep.memory.amount === 500, String(creep.memory.amount));
  check("едем к источнику (travelTo 1 раз)", creep.travelToCalls.length === 1);
  check(
    "действие «в молоко» не вызвано (withdraw 0)",
    creep.withdrawCalls.length === 0,
  );

  // Второй тик: крип уже рядом с хранилищем — можно брать.
  Game.time += 1;
  mod.run(creep);
  const w = creep.withdrawCalls[0];
  check("withdraw рядом", w && w.near === true, JSON.stringify(w));
  check("withdraw на полный рюкзак (500)", w && w.amount === 500, JSON.stringify(w));
  check("рюкзак реально полон", creep.store.O === 500, String(creep.store.O));
}

// ── 3. Крип уже везёт реагент — задача на сдачу даётся всегда ───────────
{
  console.log("\n3. Крип везёт реагент при малом дефиците (5)");
  resetHeap();
  makeRoom("T3", { rc1: "O", rc2: "H", product: "OH", l1: 2995, l2: 3000, prod: 0 });
  const creep = newCreep("T3", 500, { O: 100 });
  mod.run(creep);
  check("задача создана (сдать привезённое)", creep.memory.task === "load_lab1", creep.memory.task);
  check("едем к лабе", creep.travelToCalls[0] === "L1", String(creep.travelToCalls[0]));
  check("transfer «в молоко» не вызван", creep.transferCalls.length === 0);

  Game.time += 1; // крип уже рядом с лабой
  mod.run(creep);
  check("transfer рядом", creep.transferCalls[0] && creep.transferCalls[0].near === true);
  check("лаба добита до 3000", WORLD.objects.L1.store.O === 3000, String(WORLD.objects.L1.store.O));
}

// ── 4. Действие не вызывается «в молоко» и на сдаче ─────────────────────
{
  console.log("\n4. Сдача: пока далеко — только travelTo");
  resetHeap();
  makeRoom("T4", { rc1: "O", rc2: "H", product: "OH", l1: 2400, l2: 3000, prod: 0 });
  const creep = newCreep("T4", 500, { O: 500 });
  mod.run(creep);
  check("едем к лабе (travelTo)", creep.travelToCalls[0] === "L1");
  check("transfer при далёкой цели не вызван", creep.transferCalls.length === 0);
}

// ── 5. Троттлинг перебора конфигов без задачи ───────────────────────────
{
  console.log("\n5. Троттлинг: перебор не чаще IDLE_SCAN_INTERVAL тиков");
  resetHeap();
  makeRoom("T5", { rc1: "O", rc2: "H", product: "OH", l1: 3000, l2: 3000, prod: 0 });
  const creep = newCreep("T5", 500, {});
  let scans = 0;
  const orig = mod.getRotatedConfigs;
  mod.getRotatedConfigs = function (room) {
    scans++;
    return orig.call(mod, room);
  };
  for (let i = 0; i < 10; i++) {
    Game.time += 1;
    mod.run(creep);
  }
  mod.getRotatedConfigs = orig;
  const maxScans = Math.ceil(10 / LAB_WORKER.IDLE_SCAN_INTERVAL) + 1;
  check(
    `переборов ${scans} (<= ${maxScans}, было бы 10 каждый тик)`,
    scans <= maxScans && scans >= 3,
    String(scans),
  );
}

// ── 6. Порог выгрузки продукта ──────────────────────────────────────────
{
  console.log("\n6. Продукт: 100 (< порога) не трогаем, 300 (>= порога) выгружаем");
  resetHeap();
  makeRoom("T6", { rc1: "O", rc2: "H", product: "OH", l1: 3000, l2: 3000, prod: 100 });
  const creep = newCreep("T6", 500, {});
  mod.run(creep);
  check("при 100 задачи нет", !creep.memory.task, String(creep.memory.task));

  WORLD.objects.R1.store.OH = 300;
  resetHeap();
  Game.time += 1;
  mod.run(creep);
  check(
    `при 300 задача unload_reactor (порог ${LAB_WORKER.PRODUCT_UNLOAD_AT})`,
    creep.memory.task === "unload_reactor",
    String(creep.memory.task),
  );
}

// ── 7. Round-robin сохранён, Memory не пишется ──────────────────────────
{
  console.log("\n7. Round-robin по тройкам; room.memory.labWorkerIndex не пишется");
  resetHeap();
  const room = makeRoom("T7", { rc1: "O", rc2: "H", product: "OH", l1: 3000, l2: 3000, prod: 0 });
  room.memory.labs2 = room.memory.labs;
  room.memory.labs3 = room.memory.labs;
  const a = mod.getRotatedConfigs(room).map(c => c.key).join(",");
  const b = mod.getRotatedConfigs(room).map(c => c.key).join(",");
  const c3 = mod.getRotatedConfigs(room).map(c => c.key).join(",");
  check("первый обход labs,labs2,labs3", a === "labs,labs2,labs3", a);
  check("второй обход начинается с labs2", b === "labs2,labs3,labs", b);
  check("третий обход начинается с labs3", c3 === "labs3,labs,labs2", c3);
  check(
    "room.memory.labWorkerIndex не используется",
    room.memory.labWorkerIndex === undefined,
    String(room.memory.labWorkerIndex),
  );
}

// ── 8. Чужой ресурс в лабе ──────────────────────────────────────────────
{
  console.log("\n8. Чужой ресурс в lab1 -> clear_lab");
  resetHeap();
  makeRoom("T8", { rc1: "O", rc2: "H", product: "OH", l1: 3000, l2: 3000, prod: 0 });
  WORLD.objects.L1.store.X = 50;
  const creep = newCreep("T8", 500, {});
  mod.run(creep);
  check("задача clear_lab", creep.memory.task === "clear_lab", String(creep.memory.task));
  check("ресурс X", creep.memory.resource === "X", String(creep.memory.resource));
}

// ── Итог ────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
