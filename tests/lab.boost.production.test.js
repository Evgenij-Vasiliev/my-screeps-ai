"use strict";
/**
 * ===================================================
 * LAB.BOOST.PRODUCTION.TEST.JS — лабораторное производство и бусты
 * ===================================================
 * Офлайн-проверка docs/LAB_BOOST_PRODUCTION_PLAN.md:
 *
 *   A. Конфигурация LAB_PLAN (две реакции на тройку, пороги, приоритеты)
 *   B. lab.recipes — выбор рецепта по дефициту с гистерезисом (без дребезга)
 *   C. lab.manager + lab.worker — варится РОВНО один рецепт тройки
 *   D. Надёжность: нет сырья / нет X / игнорирование неполных троек
 *   E. Терминальная сеть: буст-лаба получает готовый буст, промежуточные
 *      компоненты попадают в заявки (пороги TERMINAL_NETWORK не меняются)
 *   F. boost.manager: приоритеты XKH2O → CARRY, XZHO2 → MOVE, XUHO2 → remoteMiner
 *   G. Сохранение существующего Task System (TASK_CHAIN не тронут)
 *
 * Запуск: node tests/lab.boost.production.test.js
 */

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_TIRED = -11;
global.ERR_INVALID_ARGS = -10;
global.ERR_NOT_OWNER = -1;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_STORAGE = "storage";
global.STRUCTURE_TERMINAL = "terminal";
global.FIND_MY_STRUCTURES = 101;
global.LAB_BOOST_AMOUNT = 30;

// ── Разрешение bare-require в стиле Screeps ─────────────────────────────
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Таблица BOOSTS движка (снята с живого shard3) ────────────────────────
// ВАЖНО: UHO2 и UH2O — РАЗНЫЕ ресурсы. UHO2 (utrium alkalide) даёт harvest 5 →
// XUHO2 harvest 7 (добычный буст), а UH2O (utrium acid) — ATTACK 3 → XUH2O
// attack 4. Прежняя редакция этой заглушки приписывала harvest ресурсу UH2O,
// чего в движке нет: проверено на живом shard3 запросом BOOSTS.work.UHO2.
global.BOOSTS = {
  work: {
    UO: { harvest: 3 },
    UHO2: { harvest: 5 },
    XUHO2: { harvest: 7 },
    LH2O: { build: 1.8, repair: 1.8 },
    ZH2O: { dismantle: 3 },
    GH2O: { upgradeController: 1.8 },
  },
  attack: { UH: { attack: 2 }, UH2O: { attack: 3 }, XUH2O: { attack: 4 } },
  ranged_attack: { KHO2: { rangedAttack: 3, rangedMassAttack: 3 }, XKHO2: { rangedAttack: 4, rangedMassAttack: 4 } },
  heal: { LHO2: { heal: 3 }, XLHO2: { heal: 4 } },
  carry: { KH2O: { capacity: 3 }, XKH2O: { capacity: 4 } },
  move: { ZHO2: { fatigue: 3 }, XZHO2: { fatigue: 4 } },
  tough: { GHO2: { damage: 0.5 }, XGHO2: { damage: 0.3 } },
};

// ── Таблица REACTIONS движка (снята с живого shard3) ─────────────────────
// REACTIONS.UO.OH === "UHO2", REACTIONS.UH.OH === "UH2O" — проверено живьём.
global.REACTIONS = {
  K: { H: "KH", O: "KO" },
  U: { O: "UO", L: "UL", H: "UH" },
  Z: { O: "ZO", K: "ZK" },
  L: { O: "LO" },
  G: { H: "GH", O: "GO" },
  O: { H: "OH" },
  KH: { OH: "KH2O" },
  KO: { OH: "KHO2" },
  LO: { OH: "LHO2" },
  ZO: { OH: "ZHO2" },
  GO: { OH: "GHO2" },
  UO: { OH: "UHO2" },
  UH: { OH: "UH2O" },
  ZK: { UL: "G" },
  UL: { ZK: "G" },
  KH2O: { X: "XKH2O" },
  KHO2: { X: "XKHO2" },
  UHO2: { X: "XUHO2" },
  UH2O: { X: "XUH2O" },
  ZHO2: { X: "XZHO2" },
  LHO2: { X: "XLHO2" },
  GHO2: { X: "XGHO2" },
};

function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

/**
 * Store как в игре: ресурсы — перечисляемые ключи, доступ к отсутствующему
 * ресурсу даёт 0, методы не перечисляются.
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

// Терминалы: журнал реально выполненных send() (см. terminalNetwork.send).
// Нужен интеграционным проверкам приоритетной доставки компонентов: что именно
// и сколько уехало из комнаты-донора в E35S37.
const SENT = [];

global.Game = {
  time: 1000,
  cpu: { getUsed: () => 0, bucket: 10000 },
  creeps: {},
  rooms: {},
  // Комиссия Terminal.send считается отсюда (terminalNetwork.fitSendAmount).
  // Мок: 1 % от объёма — важно только то, что после send в терминале донора
  // остаётся резерв TERMINAL_SUPPLY.ENERGY_MIN.
  market: { calcTransactionCost: amount => Math.ceil(amount * 0.01) },
  getObjectById: id => WORLD.objects[id] || null,
};

const LABS = {
  E35S37: [
    ["lab1_r1", 23, 9], ["lab2_r1", 21, 9], ["x_r1", 22, 9],
    ["lab1_r2", 28, 10], ["lab2_r2", 30, 10], ["x_r2", 29, 10],
    ["lab1_r3", 30, 12], ["lab2_r3", 32, 12], ["x_r3", 31, 12],
    ["boost", 19, 9],
  ],
  E35S39: [
    ["t1a", 31, 15], ["t1b", 29, 15], ["t1x", 30, 15],
    ["t2a", 33, 15], ["t2b", 34, 15], ["t2x", 35, 15],
    ["t3a", 30, 17], ["t3b", 32, 17], ["t3x", 31, 17],
    ["boost", 32, 13],
  ],
  E36S38: [
    ["t1a", 21, 8], ["t1b", 23, 8], ["t1x", 22, 8],
    ["t2a", 22, 6], ["t2b", 23, 6], ["t2x", 24, 6],
    ["t3a", 13, 8], ["t3b", 15, 8], ["t3x", 14, 8],
    ["boost", 16, 10],
  ],
  E37S37: [
    ["t1a", 36, 23], ["t1b", 34, 23], ["t1x", 35, 23],
    ["t2a", 34, 21], ["t2b", 36, 21], ["t2x", 35, 21],
    ["t3a", 36, 27], ["t3b", 35, 27], ["t3x", 34, 27],
    ["boost", 36, 19],
  ],
  E37S38: [
    ["t1a", 14, 18], ["t1b", 12, 18], ["t1x", 13, 18],
    ["t2a", 10, 18], ["t2b", 8, 18], ["t2x", 9, 18],
    ["t3a", 12, 16], ["t3b", 10, 16], ["t3x", 11, 16],
    ["boost", 13, 14],
  ],
};

function labAt(id, roomName) {
  for (const row of LABS[roomName]) if (row[0] === id) return row;
  return null;
}

/**
 * Мок движкового действия буста: lab.boostCreep(creep, bodyPartsCount).
 * Метода creep.boost в движке НЕТ («creep.boost is not a function», проверено на
 * живом shard3), а тип буста движок берёт из самой лаборатории
 * (StructureLab.mineralType), поэтому запись идёт в мок лабы, а результат
 * складывается в память крипа — его и проверяют тесты.
 */
function labBoostCreep(creep, amount) {
  creep.boostCalls = (creep.boostCalls || 0) + 1;
  let labType = null;
  for (const k in this.store) {
    if (k !== RESOURCE_ENERGY && this.store[k] > 0) { labType = k; break; }
  }
  creep.lastBoost = { lab: this.id, amount, labType };
  return OK;
}

/** Лаборатория с id вида "E35S37:lab1_r1" — имя внутри комнаты + комната. */
function makeLab(roomName, label) {
  const id = roomName + ":" + label;
  const row = labAt(label, roomName);
  const lab = {
    id,
    structureType: STRUCTURE_LAB,
    pos: new RoomPosition(row[1], row[2], roomName),
    store: new Store(3000, {}),
    cooldown: 0,
    boostCreep: labBoostCreep,
    runReaction: function () {
      reactions.push(roomName + ":" + label);
      return OK;
    },
  };
  WORLD.objects[id] = lab;
  return lab;
}

const reactions = [];

/**
 * Комната со своими тройками (по LAB_PLAN), буст-лабой и складами.
 * @param {string} name
 * @param {{lab?: Object, storage?: Object, terminal?: Object}} [fill]
 */
function makeRoom(name, fill) {
  const mem = {};
  const room = {
    name,
    // controller обязателен: terminalNetwork.collectRoomStates и
    // roomManager.getOwnedRooms берут в сеть только СВОИ комнаты.
    controller: { my: true },
    memory: mem,
    storage: null,
    terminal: null,
    find: () => [],
  };

  for (const row of LABS[name]) makeLab(name, row[0]);
  // Буст-лаба комнаты: лаборатория фикстуры под РЕАЛЬНЫМ ID из конфигурации
  // проекта (LAB_BOOST.BOOST_LAB) — так же, как в игре. Именно эту запись
  // восстанавливает bootstrap (см. секцию J). Ключ памяти крипа boostLab — это
  // фаза буста в creep.memory (boost.manager), а не Memory.rooms[].
  const boostId = LAB_BOOST.BOOST_LAB[name];
  if (boostId) {
    mem.boostLab = boostId;
    // Лаборатория буста — объект фикстуры под РЕАЛЬНЫМ ID конфигурации
    // (LAB_BOOST.BOOST_LAB), на координатах строки "boost" из LABS. Объект
    // перезаписывается при каждой сборке комнаты: WORLD.objects живёт между
    // секциями теста, и устаревшая позиция/склад ломали бы проверки близости.
    const row = labAt("boost", name);
    WORLD.objects[boostId] = {
      id: boostId,
      structureType: STRUCTURE_LAB,
      pos: new RoomPosition(row[1], row[2], name),
      store: new Store(3000, {}),
      cooldown: 0,
      boostCreep: labBoostCreep,
    };
  } else {
    mem.boostLab = name + ":boost";
  }

  const lab = id => name + ":" + id;
  // В E35S37 тройки названы lab*, в остальных комнатах — t*.
  const T = name === "E35S37"
    ? [["lab1_r1", "lab2_r1", "x_r1"], ["lab1_r2", "lab2_r2", "x_r2"],
       ["lab1_r3", "lab2_r3", "x_r3"]]
    : [["t1a", "t1b", "t1x"], ["t2a", "t2b", "t2x"], ["t3a", "t3b", "t3x"]];
  const triple = t => ({ lab1: lab(t[0]), lab2: lab(t[1]), reactor: lab(t[2]) });

  const plan = require("../constants").LAB_PLAN[name];
  mem.labs = Object.assign(triple(T[0]), plan.labs);
  mem.labs2 = Object.assign(triple(T[1]), plan.labs2);
  mem.labs3 = Object.assign(triple(T[2]), plan.labs3);

  room.storage = {
    id: name + ":storage",
    pos: new RoomPosition(0, 0, name),
    store: new Store(1000000, {}),
  };
  room.terminal = {
    id: name + ":terminal",
    // room обязателен: terminalNetwork.fitSendAmount считает комиссию через
    // Game.market.calcTransactionCost(amount, terminal.room.name, dest).
    room: room,
    pos: new RoomPosition(1, 0, name),
    store: new Store(300000, {}),
    cooldown: 0,
    // send(): как движок — переносит ресурс и списывает комиссию энергией
    // терминала-донора. Комиссия мока: 1 % объёма (на проверяемую логику
    // приоритета не влияет, но делает отправку «настоящей»).
    send: function (resourceType, amount, destRoomName, description) {
      this.store[resourceType] = (this.store[resourceType] || 0) - amount;
      const cost = Math.ceil(amount * 0.01);
      this.store[RESOURCE_ENERGY] =
        (this.store[RESOURCE_ENERGY] || 0) - cost;
      // Ресурс приезжает в терминал комнаты-получателя: без этого «запас
      // финишёра вырос» проверить нельзя, а приоритетная доставка как раз про
      // то, что компонент становится доступен лабораториям E35S37.
      const dest = Game.rooms[destRoomName];
      if (dest && dest.terminal) {
        dest.terminal.store[resourceType] =
          (dest.terminal.store[resourceType] || 0) + amount;
      }
      SENT.push({
        from: name,
        to: destRoomName,
        resourceType: resourceType,
        amount: amount,
        description: description,
      });
      return OK;
    },
  };
  WORLD.objects[room.storage.id] = room.storage;
  WORLD.objects[room.terminal.id] = room.terminal;

  fill = fill || {};
  if (fill.lab) room.memory.labFill = fill.lab;
  if (fill.storage) for (const k in fill.storage) room.storage.store[k] = fill.storage[k];
  if (fill.terminal) for (const k in fill.terminal) room.terminal.store[k] = fill.terminal[k];

  Game.rooms[name] = room;
  return room;
}

function labOf(room, label) {
  return WORLD.objects[room.name + ":" + label];
}

function setStock(room, key, slot, resource, amount) {
  const config = room.memory[key];
  const id = slot === "A" ? config.lab1 : slot === "B" ? config.lab2 : config.reactor;
  const lab = WORLD.objects[id];
  lab.store = new Store(3000, { [resource]: amount });
  return lab;
}

// ── Тестовый каркас ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label + (detail ? " :: " + detail : ""));
    console.log("  FAIL  " + label + (detail ? " :: " + detail : ""));
  }
}

function section(title) {
  console.log("\n" + title);
}

/** Свежий тик: сбрасываем все tick-кэши в heap, как это делает Global Reset. */
function nextTick() {
  Game.time++;
  global._labPlan = undefined;
  global._terminalLabs = undefined;
  global._labWorker = undefined;
  global._boostManager = undefined;
}

const recipes = require("../lab.recipes");
const labManager = require("../lab.manager");
const labWorker = require("../lab.worker");
const boostManager = require("../boost.manager");
const terminalNetwork = require("../terminalNetwork");
const { LAB_PLAN, LAB_BOOST, TERMINAL_NETWORK, TERMINAL_SUPPLY } = require("../constants");

// ═══════════════════════════════════════════════════════════════════════
// A. Конфигурация LAB_PLAN
// ═══════════════════════════════════════════════════════════════════════

function testPlan() {
  section("A. LAB_PLAN: две реакции на тройку, пороги, приоритеты");

  const rooms = ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"];
  ok("план описывает все 5 комнат", rooms.every(r => !!LAB_PLAN[r]));

  // Новый план: финальные X-тройки стоят во ВСЕХ пяти комнатах, но состав
  // конечных бустов разный (проверено require("./constants").LAB_PLAN):
  //   XKH2O (CARRY)  — E35S37, E35S39, E36S38, E37S37, E37S38;
  //   XUHO2 (harvest)— только E35S37 и E37S37;
  //   XZHO2 (MOVE)   — только E35S37.
  const PLAN_ROOMS = ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"];
  const xProducers = {}; // конечный буст → комнаты, которые его выпускают
  const xProducedIn = {}; // комната → выпускает ли она хоть один X-буст

  let everySlotHasTwoRecipes = true;
  let everyGapValid = true;
  let everyRecipeValid = true;

  for (const room of rooms) {
    const plan = LAB_PLAN[room];
    ok(room + ": ровно три производственные тройки",
      ["labs", "labs2", "labs3"].every(k => !!plan[k]));
    for (const key of ["labs", "labs2", "labs3"]) {
      const slot = plan[key];
      if (!slot.recipeA || !slot.recipeB) everySlotHasTwoRecipes = false;
      if (!(slot.lowA < slot.highA) || !(slot.lowB < slot.highB)) {
        everyGapValid = false;
        console.log("    разрыв LOW<HIGH нарушен: " + room + "." + key);
      }
      for (const r of [slot.recipeA, slot.recipeB]) {
        const table = global.REACTIONS[r.reagent1];
        if (!table || table[r.reagent2] !== r.product) everyRecipeValid = false;
        if (r.product.indexOf("X") === 0) {
          xProducedIn[room] = true;
          if (!xProducers[r.product]) xProducers[r.product] = {};
          xProducers[r.product][room] = true;
        }
      }
    }
  }

  const producersOf = (resource) =>
    Object.keys(xProducers[resource] || {}).sort().join(",");

  ok("у каждой тройки ровно два рецепта", everySlotHasTwoRecipes);
  ok("в каждой паре LOW < HIGH (гистерезис)", everyGapValid);
  ok("каждый рецепт существует в таблице REACTIONS движка", everyRecipeValid);
  ok("конечные X-бусты производятся во всех пяти комнатах плана",
    PLAN_ROOMS.every(r => xProducedIn[r] === true),
    JSON.stringify(xProducedIn));
  ok("XKH2O (CARRY) производят все пять комнат",
    producersOf("XKH2O") === PLAN_ROOMS.slice().sort().join(","),
    producersOf("XKH2O"));
  ok("XUHO2 (harvest) производят только E35S37 и E37S37",
    producersOf("XUHO2") === "E35S37,E37S37",
    producersOf("XUHO2"));
  ok("XZHO2 (MOVE) производит только E35S37",
    producersOf("XZHO2") === "E35S37",
    producersOf("XZHO2"));

  // Целевые запасы конечных бустов (docs/LAB_BOOST_PRODUCTION_PLAN.md, §7).
  // Новый план E35S37: три тройки на XKH2O/XZHO2/XUHO2, пороги hubs ниже
  // прежних 3000/5000 — запасы подняты под второй производитель (E37S37).
  ok("E35S37.labs: KH2O+X→XKH2O ↔ ZHO2+X→XZHO2, пороги 800/2500 и 400/1200",
    LAB_PLAN.E35S37.labs.recipeA.reagent1 === "KH2O" &&
    LAB_PLAN.E35S37.labs.recipeA.reagent2 === "X" &&
    LAB_PLAN.E35S37.labs.recipeA.product === "XKH2O" &&
    LAB_PLAN.E35S37.labs.recipeB.reagent1 === "ZHO2" &&
    LAB_PLAN.E35S37.labs.recipeB.reagent2 === "X" &&
    LAB_PLAN.E35S37.labs.recipeB.product === "XZHO2" &&
    LAB_PLAN.E35S37.labs.lowA === 800 &&
    LAB_PLAN.E35S37.labs.highA === 2500 &&
    LAB_PLAN.E35S37.labs.lowB === 400 &&
    LAB_PLAN.E35S37.labs.highB === 1200);
  ok("E35S37.labs2: KH2O+X→XKH2O ↔ UHO2+X→XUHO2 (harvest), пороги 800/2500 и 300/1200",
    LAB_PLAN.E35S37.labs2.recipeA.reagent1 === "KH2O" &&
    LAB_PLAN.E35S37.labs2.recipeA.product === "XKH2O" &&
    LAB_PLAN.E35S37.labs2.recipeB.reagent1 === "UHO2" &&
    LAB_PLAN.E35S37.labs2.recipeB.reagent2 === "X" &&
    LAB_PLAN.E35S37.labs2.recipeB.product === "XUHO2" &&
    LAB_PLAN.E35S37.labs2.lowA === 800 &&
    LAB_PLAN.E35S37.labs2.highA === 2500 &&
    LAB_PLAN.E35S37.labs2.lowB === 300 &&
    LAB_PLAN.E35S37.labs2.highB === 1200);
  ok("E35S37.labs3: UHO2+X→XUHO2 ↔ ZHO2+X→XZHO2 (вторая мощность MOVE), пороги 300/1200 и 400/1200",
    LAB_PLAN.E35S37.labs3.recipeA.reagent1 === "UHO2" &&
    LAB_PLAN.E35S37.labs3.recipeA.product === "XUHO2" &&
    LAB_PLAN.E35S37.labs3.recipeB.reagent1 === "ZHO2" &&
    LAB_PLAN.E35S37.labs3.recipeB.reagent2 === "X" &&
    LAB_PLAN.E35S37.labs3.recipeB.product === "XZHO2" &&
    LAB_PLAN.E35S37.labs3.lowA === 300 &&
    LAB_PLAN.E35S37.labs3.highA === 1200 &&
    LAB_PLAN.E35S37.labs3.lowB === 400 &&
    LAB_PLAN.E35S37.labs3.highB === 1200);
  ok("XGHO2 отсутствует в плане полностью (ТЗ: не производить)",
    JSON.stringify(LAB_PLAN).indexOf("XGHO2") === -1 &&
    JSON.stringify(LAB_PLAN).indexOf("GHO2") === -1);
  ok("G-цепочка снята: G/GO/ZK/UL не производятся нигде",
    JSON.stringify(LAB_PLAN).indexOf('"G"') === -1 &&
    JSON.stringify(LAB_PLAN).indexOf('"GO"') === -1 &&
    JSON.stringify(LAB_PLAN).indexOf('"ZK"') === -1 &&
    JSON.stringify(LAB_PLAN).indexOf('"UL"') === -1);
  ok("KHO2 и KO сняты с плана (у XKHO2 нет потребителя)",
    JSON.stringify(LAB_PLAN).indexOf("KHO2") === -1 &&
    JSON.stringify(LAB_PLAN).indexOf('"KO"') === -1);
  ok("L-цепочка снята целиком: LO/LHO2/XLHO2 не производятся нигде",
    JSON.stringify(LAB_PLAN).indexOf('"LO"') === -1 &&
    JSON.stringify(LAB_PLAN).indexOf("LHO2") === -1);
  ok("KH производится (первый реагент KH2O не остаётся без поставки)",
    ["E35S39"].some(r =>
      ["labs", "labs2", "labs3"].some(k =>
        [LAB_PLAN[r][k].recipeA, LAB_PLAN[r][k].recipeB].some(
          rec => rec.product === "KH"))));

  // Промежуточные пары — по разделу 5 плана.
  const pair = (room, key) =>
    LAB_PLAN[room][key].recipeA.product + "/" + LAB_PLAN[room][key].recipeB.product;
  // K-завод: KHO2 и KO сняты (XKHO2 не нужен ни одной роли), слот A тройки
  // labs отдан локальному производству XKH2O. KH2O варят labs2.A и labs3.B,
  // KH — labs.B, labs2.B и labs3.A.
  //
  // ПОЧЕМУ ПРОВЕРЯЕМ СТРУКТУРУ, А НЕ ПАРУ СЛОТОВ. Порядок рецептов ВНУТРИ
  // тройки — не косметика: лаборант наполняет реагентные лабы реагентами
  // ПРОЕКТИРУЕМОГО рецепта, а проекцией по умолчанию служит слот A. Пока
  // labs2 держал A = KH (K+H), он не мог начать KH2O: для B нужен OH в lab2, а
  // лаборант вёз туда H — тройка залипала в paused (живой shard3). Поэтому
  // инвариант: у производящей KH2O тройки KH2O стоит ПЕРВЫМ слотом, иначе
  // OH не попадёт ни в проекцию, ни в заявки сети.
  const produces = (room, key, rec, product) =>
    (rec === "A" ? LAB_PLAN[room][key].recipeA : LAB_PLAN[room][key].recipeB)
      .product === product;
  ok("E35S39: локальный XKH2O, KH2O первым слотом, KH — запасным",
    produces("E35S39", "labs", "A", "XKH2O") &&
    produces("E35S39", "labs", "B", "KH") &&
    produces("E35S39", "labs2", "A", "KH2O") &&
    produces("E35S39", "labs2", "B", "KH") &&
    produces("E35S39", "labs3", "A", "KH") &&
    produces("E35S39", "labs3", "B", "KH2O") &&
    LAB_PLAN.E35S39.labs.recipeA.reagent1 === "KH2O" &&
    LAB_PLAN.E35S39.labs.recipeA.reagent2 === "X" &&
    LAB_PLAN.E35S39.labs.recipeB.reagent1 === "K" &&
    LAB_PLAN.E35S39.labs.recipeB.reagent2 === "H" &&
    LAB_PLAN.E35S39.labs2.recipeA.reagent1 === "KH" &&
    LAB_PLAN.E35S39.labs2.recipeA.reagent2 === "OH");
  // Z-завод: O+H→OH переехал из labs2.A во второй слот (labs2.B), а первый слот
  // labs2 отдан производству XKH2O.
  ok("E36S38: ZO/ZHO2, XKH2O/OH, ZHO2/OH",
    pair("E36S38", "labs") === "ZO/ZHO2" &&
    pair("E36S38", "labs2") === "XKH2O/OH" &&
    pair("E36S38", "labs3") === "ZHO2/OH" &&
    LAB_PLAN.E36S38.labs2.recipeA.reagent1 === "KH2O" &&
    LAB_PLAN.E36S38.labs2.recipeA.reagent2 === "X" &&
    LAB_PLAN.E36S38.labs2.recipeB.reagent1 === "O" &&
    LAB_PLAN.E36S38.labs2.recipeB.reagent2 === "H");
  // E37S37 — Л-цепочка снята целиком: комната стала производителем XKH2O
  // (две тройки) и вдобавок варит OH и XUHO2.
  ok("E37S37: KH2O+X→XKH2O / OH, KH2O+X→XKH2O / OH, OH / UHO2+X→XUHO2",
    pair("E37S37", "labs") === "XKH2O/OH" &&
    pair("E37S37", "labs2") === "XKH2O/OH" &&
    pair("E37S37", "labs3") === "OH/XUHO2" &&
    LAB_PLAN.E37S37.labs.recipeA.reagent1 === "KH2O" &&
    LAB_PLAN.E37S37.labs.recipeA.reagent2 === "X" &&
    LAB_PLAN.E37S37.labs2.recipeA.product === "XKH2O" &&
    LAB_PLAN.E37S37.labs3.recipeB.reagent1 === "UHO2" &&
    LAB_PLAN.E37S37.labs3.recipeB.reagent2 === "X");
  // U-завод: O+H→OH переехал из labs3.A во второй слот (labs3.B), а первый слот
  // labs3 отдан производству XKH2O.
  ok("E37S38: UO/UHO2, ZO/ZHO2, XKH2O/OH",
    pair("E37S38", "labs") === "UO/UHO2" &&
    pair("E37S38", "labs2") === "ZO/ZHO2" &&
    pair("E37S38", "labs3") === "XKH2O/OH" &&
    LAB_PLAN.E37S38.labs3.recipeA.reagent1 === "KH2O" &&
    LAB_PLAN.E37S38.labs3.recipeA.reagent2 === "X" &&
    LAB_PLAN.E37S38.labs3.recipeB.reagent1 === "O" &&
    LAB_PLAN.E37S38.labs3.recipeB.reagent2 === "H");

  // Промежуточные буферы не одинаковы и меньше конечных (ТЗ §4).
  const highs = [];
  for (const room of ["E35S39", "E36S38", "E37S37", "E37S38"]) {
    for (const key of ["labs", "labs2", "labs3"]) {
      const slot = LAB_PLAN[room][key];
      if (slot.recipeA.product.indexOf("X") !== 0) highs.push(slot.highA);
      if (slot.recipeB.product.indexOf("X") !== 0) highs.push(slot.highB);
    }
  }
  ok("буферы промежуточных компонентов не одинаковые",
    new Set(highs).size > 3, JSON.stringify(highs));
  // OH — обязательный реагент всех верхних реакций (KH2O, ZHO2, UHO2), поэтому
  // его буфер самый крупный. Новый план: OH варится в E37S37 (labs.B, labs2.B и
  // labs3.A — три слота, потому что L-цепочка снята и комната освободилась),
  // в E36S38.labs2.B и в E37S38.labs3.B. В E35S39 OH больше не варится: её
  // тройки целиком отданы K-цепочке (KH2O — расходник четырёх комнат).
  const ohSlots = [];
  for (const room of Object.keys(LAB_PLAN)) {
    const plan = LAB_PLAN[room];
    for (const key of Object.keys(plan)) {
      const slot = plan[key];
      if (slot.recipeA.product === "OH") ohSlots.push({ room, key, slot, slotKey: "A" });
      if (slot.recipeB.product === "OH") ohSlots.push({ room, key, slot, slotKey: "B" });
    }
  }
  ok("OH варится минимум в четырёх слотах, включая основной (A)",
    ohSlots.length >= 4 && ohSlots.some(o => o.slotKey === "A"),
    ohSlots.map(o => o.room + "." + o.key + "." + o.slotKey).join(","));
  const ohMainHighs = ohSlots.map(o => (o.slotKey === "A" ? o.slot.highA : o.slot.highB));
  ok("OH — самый крупный промежуточный буфер",
    ohMainHighs.every(h => h === Math.max.apply(null, highs)),
    JSON.stringify(ohMainHighs));
  ok("все OH-слоты имеют одинаковый (самый крупный) буфер",
    new Set(ohMainHighs).size === 1,
    JSON.stringify(ohMainHighs));

  // Приоритеты бустов (ТЗ §5/§6).
  ok("LAB_BOOST включён", LAB_BOOST.ENABLED === true);
  ok("LAB_BOOST: 8 ролей, и все берут буст из комнаты (from: \"room\")",
    Object.keys(LAB_BOOST.BOOST_POLICY).length === 8 &&
      Object.keys(LAB_BOOST.BOOST_POLICY).every(role =>
        LAB_BOOST.BOOST_POLICY[role].length > 0 &&
        LAB_BOOST.BOOST_POLICY[role].every(row => row.from === "room")),
    Object.keys(LAB_BOOST.BOOST_POLICY).join(","));
  // Фактические значения LAB_BOOST (сверено с constants.js): резервы хаба
  // снижены под реальный расход ролей, резервы рабочей комнаты — её локальный
  // пол, объём одной поставки буста — 1000.
  ok("LAB_BOOST: резервы и объём отправки буста заданы",
    LAB_BOOST.HUB_RESERVE.XKH2O === 600 &&
      LAB_BOOST.HUB_RESERVE.XZHO2 === 1200 &&
      LAB_BOOST.HUB_RESERVE.XUHO2 === 300 &&
      LAB_BOOST.ROOM_RESERVE.XKH2O === 900 &&
      LAB_BOOST.ROOM_RESERVE.XZHO2 === 600 &&
      LAB_BOOST.ROOM_RESERVE.XUHO2 === 300 &&
      LAB_BOOST.BOOST_SHIP_AMOUNT === 1000,
    JSON.stringify([LAB_BOOST.HUB_RESERVE, LAB_BOOST.ROOM_RESERVE, LAB_BOOST.BOOST_SHIP_AMOUNT]));
  ok("Worker: XKH2O (CARRY) первым, XZHO2 (MOVE) вторым",
    LAB_BOOST.BOOST_POLICY.worker[0].resource === "XKH2O" &&
    LAB_BOOST.BOOST_POLICY.worker[1].resource === "XZHO2");
  ok("remoteMiner: XUHO2 (harvest) первым, XZHO2 вторым",
    LAB_BOOST.BOOST_POLICY.remoteMiner[0].resource === "XUHO2" &&
    LAB_BOOST.BOOST_POLICY.remoteMiner[1].resource === "XZHO2");
  ok("remoteHauler: XKH2O первым, XZHO2 вторым",
    LAB_BOOST.BOOST_POLICY.remoteHauler[0].resource === "XKH2O" &&
    LAB_BOOST.BOOST_POLICY.remoteHauler[1].resource === "XZHO2");
  ok("XUH2O (attack) не выдаётся никому: добычный буст — XUHO2",
    JSON.stringify(LAB_BOOST.BOOST_POLICY).indexOf("XUH2O") === -1);
  ok("XUHO2 не выдаётся обычным Worker",
    LAB_BOOST.BOOST_POLICY.worker.every(r => r.resource !== "XUHO2"));
  ok("боевые бусты не выдаются мирным ролям",
    ["worker", "harvester", "linkWorker"].every(role =>
      (LAB_BOOST.BOOST_POLICY[role] || []).every(r =>
        ["XKHO2", "XGHO2", "XLHO2"].indexOf(r.resource) === -1)));
  // Пороги сети: проверяем СОГЛАСОВАННОСТЬ, а не литералы. LAB_KEEP понижен
  // 3000 → 1000 по живому замеру (у производителя KH2O запас ровно 3000, и
  // излишек выше keep был нулевым, поэтому донор отбрасывался). Инвариант:
  // keep не больше одной поставки и не меньше минимальной отправки.
  ok("пороги терминальной сети согласованы",
    TERMINAL_NETWORK.LAB_REQUEST_BELOW === 3000 &&
    TERMINAL_NETWORK.LAB_SHIP_AMOUNT === 3000 &&
    TERMINAL_NETWORK.LAB_KEEP >= 1000 &&
    TERMINAL_NETWORK.LAB_KEEP <= TERMINAL_NETWORK.LAB_SHIP_AMOUNT,
    JSON.stringify({
      below: TERMINAL_NETWORK.LAB_REQUEST_BELOW,
      keep: TERMINAL_NETWORK.LAB_KEEP,
      ship: TERMINAL_NETWORK.LAB_SHIP_AMOUNT,
    }));
}

// ═══════════════════════════════════════════════════════════════════════
// B. Выбор рецепта: LOW → A, HIGH → B, дребезга нет
// ═══════════════════════════════════════════════════════════════════════

function testSelection() {
  section("B. lab.recipes.selectRecipe: дефицит, переключение, гистерезис");

  const cfg = LAB_PLAN.E35S37.labs; // XKH2O ↔ XZHO2: пороги берутся ИЗ ПЛАНА
  // Числа порогов в тесте не дублируются: цель финальных X-бустов — данные плана
  // и поднимается решением владельца (сейчас 8000 — резерв под будущие бусты,
  // см. комментарий к LAB_PLAN в constants.js). Проверяется СТРУКТУРА решения
  // (переключение по HIGH, возобновление по LOW), а не прибитые значения.
  const underA = cfg.lowA - 100;
  const underB = cfg.lowB - 100;
  const midA = Math.floor((cfg.lowA + cfg.highA) / 2);
  const midB = Math.floor((cfg.lowB + cfg.highB) / 2);
  const select = (active, a, b) =>
    recipes.selectRecipe({
      active,
      lowA: cfg.lowA,
      highA: cfg.highA,
      lowB: cfg.lowB,
      highB: cfg.highB,
      stock: slot => (slot === "A" ? a : b),
    });
  ok("A ниже LOW → варим A", select("A", underA, cfg.highB) === "A");
  ok("B ниже LOW → варим B", select("B", cfg.highA, underB) === "B");
  ok("первый запуск: дефицит A → A", select(undefined, 0, 0) === "A");
  ok("первый запуск: A насыщен, B дефицитен → B",
    select(undefined, cfg.highA, 0) === "B");

  ok("A достиг HIGH → переключение на B",
    select("A", cfg.highA, underB) === "B");
  ok("B достиг HIGH → возврат на A",
    select("B", underA, cfg.highB) === "A");
  // Между LOW и HIGH каждого слота — решения не меняются (дребезга нет).
  ok("продукт между LOW и HIGH → тройка не дёргается",
    select("A", midA, underB) === "A" && select("B", underA, midB) === "B");
  // Оба продукта на HIGH → решения нет: тройка ПРОСТАИВАЕТ (раньше она
  // продолжала варить активный продукт выше HIGH — так в E35S39 накопилось
  // 82 700 KO).
  ok("оба продукта на HIGH → тройка не варит (решения нет)",
    select("A", cfg.highA, cfg.highB) === null &&
      select("B", cfg.highA, cfg.highB) === null);

  // ── Простой и возобновление по LOW ───────────────────────────────────────
  ok("продукт ушёл ниже LOW → тройка возобновляет работу",
    select(null, underA, cfg.highB) === "A" &&
      select(null, cfg.highA, underB) === "B");
  ok("продукт между LOW и HIGH → простой продолжается (гистерезис)",
    select(null, midA, cfg.highB) === null &&
      select(null, cfg.highA, midB) === null);

  // ── СРОК ПРОСТОЯ (ТЗ владельца «лабы должны работать») ───────────────────
  // Гистерезис сам по себе давал ВЕЧНЫЙ простой: продукт внутри коридора
  // [LOW, HIGH] не расходится (бусты выключены) → ниже LOW не упадёт → тройка
  // не варит никогда. Живой shard3: 8 троек из 15 на паузе, у E35S37 XKH2O 1410
  // при цели 2500. Поэтому у простоя есть срок: простояв IDLE_RESUME_TICKS при
  // НЕДОСТИГНУТОЙ цели, тройка возобновляется (правило 3b в selectRecipe).
  const selectIdle = (idle, a, b) =>
    recipes.selectRecipe({
      active: undefined,
      lowA: cfg.lowA,
      highA: cfg.highA,
      lowB: cfg.lowB,
      highB: cfg.highB,
      stock: slot => (slot === "A" ? a : b),
      idleTicks: idle,
    });
  const IDLE = recipes.IDLE_RESUME_TICKS;
  ok("срок простоя не истёк → простой продолжается (гистерезис цел)",
    selectIdle(IDLE - 1, midA, cfg.highB) === null);
  ok("срок простоя истёк, цель НЕ достигнута → тройка возобновляет работу",
    selectIdle(IDLE, midA, cfg.highB) === "A");
  ok("срок простоя истёк, но цель достигнута → простой сохраняется",
    selectIdle(IDLE, cfg.highA, cfg.highB) === null);
  ok("дребезга нет: срок истёк, но сырья нет → простой сохраняется",
    recipes.selectRecipe({
      active: undefined,
      lowA: cfg.lowA,
      highA: cfg.highA,
      lowB: cfg.lowB,
      highB: cfg.highB,
      stock: slot => (slot === "A" ? midA : cfg.highB),
      idleTicks: IDLE,
      canRun: () => false,
    }) === null);

  // ── АНТИЗАЛИПАНИЕ: рецепт без сырья не удерживает тройку ────────────────
  // Живой дефект shard3: E35S37.labs3 переключился на XGHO2, когда GHO2 не
  // существовало нигде, и остался на нём НАВСЕГДА (XLHO2 при этом было 6220 при
  // цели 3000). Теперь рецепт, который не может вариться, не занимает тройку.
  const selectCan = (active, a, b, canA, canB) =>
    recipes.selectRecipe({
      active,
      lowA: cfg.lowA,
      highA: cfg.highA,
      lowB: cfg.lowB,
      highB: cfg.highB,
      stock: slot => (slot === "A" ? a : b),
      canRun: slot => (slot === "A" ? canA : canB),
    });
  // A не насыщен (2000 < highA 2500), B вариться не может → уходим на A.
  ok("активный рецепт без сырья + второй варится → переход на второй",
    selectCan("B", 2000, 0, true, false) === "A");
  ok("активный рецепт без сырья, а второй насыщен → простой (не залипаем)",
    selectCan("B", 3000, 0, true, false) === null &&
    selectCan("B", 500, 0, false, false) === null);
  ok("сырья нет ни для одного рецепта → тройка не варит",
    selectCan("A", 500, 500, false, false) === null);
  ok("активный рецепт варится и не насыщен → не переключаемся",
    selectCan("A", 500, 0, true, true) === "A");
  ok("насыщенный рецепт без сырья не варится, второй тоже без сырья → простой",
    selectCan("A", 3000, 0, false, false) === null);
  // Ключевой тест гистерезиса: пока A не добрал HIGH, тройка не уходит на B,
  // даже если B голоден.
  let flaps = 0;
  let active = "A";
  let a = cfg.lowA; // ровно на LOW
  let b = 0;
  for (let i = 0; i < 400; i++) {
    const snapshotA = a;
    const snapshotB = b;
    const next = select(active, snapshotA, snapshotB);
    if (next !== active) flaps++;
    active = next;
    if (active === "A") a += 5;
    else b += 5;
  }
  ok("дребезга нет: за 400 тиков не больше 4 переключений",
    flaps <= 4, "переключений: " + flaps);

  // Монотонный прогон: A стартует у самого порога, поэтому переключение
  // происходит ровно на достижении HIGH и без возвратов.
  const seq = [];
  active = "A";
  a = cfg.highA - 1; // ровно под порогом HIGH (2499 при highA 2500)
  b = 0;
  for (let i = 0; i < 3; i++) {
    const snapshotA = a;
    const snapshotB = b;
    active = select(active, snapshotA, snapshotB);
    seq.push(active);
    if (active === "A") a += 1;
    else b += 1;
  }
  ok("A у порога HIGH → ровно одно переключение, без дребезга",
    seq.join(",") === "A,B,B", seq.join(","));

  // Тот же прогон, но с запасом B выше LOW: смена происходит ровно тогда,
  // когда A добрал HIGH.
  const seq2 = [];
  active = "A";
  a = cfg.highA - 20; // 2480: до HIGH ровно два шага по +10
  b = cfg.lowB + 100; // B выше своего LOW, но далеко не на HIGH
  for (let i = 0; i < 6; i++) {
    const snapshotA = a;
    const snapshotB = b;
    active = select(active, snapshotA, snapshotB);
    seq2.push(active);
    if (active === "A") a += 10;
    else b += 10;
  }
  ok("A добирает HIGH → ровно одно переключение на B",
    seq2.join(",") === "A,A,B,B,B,B", seq2.join(","));

  // Возврат на A возможен строго после достижения HIGH у B.
  ok("B добрал HIGH и A ниже LOW → возврат на A",
    select("B", 100, 3000) === "A");
  // 800 < highB (1200), то есть B действительно не добрал HIGH.
  ok("B не добрал HIGH → тройка остаётся на B, даже если A голоден",
    select("B", 100, 800) === "B");

  ok("нет сырья → рецепт не выбирается на старте (ждём подвоза)",
    select(undefined, 0, 0) === "A" &&
    select(undefined, 3000, 0) === "B");
}

// ═══════════════════════════════════════════════════════════════════════
// C. Интеграция: Memory, lab.manager, lab.worker
// ═══════════════════════════════════════════════════════════════════════

function testIntegration() {
  section("C. Синхронизация Memory и запуск реакций");

  global.Memory = { rooms: {} };
  const room = makeRoom("E35S37");
  Memory.rooms.E35S37 = room.memory;
  nextTick();

  // Сырьё для обеих реакций первой тройки.
  setStock(room, "labs", "A", "KH2O", 100);
  setStock(room, "labs", "B", "X", 100);

  labManager.run(room);

  const labs = room.memory.labs;
  ok("рецепты записаны в Memory (recipeA/recipeB)",
    !!labs.recipeA && !!labs.recipeB);
  ok("пороги записаны в Memory",
    labs.lowA === 800 && labs.highA === 2500 && labs.lowB === 400 && labs.highB === 1200);
  ok("активный рецепт спроецирован в reagent1/reagent2/product",
    labs.active === "A" && labs.reagent1 === "KH2O" &&
    labs.reagent2 === "X" && labs.product === "XKH2O");

  // Пустые лаборатории: варить нечем, поэтому тройка на простое (paused), но
  // ПРОЕКЦИЯ реагентов обязана быть заполнена — именно её читает сеть, чтобы
  // знать, что везти (иначе тройка не начнёт варить никогда). При пустых
  // складах intended-рецепт — A (0 < lowA), поэтому проекция равна рецепту A.
  let cfg2 = room.memory.labs2;
  ok("вторая тройка спроецирована и на простое (нет сырья)",
    cfg2.paused === true && cfg2.active === undefined &&
    cfg2.reagent1 === "KH2O" && cfg2.reagent2 === "X" &&
    cfg2.product === "XKH2O" &&
    cfg2.recipeB.reagent1 === "UHO2" && cfg2.recipeB.product === "XUHO2");
  let cfg3 = room.memory.labs3;
  ok("третья тройка спроецирована и на простое (нет сырья)",
    cfg3.paused === true && cfg3.active === undefined &&
    cfg3.reagent1 === "UHO2" && cfg3.reagent2 === "X" &&
    cfg3.product === "XUHO2" &&
    cfg3.recipeB.product === "XZHO2");

  ok("реакция запущена ровно один раз за тик (одна тройка с сырьём)",
    reactions.length === 1, JSON.stringify(reactions));

  // ── Переключение по HIGH: A добрал запас, у B сырьё есть ──────────────
  // Рецепт B нового плана — ZHO2 + X, поэтому «сырьё для B» кладём именно в
  // lab1 (reagent1 = ZHO2); прежде там был KHO2 снятой реакции XKHO2.
  reactions.length = 0;
  setStock(room, "labs", "B", "KH2O", 100);
  labOf(room, "x_r1").store = new Store(3000, { XKH2O: 3000 }); // HIGH достигнут
  setStock(room, "labs", "A", "ZHO2", 100); // сырьё для B готово в lab1
  setStock(room, "labs", "B", "X", 100);

  nextTick();
  labManager.run(room);
  ok("A достиг HIGH → Memory переключилась на B",
    room.memory.labs.active === "B" && room.memory.labs.product === "XZHO2",
    room.memory.labs.active + "/" + room.memory.labs.product);
  ok("после переключения варится только B",
    reactions.length === 1 && reactions[0].indexOf("x_r1") >= 0,
    JSON.stringify(reactions));

  // ── Нет второго рецепта одновременно ─────────────────────────────────
  reactions.length = 0;
  labManager.run(room);
  ok("в одном тике тройка варит ровно один рецепт (не два)",
    reactions.length <= 1, JSON.stringify(reactions));

  // ── Надёжность: нет X ────────────────────────────────────────────────
  // Из lab2 убираем X (единственное, чего не хватает рецепту B = ZHO2 + X);
  // в lab2 для этого кладём не-X реагент, чтобы «пустой роли» не было.
  reactions.length = 0;
  nextTick();
  labOf(room, "lab2_r1").store = new Store(3000, {}); // X кончился
  setStock(room, "labs", "B", "ZHO2", 500);
  labManager.run(room);
  ok("нет X → реакции нет (тройка ждёт подвоза, без исключений)",
    reactions.length === 0);
  // Нет X → варить нечем (движку нужно ≥5 единиц реагента). Рецепт в Memory при
  // этом НЕ меняется: проекция остаётся B, поэтому сеть по-прежнему знает, что
  // везти в lab2, и тройка возобновится сразу после подвоза. Меняется только
  // решение — тройка уходит в простой (paused).
  ok("нет X: рецепт не переключился, но тройка ушла в простой",
    room.memory.labs.active === undefined && room.memory.labs.paused === true &&
    room.memory.labs.product === "XZHO2" &&
    room.memory.labs.reagent2 === "X");

  // ── Надёжность: нет первого реагента ─────────────────────────────────
  reactions.length = 0;
  nextTick();
  labOf(room, "lab1_r1").store = new Store(3000, {});
  labOf(room, "lab2_r1").store = new Store(3000, { X: 500 });
  labManager.run(room);
  ok("нет первого реагента → реакции нет", reactions.length === 0);

  // ── lab.worker: конфиги троек + буст-лаба ────────────────────────────
  const configs = labWorker.getConfigs(room);
  ok("lab.worker видит 3 тройки + буст-лабу",
    configs.length === 4 &&
    configs[0].key === "labs" &&
    configs[2].key === "labs3" &&
    configs[3].key === "boostLab",
    configs.map(c => c.key).join(","));
  ok("буст-лаба отдаёт свои ресурсы для сети и рынка",
    Array.isArray(configs[3].config.boost) &&
    configs[3].config.boost.indexOf("XKH2O") >= 0 &&
    configs[3].config.boost.indexOf("XZHO2") >= 0);

  // ── lab.worker не берёт неполные конфиги (буст-лаба) ─────────────────
  nextTick();
  const creep = makeWorkerCreep(room, "labWorker_E35S37_1", "labWorker");
  creep.memory.task = null;
  labWorker.run(creep);
  ok("labWorker не берёт буст-лабу как тройку",
    creep.memory.task === null || creep.memory.labKey !== "boostLab",
    String(creep.memory.task) + "/" + String(creep.memory.labKey));
}

// ── Крипы ────────────────────────────────────────────────────────────────
/**
 * @param {Object} room
 * @param {string} name
 * @param {string} role
 * @param {Object} [body]
 */
function makeWorkerCreep(room, name, role, body) {
  const creep = {
    name,
    my: true,
    spawning: false,
    room,
    memory: { role, homeRoom: room.name },
    body: body || [{ type: "carry" }, { type: "move" }],
    boosts: {},
    store: new Store(50, {}),
    pos: new RoomPosition(10, 10, room.name),
    say() {},
    travelTo() {
      this.travelCalls = (this.travelCalls || 0) + 1;
      return OK;
    },
    withdraw() {
      return OK;
    },
    transfer() {
      return OK;
    },
  };
  Game.creeps[name] = creep;
  return creep;
}

/** Комната с буст-лабой и складом для тестов boost.manager. */
function boostState(roomName, labStock, storeStock) {
  const room = Game.rooms[roomName];
  const lab = Game.getObjectById(room.memory.boostLab);
  lab.store = new Store(3000, labStock || {});
  room.storage.store = new Store(1000000, storeStock || {});
  room.terminal.store = new Store(300000, {});
  return {
    room,
    roomName,
    labs: [lab],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// D. Буст-лаба обычной комнаты
// ═══════════════════════════════════════════════════════════════════════

function testBoostLab() {
  section("D. boost.manager: boost-lab обычной комнаты");

  nextTick();
  const room = makeRoom("E36S38");
  Memory.rooms.E36S38 = room.memory;
  const state = boostState("E36S38", { XKH2O: 3000 }, {});

  // Крип у лабы — буст должен быть выдан.
  const creep = makeWorkerCreep(room, "worker_E36S38_1", "worker", [
    { type: "carry" }, { type: "carry" }, { type: "move" },
  ]);
  creep.pos = new RoomPosition(15, 10, "E36S38"); // рядом с лабой (16,10)
  creep.store = new Store(50, {});

  const busy = boostManager.run(state, creep);
  ok("крип у буст-лабы → буст выдан", busy === true && creep.lastBoost,
    JSON.stringify(creep.lastBoost));
  ok("буст XKH2O с ограничением частей (не больше частей крипа)",
    creep.lastBoost.labType === "XKH2O" && creep.lastBoost.amount === 2,
    JSON.stringify(creep.lastBoost));
  ok("задача буста снята после успеха", !creep.memory.boostTask);

  // Крип далеко — только идёт, буст не вызывается.
  nextTick();
  const far = makeWorkerCreep(room, "worker_E36S38_2", "worker", [
    { type: "carry" }, { type: "move" },
  ]);
  far.pos = new RoomPosition(1, 1, "E36S38");
  boostManager.run(state, far);
  ok("крип далеко → travelTo и никакого boost()",
    far.travelCalls === 1 && !far.boostCalls,
    far.travelCalls + "/" + String(far.boostCalls));
  ok("в памяти крипа стоит фаза буста",
    !!far.memory.boostTask && far.memory.boostTask.resource === "XKH2O");

  // Буст уже есть на крипе — второй раз не выдаём. Поле creep.boosts НЕ
  // выставляем: в живом движке его нет вовсе (typeof === "undefined"), признак
  // берётся из creep.body[].boost — так тест и проверяет.
  nextTick();
  const boosted = makeWorkerCreep(room, "worker_E36S38_3", "worker", [
    { type: "carry", boost: "XKH2O" }, { type: "move" },
  ]);
  boosted.pos = new RoomPosition(15, 10, "E36S38");
  delete boosted.boosts;
  const busy2 = boostManager.run(state, boosted);
  ok("крип уже с XKH2O: MOVE-буст доступен, но XKH2O не повторяется",
    !boosted.boostCalls || boosted.lastBoost.labType !== "XKH2O",
    JSON.stringify(boosted.lastBoost) + "/" + busy2);

  // Нет буста в комнате — крип не бустится и не залипает.
  nextTick();
  const empty = boostState("E36S38", {}, {});
  const hungry = makeWorkerCreep(room, "worker_E36S38_4", "worker", [
    { type: "carry" }, { type: "move" },
  ]);
  hungry.pos = new RoomPosition(15, 10, "E36S38");
  const busy3 = boostManager.run(empty, hungry);
  ok("буста нет в комнате → крип не залипает (управление не забрано)",
    busy3 === false && !hungry.boostCalls);
  ok("неудачная попытка отложена (boostWait)",
    hungry.memory.boostWait === Game.time + LAB_BOOST.RETRY_INTERVAL,
    String(hungry.memory.boostWait));

  // Буст ниже minStock не тратится.
  nextTick();
  const small = boostState("E36S38", { XKH2O: 100 }, {});
  const thrifty = makeWorkerCreep(room, "worker_E36S38_5", "worker", [
    { type: "carry" }, { type: "move" },
  ]);
  thrifty.pos = new RoomPosition(15, 10, "E36S38");
  ok("запас меньше minStock → буст не начинается",
    boostManager.run(small, thrifty) === false && !thrifty.boostCalls);

  // Буст-лаба не входит ни в одну производственную тройку комнаты.
  const boostId = room.memory.boostLab;
  let boostInTriple = false;
  for (const key of ["labs", "labs2", "labs3"]) {
    const c = room.memory[key];
    if (c.lab1 === boostId || c.lab2 === boostId || c.reactor === boostId)
      boostInTriple = true;
  }
  ok("буст-лаба не используется как производственная лаборатория",
    !boostInTriple);

  // Расход буста на часть тела — движковый LAB_BOOST_MINERAL = 30, а не 100.
  // Прежняя константа смешивала две величины («100 ЧАСТЕЙ можно бустить из
  // полной лабы» и «буста на часть») и завышала списание из storage в лабу и
  // порог выдачи (amount < cap * BOOST_PER_PART) в 3.33 раза.
  nextTick();
  const precise = boostState("E36S38", { XKH2O: 3000 }, {});
  const tenCarry = makeWorkerCreep(room, "worker_E36S38_6", "worker", []);
  tenCarry.body = [];
  for (let i = 0; i < 10; i++) tenCarry.body.push({ type: "carry" });
  tenCarry.pos = new RoomPosition(15, 10, "E36S38");
  boostManager.run(precise, tenCarry);
  ok("BOOST_PER_PART = 30 (движковый LAB_BOOST_MINERAL)",
    boostManager.BOOST_PER_PART === 30, String(boostManager.BOOST_PER_PART));
  // Крип рядом с лабой (XKH2O хватает) — проверяем именно константу расхода:
  // 10 CARRY × 30 = 300 единиц, а не 1000.
  ok("выдача на 10 частей укладывается в 300 единиц буста",
    precise.room.storage.store.XKH2O === undefined ||
      boostManager.available(precise, precise.room, precise.labs[0], "XKH2O", true) >= 300);

  // ── РЮКЗАК С ГРУЗОМ: списание ограничено свободным местом ────────────────
  // Живой дефект shard3 (реактор хаба стоял с 220 единицами XKH2O, а
  // Memory.__boostMetric по всем комнатам оставался "no stock"): Worker, который
  // везёт 300 энергии — его ОБЫЧНОЕ состояние, он живёт переноской, — просил
  // withdraw на 300 единиц буста, имея 200 свободных. Движок отвечает ERR_FULL,
  // память процедуры стирается, и буст не выдаётся НИКОГДА. Здесь движок
  // сымитирован точно: amount > свободного места → ERR_FULL.
  nextTick();
  const ladenRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = ladenRoom.memory;
  const ladenBoostLab = Game.getObjectById(ladenRoom.memory.boostLab);
  ladenBoostLab.store = new Store(3000, {});
  // Источник буста — РЕАКТОР тройки (как в живом хабе: продукт лежит в реакторе
  // до порога выгрузки LAB_WORKER.PRODUCT_UNLOAD_AT = 250 и в терминал не
  // попадает). Крип обязан видеть его так же, как терминал.
  const ladenSrcLab = labOf(ladenRoom, "t1x");
  ladenSrcLab.store = new Store(3000, { XKH2O: 400 });
  const ladenState = {
    room: ladenRoom,
    roomName: "E36S38",
    labs: [ladenBoostLab, ladenSrcLab],
  };

  // Рюкзак крипа — как в движке: getUsedCapacity(ресурс) возвращает количество
  // ИМЕННО этого ресурса (общий мок Store складывает всё вместе, из-за чего
  // ветка «крип уже везёт буст» проверялась бы неверно).
  const carrierStore = {
    energy: 300,
    // Свободного места МЕНЬШЕ комплекта строки политики (worker XKH2O parts 6 =
    // 180), иначе проверка ловила бы ограничение по parts, а не по рюкзаку.
    getFreeCapacity: () => 100,
    getUsedCapacity: (resource) =>
      resource === undefined ? 300 : carrierStore[resource] || 0,
    getCapacity: () => 500,
  };
  const carrier = makeWorkerCreep(ladenRoom, "worker_E36S38_cargo", "worker", []);
  carrier.body = [];
  for (let i = 0; i < 10; i++) carrier.body.push({ type: "carry" });
  carrier.store = carrierStore;
  carrier.pos = new RoomPosition(ladenSrcLab.pos.x, ladenSrcLab.pos.y, "E36S38");
  let withdrawn = null;
  carrier.withdraw = (target, resource, amount) => {
    withdrawn = amount;
    return amount > carrier.store.getFreeCapacity() ? ERR_FULL : OK;
  };

  ok("буст виден в реакторе тройки, а не только в терминале и складе",
    boostManager.available(ladenState, ladenRoom, ladenBoostLab, "XKH2O", true) === 400,
    String(boostManager.available(ladenState, ladenRoom, ladenBoostLab, "XKH2O", true)));

  boostManager.run(ladenState, carrier);
  ok("списание ограничено свободным рюкзаком (100, а не 180 — комплект строки)",
    withdrawn === 100,
    String(withdrawn));
  ok("процедура доставки не потеряна (ERR_FULL не стёр память)",
    carrier.memory.boostLab !== undefined &&
      carrier.memory.boostLab.labId === ladenBoostLab.id,
    JSON.stringify(carrier.memory.boostLab));


  // ═══ АВАРИЯ: БУСТ НЕ ДОЛЖЕН ОСТАВАТЬСЯ В РЮКЗАКЕ ════════════════════════
  // Живая авария: крип забирал буст, лаба его не принимала (занята другим
  // минералом) или процедуру бросал MAX_BUSY_TICKS — а ГРУЗ оставался в
  // рюкзаке. На момент аварии тело майнера было 5/3/5, то есть 3 CARRY = 150,
  // а комплект XUHO2 = 150: груз занимал весь объём, добыча вставала, линки не
  // наполнялись, спавны пустели. (Сейчас тело майнера 5/6/2 — 300 ёмкости;
  // сценарий ниже воспроизводит именно аварию, поэтому груз 150 и один CARRY.)
  nextTick();
  const busyRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = busyRoom.memory;
  const busyState = boostState("E36S38", { XKH2O: 3000 }, {});
  const busyLab = Game.getObjectById(busyRoom.memory.boostLab);
  busyLab.mineralType = "XKH2O"; // лаба занята ЧУЖИМ для miner бустом
  const busySrcLab = labOf(busyRoom, "t1x");
  busySrcLab.store = new Store(3000, { XUHO2: 3000 });
  // roomState.labs — ВСЕ лаборатории комнаты: без источника буста строка политики
  // не пройдёт проверку запаса, и до ветки «лаба занята» дело не дойдёт.
  busyState.labs = [busyLab, busySrcLab];
  const busyMiner = makeWorkerCreep(busyRoom, "miner_E36S38_busy", "miner", []);
  busyMiner.body = [{ type: "work" }, { type: "carry" }, { type: "move" }];
  busyMiner.pos = new RoomPosition(16, 9, "E36S38");
  let dropped = null;
  busyMiner.drop = res => { dropped = res; return OK; };
  busyMiner.store = new Store(50, { XUHO2: 30 }); // груз уже в рюкзаке
  const busyRun = boostManager.run(busyState, busyMiner);
  ok("лаба занята другим минералом → рейс не начинается, буст выброшен",
    busyRun === false && dropped === "XUHO2" && !busyMiner.memory.boostLab,
    String(busyRun) + "/" + dropped + "/" + JSON.stringify(busyMiner.memory.boostLab));
  ok("попытка отложена (boostWait), а не каждый тик",
    typeof busyMiner.memory.boostWait === "number",
    String(busyMiner.memory.boostWait));

  // ═══ РАЗДРОБЛЕННЫЙ ЗАПАС: СУММА ИСТОЧНИКОВ, А НЕ ПЕРВЫЙ НЕПУСТОЙ ════════
  // Живой дефект shard3: в E35S37 лежало 125 XKH2O в терминале и 160 + 170 в
  // реакторах троек (330), но available() возвращал запас ПЕРВОГО непустого
  // источника (терминал → 125) и останавливался, хотя docstring и MIN_STOCK
  // обещали сумму. Комната показывала "no stock" при minStock 150, имея 455
  // единиц ресурса, и не бустила НИКОГО. То же с XZHO2: 140 при пороге 150.
  nextTick();
  const fragRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = fragRoom.memory;
  const fragState = boostState("E36S38", {}, {});
  const fragLab = Game.getObjectById(fragRoom.memory.boostLab);
  fragState.room.terminal.store = new Store(300000, { XKH2O: 125 });
  const fragReactor = labOf(fragRoom, "t1x");
  fragReactor.store = new Store(3000, { XKH2O: 330 });
  // roomState.labs — это ВСЕ лаборатории комнаты (scanner), а не только буст-лаба:
  // именно по нему available() добирает запас из реакторов троек.
  fragState.labs = [fragLab, fragReactor];

  ok("запас суммируется по источникам (125 в терминале + 330 в реакторе)",
    boostManager.available(fragState, fragState.room, fragLab, "XKH2O", true) === 455,
    String(boostManager.available(fragState, fragState.room, fragLab, "XKH2O", true)));

  const fragCreep = makeWorkerCreep(fragRoom, "worker_E36S38_frag", "worker", []);
  fragCreep.body = [];
  for (let i = 0; i < 10; i++) fragCreep.body.push({ type: "carry" });
  fragCreep.pos = new RoomPosition(16, 9, "E36S38");
  const fragBusy = boostManager.run(fragState, fragCreep);
  ok("суммарный запас выше minStock → процедура буста НАЧАТА (не \"no stock\")",
    fragBusy === true && !!fragCreep.memory.boostTask,
    JSON.stringify(fragCreep.memory.boostTask) + "/" + fragBusy);

  // Порог обрывает обход: если лаба сама покрывает minStock, склады не читаются
  // (иначе сумма заставила бы платить за обход на каждом крипе).
  nextTick();
  const fastRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = fastRoom.memory;
  const fastState = boostState("E36S38", { XKH2O: 200 }, { XKH2O: 5000 });
  const fastLab = Game.getObjectById(fastRoom.memory.boostLab);
  const fastReactor = labOf(fastRoom, "t1x");
  fastReactor.store = new Store(3000, { XKH2O: 330 });
  fastState.labs = [fastLab, fastReactor];
  ok("minStock покрыт самой лабой → обход прекращён досрочно (200, а не 5530)",
    boostManager.available(fastState, fastState.room, fastLab, "XKH2O", true, 150) === 200,
    String(boostManager.available(fastState, fastState.room, fastLab, "XKH2O", true, 150)));
  ok("без порога available() отдаёт полную сумму (диагностический режим)",
    boostManager.available(fastState, fastState.room, fastLab, "XKH2O", true) === 5530,
    String(boostManager.available(fastState, fastState.room, fastLab, "XKH2O", true)));

  // ═══ СПИСАНИЕ НЕ БОЛЬШЕ ЗАПАСА ИСТОЧНИКА (нет шаттла «терминал ↔ лаба») ══
  // Живой дефект shard3 (E36S38): в терминале 15 XKH2O, в буст-лабе 30 (хватает
  // на часть тела). Крип просил у терминала 120 (4 части × 30): движок отвечает
  // ERR_NOT_ENOUGH_RESOURCES и частичной выдачи НЕ делает, память процедуры
  // стиралась, крип ходил «терминал ↔ буст-лаба» до MAX_BUSY_TICKS, в метрике
  // появлялось "boost abandoned", а 30 единиц в самой лабе не использовались.
  // lab.worker.js клампит объём и по src.store[…] — boost.manager теперь так же.
  nextTick();
  const shortRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = shortRoom.memory;
  const shortState = boostState("E36S38", { XKH2O: 30 }, {});
  const shortLab = Game.getObjectById(shortRoom.memory.boostLab);
  shortLab.mineralType = "XKH2O";
  shortState.room.terminal.store = new Store(300000, { XKH2O: 15 });
  labOf(shortRoom, "t1x").store = new Store(3000, {}); // источник — только терминал
  const fetcher = makeWorkerCreep(shortRoom, "worker_E36S38_short", "worker", []);
  fetcher.body = [];
  for (let i = 0; i < 10; i++) fetcher.body.push({ type: "carry" });
  fetcher.store = new Store(500, {});
  fetcher.pos = new RoomPosition(16, 9, "E36S38");
  const asked = [];
  fetcher.withdraw = function (target, resource, amount) {
    asked.push(amount);
    const stock = target.store[resource] || 0;
    if (amount > stock) return ERR_NOT_ENOUGH_RESOURCES; // как движок
    target.store[resource] = stock - amount;
    return OK;
  };
  let delivered = 0;
  fetcher.transfer = function (target, resource) {
    const amount = fetcher.store[resource] || 0;
    target.store[resource] = (target.store[resource] || 0) + amount;
    fetcher.store = new Store(500, {});
    delivered += amount;
    return OK;
  };

  boostManager.run(shortState, fetcher); // тик 1: буст выбран, крип идёт к терминалу
  fetcher.pos = new RoomPosition(1, 0, "E36S38"); // у терминала
  boostManager.run(shortState, fetcher); // тик 2: withdraw
  ok("списание ограничено запасом источника (15, а не 120)",
    asked.length === 1 && asked[0] === 15, JSON.stringify(asked));
  ok("память процедуры сохранена (ошибки списания нет)",
    !!fetcher.memory.boostLab, JSON.stringify(fetcher.memory.boostLab));

  fetcher.store = new Store(500, { XKH2O: 15 });
  fetcher.pos = new RoomPosition(16, 9, "E36S38"); // у буст-лабы
  boostManager.run(shortState, fetcher); // тик 3: transfer в лабу
  ok("принесённые 15 единиц отданы в лабу (30 → 45)",
    delivered === 15 && shortLab.store.XKH2O === 45,
    delivered + "/" + shortLab.store.XKH2O);

  const shortBusy = boostManager.run(shortState, fetcher); // тик 4: ресурса в комнате больше нет
  ok("нет добавки в комнате → буст выдан ИЗ ЛАБЫ, а не новый рейс (нет шаттла)",
    shortBusy === true && fetcher.boostCalls === 1 &&
      fetcher.lastBoost.labType === "XKH2O" && asked.length === 1,
    JSON.stringify(fetcher.lastBoost) + "/" + JSON.stringify(asked));
  ok("успешная выдача помечена в метрике",
    Memory.__boostMetric.E36S38 === "boosted XKH2O",
    String(Memory.__boostMetric.E36S38));

  // ═══ УЖЕ ВЫДАННЫЙ БУСТ СЧИТАЕТСЯ ПО ТЕЛУ (в движке НЕТ creep.boosts) ════
  // Проверено на живом shard3: typeof creep.boosts === "undefined" даже у крипа с
  // четырьмя бустнутыми частями XKH2O. Прежние проверки `creep.boosts && …` были
  // ложными ВСЕГДА, поэтому бустнутый крип каждый тик заново выбирал свою строку
  // политики и выходил по cap = 0 — без троттлинга boostWait (живой linkWorker в
  // E35S39: boostWait = 0 при 4/4 частях). Метка при этом писалась как "no stock",
  // хотя дефицита не было вовсе.
  nextTick();
  const doneRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = doneRoom.memory;
  const doneState = boostState("E36S38", { XKH2O: 3000 }, {});
  const doneLab = Game.getObjectById(doneRoom.memory.boostLab);
  doneLab.mineralType = "XKH2O";
  const doneCreep = makeWorkerCreep(doneRoom, "linkWorker_E36S38_done", "linkWorker", []);
  doneCreep.body = [];
  for (let i = 0; i < 4; i++) doneCreep.body.push({ type: "carry", boost: "XKH2O" });
  doneCreep.pos = new RoomPosition(16, 9, "E36S38");
  delete doneCreep.boosts; // как в живом движке
  const doneBusy = boostManager.run(doneState, doneCreep);
  ok("квота строки закрыта (4/4 CARRY) → буст не повторяется",
    doneBusy === false && !doneCreep.boostCalls, String(doneCreep.boostCalls));
  ok("попытка отложена (boostWait) — нет перебора политики каждый тик",
    typeof doneCreep.memory.boostWait === "number",
    String(doneCreep.memory.boostWait));
  ok("все квоты политики закрыты → метка \"бусты выданы\", а не \"no stock\"",
    Memory.__boostMetric.E36S38 === "бусты выданы",
    String(Memory.__boostMetric.E36S38));

  // Частичный буст (движок отвечает ERR_NOT_ENOUGH_RESOURCES и выдаёт меньше
  // запрошенного) обязан ДОТЯГИВАТЬСЯ до квоты строки, а не считаться выданным.
  nextTick();
  const partRoom = makeRoom("E36S38");
  Memory.rooms.E36S38 = partRoom.memory;
  const partState = boostState("E36S38", { XKH2O: 3000 }, {});
  const partLab = Game.getObjectById(partRoom.memory.boostLab);
  partLab.mineralType = "XKH2O";
  const partCreep = makeWorkerCreep(partRoom, "worker_E36S38_part", "worker", []);
  partCreep.body = [];
  for (let i = 0; i < 10; i++)
    partCreep.body.push(i < 3 ? { type: "carry", boost: "XKH2O" } : { type: "carry" });
  partCreep.pos = new RoomPosition(16, 9, "E36S38");
  delete partCreep.boosts;
  const partBusy = boostManager.run(partState, partCreep);
  // Квота строки политики (parts у worker XKH2O) меняется вместе с телом, а
  // крип несёт 10 бустных частей, из которых 3 уже бустнуты → остаток 7.
  const wantParts = LAB_BOOST.BOOST_POLICY.worker.find(
    r => r.resource === "XKH2O",
  ).parts;
  ok("частичный буст (3 из 10 частей) дотягивается до квоты строки",
    partBusy === true && partCreep.boostCalls === 1 &&
      partCreep.lastBoost.amount === Math.min(wantParts, 7),
    JSON.stringify(partCreep.lastBoost) + " vs " + Math.min(wantParts, 7));
}

// ═══════════════════════════════════════════════════════════════════════
// E. Приоритеты XUHO2 / XKH2O по ролям
// ═══════════════════════════════════════════════════════════════════════

function testPriorities() {
  section("E. Приоритеты бустов: remoteMiner XUHO2, remoteHauler XKH2O");

  nextTick();
  const room = makeRoom("E35S37");
  Memory.rooms.E35S37 = room.memory;

  // remoteMiner: XUHO2 (harvest 7) должен выдаваться первым (WORK-буст на 10 частей).
  const state = boostState("E35S37", { XUHO2: 3000, XZHO2: 3000 }, {});
  const minerBody = [];
  for (let i = 0; i < 10; i++) minerBody.push({ type: "work" });
  for (let i = 0; i < 6; i++) minerBody.push({ type: "move" });

  const miner = makeWorkerCreep(room, "remoteMiner_E35S37_1", "remoteMiner", minerBody);
  miner.pos = new RoomPosition(18, 9, "E35S37"); // рядом с буст-лабой (19,9)
  boostManager.run(state, miner);
  ok("remoteMiner получает XUHO2 (harvest) первым приоритетом",
    miner.lastBoost && miner.lastBoost.labType === "XUHO2",
    JSON.stringify(miner.lastBoost));

  nextTick();
  const haulerState = boostState("E35S37", { XKH2O: 3000, XZHO2: 3000 }, {});
  const haulerBody = [];
  for (let i = 0; i < 20; i++) haulerBody.push({ type: "carry" });
  for (let i = 0; i < 20; i++) haulerBody.push({ type: "move" });
  const hauler = makeWorkerCreep(room, "remoteHauler_E35S37_1", "remoteHauler", haulerBody);
  hauler.pos = new RoomPosition(18, 9, "E35S37");
  boostManager.run(haulerState, hauler);
  ok("remoteHauler получает XKH2O (CARRY) первым приоритетом",
    hauler.lastBoost && hauler.lastBoost.labType === "XKH2O",
    JSON.stringify(hauler.lastBoost));

  // XUHO2 обычному Worker не выдаётся: этого ресурса нет в его политике.
  // Лаборатория держит энергию и ОДИН тип минерала за раз (как в движке), а тип
  // буста движок берёт ИЗ ЛАБЫ (creep.boost(lab, bodyPartsCount) — ресурс не
  // параметр). Поэтому проверка честная: в лабе лежит ТОЛЬКО XUHO2 — Worker не
  // должен ни буститься, ни тратить его.
  nextTick();
  const workerState = boostState("E35S37", { XUHO2: 3000 }, {});
  const plain = makeWorkerCreep(room, "worker_E35S37_1", "worker", [
    { type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" },
  ]);
  plain.pos = new RoomPosition(18, 9, "E35S37");
  boostManager.run(workerState, plain);
  ok("XUHO2 не расходуется на обычного Worker",
    !plain.boostCalls && workerState.labs[0].store.XUHO2 === 3000,
    JSON.stringify(plain.lastBoost || null) +
      " / XUHO2 в лабе: " + workerState.labs[0].store.XUHO2);

  // Атакующий (боевой крип) вообще не в политике.
  nextTick();
  const attacker = makeWorkerCreep(room, "attacker_E35S37_1", "attacker", [
    { type: "ranged_attack" }, { type: "move" },
  ]);
  attacker.pos = new RoomPosition(18, 9, "E35S37");
  ok("боевой крип boost.manager не трогает",
    boostManager.run(boostState("E35S37", { XKHO2: 3000 }, {}), attacker) === false &&
    !attacker.boostCalls);

  // Буст вне своей комнаты не начинается.
  nextTick();
  const away = makeWorkerCreep(room, "worker_E35S37_2", "worker", [
    { type: "carry" }, { type: "move" },
  ]);
  away.room = { name: "E35S36" };
  away.pos = new RoomPosition(10, 10, "E35S36");
  ok("в удалённой комнате буст не начинается",
    boostManager.run(boostState("E35S37", { XKH2O: 3000 }, {}), away) === false &&
    !away.boostCalls);

  // Выключатель Memory.labBoostOff.
  nextTick();
  Memory.labBoostOff = true;
  const off = makeWorkerCreep(room, "worker_E35S37_3", "worker", [
    { type: "carry" }, { type: "move" },
  ]);
  off.pos = new RoomPosition(18, 9, "E35S37");
  ok("Memory.labBoostOff выключает бусты",
    boostManager.run(boostState("E35S37", { XKH2O: 3000 }, {}), off) === false);
  delete Memory.labBoostOff;
}

// ═══════════════════════════════════════════════════════════════════════
// F. Терминальная сеть: буст-лаба в local-запасе, пороги не тронуты
// ═══════════════════════════════════════════════════════════════════════

function testTerminalNetwork() {
  section("F. terminalNetwork: готовый буст учитывается в буст-лабе");

  nextTick();
  const room = makeRoom("E37S37");
  Memory.rooms.E37S37 = room.memory;
  boostState("E37S37", { XKH2O: 500 }, {});

  const info = terminalNetwork.resourceInLabs(room, "XKH2O");
  ok("resourceInLabs видит буст в буст-лабе", info === 500, String(info));

  // Продукты обеих реакций тройки тоже учитываются как локальный запас.
  setStock(room, "labs2", "A", "G", 700);
  nextTick();
  const g = terminalNetwork.resourceInLabs(room, "G");
  ok("resourceInLabs видит продукт неактивного рецепта (G в labs2)", g === 700, String(g));

  // Буст-лаба не превращается в «свою реакцию» (иначе терминал не отдаст буст).
  ok("ресурсы буст-лабы не считаются реагентом комнаты",
    terminalNetwork.roomUsesReagent(room, "XKH2O") === false);
}

// ═══════════════════════════════════════════════════════════════════════
// G. Существующий Task System не тронут
// ═══════════════════════════════════════════════════════════════════════

function testTaskSystemIntact() {
  section("G. Task System сохранён");

  const taskManager = require("../task.manager");
  const executors = require("../task.executors");

  // Порядок обновлён вместе с правкой приоритетов (разбор «фабрика = доход,
  // апгрейд/стройка не цель»): фабрика сразу после жизнеобеспечения, развитие —
  // в хвост. Набор категорий и их число при этом не менялись — проверки ниже это
  // и стерегут, а строка порядка служит защитой от НЕОСОЗНАННОЙ перестановки.
  const chain = [
    "fillSpawnsExtensions", "collectFactoryBattery", "fillFactoryEnergy",
    "fillTowers", "fillTerminalResources", "fillPowerSpawnEnergy",
    "fillPowerSpawnPower", "repairStructures", "fillTerminalEnergy",
    "buildStructures", "upgradeController",
  ];

  let chainOk = true;
  for (let i = 0; i < chain.length; i++) {
    if (taskManager.TASK_CHAIN[i] !== chain[i]) chainOk = false;
  }
  ok("TASK_CHAIN соответствует объявленному порядку", chainOk,
    taskManager.TASK_CHAIN.join(","));
  ok("новая категория задач не добавлена (лаборатории работают вне Task System)",
    taskManager.TASK_CHAIN.length === chain.length);
  ok("реестр executors не изменён (11 категорий)",
    Object.keys(executors.executors).length === 11,
    String(Object.keys(executors.executors).length));

  // labManager по-прежнему не пишет в очередь задач комнаты.
  nextTick();
  const room = makeRoom("E35S39");
  Memory.rooms.E35S39 = room.memory;
  Memory.rooms.E35S39.tasks = {};
  labManager.run(room);
  ok("labManager не создаёт Tasks",
    Object.keys(room.memory.tasks).length === 0,
    JSON.stringify(Object.keys(room.memory.tasks)));
}

// ═══════════════════════════════════════════════════════════════════════
// H. lab.worker: реагент можно взять из лаборатории той же комнаты
// ═══════════════════════════════════════════════════════════════════════

function testLabSource() {
  section("H. lab.worker: источник реагента — терминал, склад или другая лаба");

  nextTick();
  const room = makeRoom("E35S37");
  Memory.rooms.E35S37 = room.memory;

  // Лаборатория третьей тройки. Ресурс для проверок findSource берём
  // произвольный (LHO2 в новом плане уже не производится и не потребляется
  // никем — findSource работает с любым ресурсом).
  const lab1r3 = labOf(room, "lab1_r3");

  // Синхронизируем конфиги с планом: reagent1/reagent2/product заполняет
  // labManager (lab.recipes.sync) — до этого в Memory только recipeA/recipeB.
  labManager.run(room);
  const KH2O = room.memory.labs.reagent1;
  ok("labManager синхронизировал активный реагент", KH2O === "KH2O", String(KH2O));

  // 1. Склады пусты, реагент лежит в лаборатории той же комнаты.
  room.storage.store = new Store(1000000, {});
  room.terminal.store = new Store(300000, {});
  lab1r3.store = new Store(3000, { LHO2: 900 });

  const found = labWorker.findSource(room, "LHO2", null);
  ok("реагент найден в лаборатории той же комнаты", found === lab1r3,
    found ? found.id : "null");

  // 2. Лаборатория-получатель не может быть источником сама себе.
  const selfOnly = labWorker.findSource(room, "LHO2", lab1r3);
  ok("цель не берётся источником своего же реагента", selfOnly === null,
    selfOnly ? selfOnly.id : "null");

  // 3. Терминал и склад приоритетнее лабораторий.
  room.storage.store = new Store(1000000, { LHO2: 5000 });
  ok("склад приоритетнее лабораторий",
    labWorker.findSource(room, "LHO2", null) === room.storage);
  room.terminal.store = new Store(300000, { LHO2: 2000 });
  ok("терминал приоритетнее склада",
    labWorker.findSource(room, "LHO2", null) === room.terminal);

  // 4. Внутрикомнатный перенос попадает в задачу labWorker: XZHO2 нужен
  //    тройке labs2, но лежит он в лаборатории третьей тройки (для неё XZHO2 —
  //    не реагент, а буст, поэтому она его не «очищает»), а склады пусты.
  //    До правки lab.worker такой реагент для комнаты «не существовал»: тройка
  //    стояла пустой, хотя сырьё лежало в двух клетках от неё.
  nextTick();
  room.storage.store = new Store(1000000, {});
  room.terminal.store = new Store(300000, {});
  lab1r3.store = new Store(3000, { XZHO2: 3000 });
  labOf(room, "lab1_r2").store = new Store(3000, {}); // labs2.lab1 пуст, ждёт ZHO2
  labOf(room, "lab2_r2").store = new Store(3000, {});
  labOf(room, "lab2_r3").store = new Store(3000, {});
  labOf(room, "lab1_r1").store = new Store(3000, {
    [room.memory.labs.reagent1]: 3000,
  });

  // 4. Исполнитель задачи довозит реагент из лаборатории-источника. Задачу
  //    ставим сами (как это делает ветка выбора задачи) и проверяем, что
  //    действие выполняется именно с лабораторией-источником: крип уходит к
  //    ней, а не вызывает withdraw «в молоко» из любой точки комнаты.
  const targetLab = labOf(room, "lab1_r2");
  const withdraws = [];
  const loadCreep = name => {
    const c = makeWorkerCreep(room, name, "labWorker");
    // Рюкзак не пуст (энергия), но нужного реагента в нём нет — именно так
    // выглядит рейс за реагентом: ветка защиты от «пустого» крипа в
    // lab.worker.run (она сбрасывает задачу) не срабатывает.
    c.store = new Store(500, { energy: 100 });
    c.memory.task = "load_lab1";
    c.memory.resource = "ZHO2";
    c.memory.sourceId = lab1r3.id;
    c.memory.targetId = targetLab.id;
    c.memory.labKey = "labs2";
    c.memory.amount = 500;
    c.withdraw = function (target, resource, amount) {
      withdraws.push({
        id: target && target.id,
        resource: resource,
        amount: amount,
      });
      // Как движок: ресурс реально переезжает в рюкзак крипа (иначе labWorker
      // следующим вызовом увидит пустого крипа и сбросит задачу — эта ветка
      // защиты от «пустого» крипа проверяется отдельно в lab.worker.test.js).
      c.store[resource] = (c.store[resource] || 0) + (amount || 100);
      return OK;
    };
    return c;
  };

  // Далеко от источника — только движение.
  const away = loadCreep("labWorker_E35S37_srcA");
  away.pos = new RoomPosition(10, 10, room.name);
  labWorker.run(away);
  if (process.env.DBG) {
    console.log("   DBG away: w=" + withdraws.length + " t=" + away.travelCalls +
      " mem=" + JSON.stringify(away.memory) + " pos=" + away.pos.x + "," + away.pos.y);
  }
  ok("крип едет в лабораторию-источник, а не withdraw «в молоко»",
    withdraws.length === 0 && away.travelCalls > 0,
    JSON.stringify({ w: withdraws, t: away.travelCalls, mem: away.memory }) +
      " src=" + lab1r3.id + " tgt=" + targetLab.id);

  // Рядом с источником — забирает из нужной лаборатории нужный ресурс.
  const near = loadCreep("labWorker_E35S37_srcB");
  near.pos = lab1r3.pos;
  if (process.env.DBG) {
    console.log("   DBG near before: mem=" + JSON.stringify(near.memory) +
      " sameAsAway=" + (near.memory === away.memory) +
      " store=" + JSON.stringify(near.store));
  }
  labWorker.run(near);
  if (process.env.DBG) console.log("   DBG near after: w=" + withdraws.length +
    " keys=" + Object.keys(near.memory).join(",") +
    " mem=" + JSON.stringify(near.memory));
  ok("у источника забирает из лаборатории-источника нужный ресурс",
    withdraws.length === 1 &&
    withdraws[0].id === lab1r3.id &&
    withdraws[0].resource === "ZHO2",
    JSON.stringify({ n: withdraws.length, w: withdraws, t: near.travelCalls, mem: near.memory }) + " src=" + lab1r3.id + " tgt=" + targetLab.id);
}

// ═══════════════════════════════════════════════════════════════════════
// I. Приоритетная доставка компонентов финального производства
// ═══════════════════════════════════════════════════════════════════════

/**
 * Мир секции I: пять производственных комнат, у E35S37 нет ни одного
 * промежуточного компонента (как на живом shard3 25.09.2026: KH2O = 0 при
 * 7400 KH2O в терминале E35S39), у доноров компонент лежит в терминале.
 */
function finalHubWorld() {
  nextTick();
  resetSent();
  Game.rooms = {};
  Memory.rooms = {};

  const rooms = {};
  for (const name of ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"]) {
    const room = makeRoom(name);
    rooms[name] = room;
    Memory.rooms[name] = room.memory;
    room.terminal.store[RESOURCE_ENERGY] = 200000;
    room.storage.store[RESOURCE_ENERGY] = 200000;
    labManager.run(room);
  }

  // E35S37 — финальные тройки, компонентов нет вовсе.
  rooms.E35S37.terminal.store = new Store(300000, {
    [RESOURCE_ENERGY]: 200000,
  });

  // E35S39 — K-цепочка и свой XKH2O (labs.A): KH2O расходуется ЕЮ ЖЕ, поэтому
  // свыше LAB_KEEP она отдаёт излишек — 5000 − 3000 = 2000 донорской поставки.
  rooms.E35S39.terminal.store = new Store(300000, {
    [RESOURCE_ENERGY]: 200000,
    KH2O: 5000,
  });

  // E36S38 — Z-завод: базовый минерал K в излишке (кандидат на обычную
  // балансировку), но у E35S37 нет нужды в K.
  rooms.E36S38.terminal.store = new Store(300000, {
    [RESOURCE_ENERGY]: 200000,
    K: 50000,
    O: 50000,
  });

  // E37S37 — третий излишек: LHO2 (в новом плане не производится и никем не
  // потребляется, поэтому на приоритетные заявки не влияет — проверки секции
  // опираются на KH2O/K/X).
  rooms.E37S37.terminal.store = new Store(300000, {
    [RESOURCE_ENERGY]: 200000,
    LHO2: 5000,
  });

  return rooms;
}

function resetSent() {
  SENT.length = 0;
}

function sentTo(roomName) {
  return SENT.filter(s => s.to === roomName);
}

function testPriorityDelivery() {
  section("I. Приоритетная доставка компонентов в E35S37");

  // Комната-финишёр определяется данными LAB_PLAN, а не именем. Новый план:
  // XKH2O (или другой X-буст) выпускают ВСЕ пять комнат плана, поэтому
  // «комнаты-завода без финальной тройки» в LAB_PLAN больше нет.
  ok("isFinalHub(E35S37) — комната финальных X-бустов",
    recipes.isFinalHub("E35S37") === true);
  ok("isFinalHub: финальные X-тройки есть во всех пяти комнатах плана",
    ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"].every(
      r => recipes.isFinalHub(r) === true) &&
      recipes.isFinalHub("E99S99") === false);
  // Новый план: X-тройки стоят во всех пяти комнатах, поэтому набор
  // приоритетных компонентов — ровно реагенты X-реакций:
  // X, KH2O, ZHO2 (MOVE) и UHO2 (harvest). LHO2 ушёл вместе с L-цепочкой.
  const pc = recipes.priorityCompounds();
  ok("приоритетные компоненты — ровно X и три реагента финальных троек (KH2O, ZHO2, UHO2)",
    pc.X === true && pc.KH2O === true && pc.ZHO2 === true && pc.UHO2 === true &&
      Object.keys(pc).sort().join(",") === "KH2O,UHO2,X,ZHO2",
    JSON.stringify(Object.keys(pc)));
  ok("LHO2 больше не приоритетный компонент (L-цепочка E37S37 снята)",
    pc.LHO2 !== true);
  ok("базовый минерал K приоритетным компонентом не является",
    recipes.priorityCompounds().K !== true);

  // Реагент X-тройки ниже своего LOW → самый высокий уровень (3): финальная
  // реакция уже встала, такая заявка уходит первой.
  ok("KH2O с нулевым запасом у финишёра → уровень 3",
    recipes.priorityLevel("E35S37", "KH2O", 0) === 3,
    String(recipes.priorityLevel("E35S37", "KH2O", 0)));
  // Другой финальный компонент: X нужен ВСЕМ финальным реакциям, поэтому при
  // нулевом запасе это тоже острый дефицит (уровень 3).
  ok("X с нулевым запасом у финишёра → уровень 3",
    recipes.priorityLevel("E35S37", "X", 0) === 3,
    String(recipes.priorityLevel("E35S37", "X", 0)));
  ok("компонент хаба выше своего LOW → уровень 2 (буфер цел)",
    recipes.priorityLevel("E35S37", "KH2O", 2000) === 2,
    String(recipes.priorityLevel("E35S37", "KH2O", 2000)));
  ok("продукт хаба (XZHO2) приоритетом доставки не пользуется",
    recipes.priorityLevel("E35S37", "XZHO2", 0) === 0,
    String(recipes.priorityLevel("E35S37", "XZHO2", 0)));
  // Новый план сделал E35S39 производителем XKH2O (labs.A = KH2O+X), поэтому её
  // KH2O — реагент ЕЁ ЖЕ финальной реакции: при нуле это острый дефицит (3), а
  // не «завод без приоритета» (прежнее ожидание 0 устарело).
  ok("KH2O у второй X-комнаты (E35S39) при нулевом запасе — уровень 3",
    recipes.priorityLevel("E35S39", "KH2O", 0) === 3,
    String(recipes.priorityLevel("E35S39", "KH2O", 0)));
  // Следствие нового плана (факт, не пожелание): базовый минерал K не входит в
  // Базовый минерал K не входит в priorityCompounds (он не реагент ни одной
  // X-реакции), но в комнате, которая его РАСХОДУЕТ, он обязан получать
  // уровень 1: обычная балансировка требует энергии терминала-донора
  // ≥ TERMINAL_SUPPLY.ENERGY_MIN (100 000), а на живом shard3 терминалы стоят
  // на 44–77k — с уровнем 0 сырьё не уехало бы НИКОГДА (это был бы регресс от
  // появления финальных троек в каждой комнате). Где K не расходуется —
  // приоритета нет.
  ok("базовый минерал получает уровень 1 в комнате, которая его расходует",
    recipes.priorityLevel("E35S39", "K", 0) === 1 &&
      recipes.priorityLevel("E35S37", "K", 0) === 0,
    String(recipes.priorityLevel("E35S39", "K", 0)) + "/" +
      String(recipes.priorityLevel("E35S37", "K", 0)));
  ok("реагент финальной реакции обгоняет базовый минерал",
    recipes.priorityLevel("E35S37", "KH2O", 0) >
      recipes.priorityLevel("E35S39", "K", 0));

  // ── 1. Финишёр получает дефицитный компонент, а не «кто меньше по запасу» ──
  const rooms = finalHubWorld();
  const hubTerminal = rooms.E35S37.terminal;

  terminalNetwork.run();
  const toHub = sentTo("E35S37");
  // КОНТРАКТ ИЗМЕНЁН ОСОЗНАННО (ТЗ владельца «ЗАПУСТИТЬ ЛАБЫ — ВСЕ»): за тик
  // допускается до TERMINAL_NETWORK.LAB_SENDS_PER_TICK лаб-поставок, а не одна.
  // Причина — живой замер 25.09.2026: 11 из 15 троек стояли без сырья, которое
  // в империи ЕСТЬ, но в другой комнате (O/H/X), и один рейс в тик на пять
  // комнат был единственным каналом подвоза.
  ok("за тик от одной до LAB_SENDS_PER_TICK лаб-поставок",
    SENT.length >= 1 && SENT.length <= TERMINAL_NETWORK.LAB_SENDS_PER_TICK,
    JSON.stringify(SENT));
  ok("первой едет KH2O — реагент активной финальной реакции E35S37",
    toHub.length >= 1 && toHub[0].resourceType === "KH2O",
    JSON.stringify(SENT));
  ok("донор — комната с запасом KH2O (E35S39)",
    toHub.length >= 1 && toHub[0].from === "E35S39",
    JSON.stringify(SENT));
  // E35S39 тоже варит XKH2O (labs.A = KH2O+X), поэтому KH2O — её СОБСТВЕННЫЙ
  // реагент: донор обязан оставить себе LAB_KEEP и отдаёт только излишек выше
  // него. Объём одной поставки ограничен LAB_SHIP_AMOUNT, поэтому фактическая
  // отправка = min(LAB_SHIP_AMOUNT, запас − LAB_KEEP).
  const expectedSent = Math.min(
    TERMINAL_NETWORK.LAB_SHIP_AMOUNT,
    5000 - TERMINAL_NETWORK.LAB_KEEP,
  );
  ok("донор отдал излишек выше своего резерва LAB_KEEP",
    toHub.length >= 1 && toHub[0].amount === expectedSent,
    JSON.stringify(SENT) + " vs " + expectedSent);
  // Поставок в хаб за тик может быть несколько (до лимита), поэтому проверяем
  // не «ровно одна», а «ровно столько, сколько доехало».
  ok("запас KH2O у финишёра равен сумме доехавших поставок (не меньше одной)",
    (hubTerminal.store.KH2O || 0) ===
      toHub.reduce((sum, s) => sum + s.amount, 0) &&
      (hubTerminal.store.KH2O || 0) >= expectedSent,
    String(hubTerminal.store.KH2O) + " " + JSON.stringify(toHub));
  // Донор отдаёт не больше излишка выше LAB_KEEP: остаток не опускается ниже
  // своего резерва, сколько бы поставок за тик он ни сделал.
  ok("донор KH2O в E35S39 не опустился ниже своего резерва LAB_KEEP",
    (rooms.E35S39.terminal.store.KH2O || 0) >= TERMINAL_NETWORK.LAB_KEEP &&
      (rooms.E35S39.terminal.store.KH2O || 0) <= 5000,
    String(rooms.E35S39.terminal.store.KH2O));

  // ── 2. Обычное балансирование не блокирует поставку лабам ────────────────
  const rooms2 = finalHubWorld();
  terminalNetwork.run();

  // K больше не «остаётся на месте», и это не регресс: E35S39.labs.B = K+H→KH,
  // то есть K — РЕАГЕНТ её тройки, поэтому он уезжает ЛАБ-ПОСТАВКОЙ (у неё
  // приоритет выше обычной балансировки), а не балансировкой. Проверяем именно
  // это: за тик не больше лимита лаб-поставок, и K уходит только тому, кто его
  // расходует, — «обычная балансировка в очередь не встала».
  ok("K уехал как реагент тройки (в E35S39), а не обычной балансировкой",
    SENT.every(s => s.resourceType !== "K" || s.to === "E35S39") &&
      SENT.length <= TERMINAL_NETWORK.LAB_SENDS_PER_TICK,
    JSON.stringify(SENT));
  ok("первая отправка тика ушла компоненту лаб, а не балансировке",
    SENT.length >= 1 && SENT[0].resourceType === "KH2O",
    JSON.stringify(SENT));
  ok("X у E35S37 не израсходован отправкой K",
    (rooms2.E35S37.terminal.store.X || 0) === 0,
    String(rooms2.E35S37.terminal.store.X));

  // ── 3. Реагент из терминала, а не подмена порогов сети ───────────────────
  ok("порог заявки LAB_REQUEST_BELOW не менялся (3000)",
    TERMINAL_NETWORK.LAB_REQUEST_BELOW === 3000,
    String(TERMINAL_NETWORK.LAB_REQUEST_BELOW));
  ok("резерв энергии терминала-донора цел (>= ENERGY_MIN)",
    (rooms2.E35S39.terminal.store[RESOURCE_ENERGY] || 0) > 100000,
    String(rooms2.E35S39.terminal.store[RESOURCE_ENERGY]));

  // ── 4. Журнал лаборатории-получателя: приоритет виден в отправке ─────────
  // После первой поставки KH2O финишёр просит следующий дефицитный компонент
  // (второй реагент финальной тройки — X), а не базовый минерал: приоритет —
  // свойство реагента финальной реакции, не одного ресурса.
  // X в мире фикстуры не лежал нигде, поэтому заявку хаба на X невозможно было
  // выполнить и тик забирала обычная балансировка (K → E35S39, который теперь
  // тоже нужен заводу: E35S39.labs.B = K+H→KH). Кладём X соседу — иначе
  // проверка «первым уходит компонент финального производства» вырождена.
  resetSent();
  rooms2.E35S39.terminal.store.KH2O = 3000; // донор KH2O израсходован
  rooms2.E36S38.terminal.store.X = 5000; // есть чем закрыть дефицит X у хаба
  Game.time++;
  global._terminalLabs = undefined;
  global._labPlan = undefined;
  for (const name of ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"]) {
    labManager.run(Game.rooms[name]);
  }
  terminalNetwork.run();
  // До лимита отправок за тик хаб обязан кормиться ПЕРВЫМ, а обычная
  // балансировка (K) не должна занимать слот.
  ok("следующей уходит другой компонент финального производства в хаб, а не K",
    SENT.length >= 1 &&
      SENT[0].to === "E35S37" &&
      SENT.every(s => s.resourceType !== "K"),
    JSON.stringify(SENT));

  // ── 4b. Фактическое состояние shard3 25.09.2026: у E35S37 нет KH2O, ZHO2 и
  //        LHO2, а в терминалах соседей есть все три. Внутри приоритета порядок
  //        прежний — «у кого запас меньше»: первым уезжает самый дефицитный
  //        компонент (KH2O: 0 против 0, но у X уже есть 3000 в labs2, поэтому
  //        X не конкурирует по have). Остальные уезжают в следующих тиках —
  //        одна отправка за тик это принцип архитектуры, а не временный лимит.
  const rooms4 = finalHubWorld();
  rooms4.E35S37.terminal.store = new Store(300000, { [RESOURCE_ENERGY]: 200000 });
  rooms4.E35S39.terminal.store.KH2O = 4000; // выше LAB_KEEP, есть что отдать
  rooms4.E37S37.terminal.store.LHO2 = 5000;
  // X у финишёра уже лежит в labs2 — реакция не голодает по второму реагенту.
  const xLab = Game.getObjectById(rooms4.E35S37.memory.labs2.lab2);
  xLab.store = new Store(3000, { X: 3000 });
  resetSent();
  Game.time++;
  global._terminalLabs = undefined;
  global._labPlan = undefined;
  for (const name of ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"]) {
    labManager.run(Game.rooms[name]);
  }
  terminalNetwork.run();
  ok("реагент, которого у финишёра нет, довозится из соседней комнаты",
    sentTo("E35S37").length >= 1, JSON.stringify(SENT));
  ok("первым уезжает самый дефицитный компонент финального производства (KH2O)",
    SENT.length >= 1 && SENT[0].resourceType === "KH2O",
    JSON.stringify(SENT));
  ok("K уезжает только расходующей его комнате (E35S39), а не «кому надо»",
    SENT.every(s => s.resourceType !== "K" || s.to === "E35S39"),
    JSON.stringify(SENT));

  // ── 5. Одна успешная отправка за тик при НЕСКОЛЬКИХ приоритетных заявках ─
  const rooms3 = finalHubWorld();
  // Опустошаем обе донорские комнаты по второму компоненту, чтобы приоритетных
  // заявок стало больше одной.
  rooms3.E35S39.terminal.store.LHO2 = 5000;
  rooms3.E37S37.terminal.store.KH2O = 5000;
  resetSent();
  Game.time++;
  global._terminalLabs = undefined;
  global._labPlan = undefined;
  for (const name of ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"]) {
    labManager.run(Game.rooms[name]);
  }
  terminalNetwork.run();
  ok("при нескольких приоритетных заявках отправок не больше лимита за тик",
    SENT.length >= 1 && SENT.length <= TERMINAL_NETWORK.LAB_SENDS_PER_TICK,
    JSON.stringify(SENT));
  // НОВЫЙ ИНВАРИАНТ вместо «одна отправка за тик»: получатель не становится
  // донором в ТОМ ЖЕ тике, иначе ресурс уезжает «туда и обратно» (в отладке
  // 25.09.2026 видели ровно это: KH2O E35S39→E35S37 3000 и сразу
  // E35S37→E37S37 3000).
  const receivedRooms = new Set(SENT.map(s => s.to));
  ok("получатель не отправляет в том же тике (нет «перекати-поля»)",
    SENT.every(s => !receivedRooms.has(s.from)),
    JSON.stringify(SENT));
  ok("первая отправка ушла именно в E35S37",
    SENT.length >= 1 && SENT[0].to === "E35S37",
    JSON.stringify(SENT));

  // ── 6. Энергия терминала-донора ниже приоритетного пола ─────────────────
  // Факт shard3 (25.09.2026): энергия терминалов 6.8–26.5k при прежнем пороге
  // TERMINAL_SUPPLY.ENERGY_MIN = 100 000, который структурно недостижим — его
  // не поднимает даже fillTerminalEnergy (включается только при Storage выше
  // 195k). С прежним порогом финальные реагенты не уезжали НИКОГДА.
  // ENERGY_MIN понижен до 10000 (= PRIORITY_ENERGY_FLOOR), поэтому ниже пола
  // остаётся только приоритетный обход — его здесь и проверяем.
  const rooms5 = finalHubWorld();
  rooms5.E35S39.terminal.store[RESOURCE_ENERGY] = 65000; // выше ENERGY_MIN, но проверка ниже — по факту отправки
  const donorTerm = rooms5.E35S39.terminal;
  const hubTerm = rooms5.E35S37.terminal;
  resetSent();
  Game.time++;
  global._terminalLabs = undefined;
  global._labPlan = undefined;
  for (const name of ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"]) {
    labManager.run(Game.rooms[name]);
  }
  terminalNetwork.run();
  ok("приоритетная поставка проходит при энергии терминала ниже ENERGY_MIN",
    SENT.length >= 1 && SENT[0].from === "E35S39" && SENT[0].to === "E35S37",
    JSON.stringify(SENT) + " termE=" + donorTerm.store[RESOURCE_ENERGY]);
  ok("комиссия списана, энергия донора не ушла в ноль",
    (donorTerm.store[RESOURCE_ENERGY] || 0) < 65000 &&
      (donorTerm.store[RESOURCE_ENERGY] || 0) >=
        TERMINAL_NETWORK.PRIORITY_ENERGY_FLOOR,
    String(donorTerm.store[RESOURCE_ENERGY]));
  ok("запас KH2O у финишёра вырос",
    (hubTerm.store.KH2O || 0) > 0, String(hubTerm.store.KH2O));

  // ── 6-бис. Энергопол терминала-донора: обычная отправка тоже проходит ────
  // СЕМАНТИКА ИЗМЕНЕНА ОСОЗНАННО (правка приоритетов + разбор терминала).
  // Прежнее ожидание «обычная отправка при 65000 энергии запрещена» опиралось на
  // TERMINAL_SUPPLY.ENERGY_MIN = 100000 и было выбрано как «прежний порог,
  // резерв не отменён». Но этот порог делал терминал НЕДОСТИЖИМЫМ донором для
  // всей обычной логистики: balanceEnergy требовал terminalEnergy > 100000 +
  // MIN_SEND_AMOUNT, а живая энергия терминалов 6.8–26.5k (замер в
  // docs/SESSION_HANDOFF.md). То есть обычная балансировка ресурсов не
  // отправляла НИЧЕГО, и межкомнатный обмен держался только на приоритетном
  // обходе. ENERGY_MIN понижен до 10000 — ровно к PRIORITY_ENERGY_FLOOR и
  // MARKET.BUY_ENERGY_FLOOR: энергопол теперь ОДИН на три механизма.
  // Здесь проверяем обе стороны нового контракта: выше пола — обычная отправка
  // проходит, ниже пола — по-прежнему нет (резерв как таковой не отменён,
  // изменилось только его число).
  donorTerm.store.LHO2 = 2000; // есть что отдавать
  donorTerm.store[RESOURCE_ENERGY] = TERMINAL_SUPPLY.ENERGY_MIN + 1000;
  const aboveFloorFit = terminalNetwork.fitSendAmount(
    donorTerm,
    "E35S37",
    "LHO2",
    1000,
    false,
  );
  ok("обычная отправка выше энергопола донора проходит",
    aboveFloorFit > 0, String(aboveFloorFit));

  donorTerm.store[RESOURCE_ENERGY] = TERMINAL_SUPPLY.ENERGY_MIN - 1000;
  const belowFloorFit = terminalNetwork.fitSendAmount(
    donorTerm,
    "E35S37",
    "LHO2",
    1000,
    false,
  );
  donorTerm.store[RESOURCE_ENERGY] = TERMINAL_SUPPLY.ENERGY_MIN + 1000;
  const lowEnergyFitPriority = terminalNetwork.fitSendAmount(
    donorTerm,
    "E35S37",
    "LHO2",
    1000,
    true,
  );
  ok("ниже энергопола донора отправка по-прежнему запрещена",
    belowFloorFit === 0, String(belowFloorFit));
  ok("приоритетная отправка при той же энергии разрешена",
    lowEnergyFitPriority > 0, String(lowEnergyFitPriority));

  // Энергия как ресурс приоритетом не «разблокируется»: отдавать её до нуля
  // нельзя ни при каком приоритете.
  donorTerm.store[RESOURCE_ENERGY] = TERMINAL_SUPPLY.ENERGY_MIN - 1000;
  const energyFitPriority = terminalNetwork.fitSendAmount(
    donorTerm,
    "E35S37",
    RESOURCE_ENERGY,
    100000,
    true,
  );
  ok("приоритет не разрешает отправку энергии ниже ENERGY_MIN",
    energyFitPriority === 0, String(energyFitPriority));
}

// ═══════════════════════════════════════════════════════════════════════
// J. Bootstrap буст-лабы: Memory восстанавливается автоматически
// ═══════════════════════════════════════════════════════════════════════

function testBoostLabBootstrap() {
  section("J. boostLab: автоматическое восстановление после пустой Memory");

  // ── 1. Пустая Memory (Global Reset) → запись восстанавливается сама ──────
  nextTick();
  Game.rooms = {};
  Memory.rooms = {};
  const room = makeRoom("E35S39");
  Memory.rooms.E35S39 = room.memory;
  delete room.memory.boostLab; // как после Global Reset

  ok("конфигурация комнаты описывает буст-лабу",
    typeof LAB_BOOST.BOOST_LAB.E35S39 === "string",
    String(LAB_BOOST.BOOST_LAB.E35S39));

  labManager.run(room);
  ok("boostLab восстановлен автоматически, без консольной команды",
    room.memory.boostLab === LAB_BOOST.BOOST_LAB.E35S39,
    String(room.memory.boostLab));
  ok("восстановлен именно ID из конфигурации комнаты",
    room.memory.boostLab === "6a04f673229481eaebe0dba0",
    String(room.memory.boostLab));
  ok("лаборатория с этим ID реально существует в комнате",
    Game.getObjectById(room.memory.boostLab) === WORLD.objects[LAB_BOOST.BOOST_LAB.E35S39],
    String(room.memory.boostLab));

  // ── 2. Существующее корректное значение не затирается ───────────────────
  nextTick();
  const manualId = "E35S39:t3x"; // лаборатория комнаты, не занятая буст-лаб
  room.memory.boostLab = manualId;
  labManager.run(room);
  ok("существующая запись сохранена (ручная привязка в силе)",
    room.memory.boostLab === manualId,
    String(room.memory.boostLab));

  // ── 3. Запись не создаётся, если буст-лабы нет в конфигурации комнаты ────
  nextTick();
  Game.rooms = {};
  Memory.rooms = {};
  const other = makeRoom("E35S39");
  Memory.rooms.E35S39 = other.memory;
  delete other.memory.boostLab;
  // Конфигурация комнаты без буст-лабы — как у комнаты вне BOOST_LAB.
  const savedBoost = LAB_BOOST.BOOST_LAB.E35S39;
  delete LAB_BOOST.BOOST_LAB.E35S39;
  try {
    labManager.run(other);
    ok("для комнаты без буст-лабы в конфигурации запись не создаётся",
      other.memory.boostLab === undefined,
      String(other.memory.boostLab));
    ok("лаборатории комнаты не заняты «на всякий случай»",
      WORLD.objects["E35S39:boost"].store !== undefined);
  } finally {
    LAB_BOOST.BOOST_LAB.E35S39 = savedBoost;
  }

  // ── 4. Запись не создаётся, пока тройки не привязаны к лабораториям ──────
  nextTick();
  Game.rooms = {};
  Memory.rooms = {};
  const fresh = makeRoom("E37S38");
  Memory.rooms.E37S38 = fresh.memory;
  delete fresh.memory.boostLab;
  // Пустая Memory: тройки ещё не настроены, слоты неизвестны.
  delete fresh.memory.labs;
  delete fresh.memory.labs2;
  delete fresh.memory.labs3;
  labManager.run(fresh);
  ok("без привязки троек буст-лаба не занимает чужую лабораторию",
    fresh.memory.boostLab === undefined,
    String(fresh.memory.boostLab));

  // ── 5. Буст-лаба не крадёт лабораторию тройки ───────────────────────────
  nextTick();
  const occupied = makeRoom("E37S38");
  Memory.rooms.E37S38 = occupied.memory;
  delete occupied.memory.boostLab;
  // Все три тройки настроены — bootstrap обязан взять свободную лабораторию.
  labManager.run(occupied);
  const bootstrapId = occupied.memory.boostLab;
  let usedByTriple = false;
  for (const key of ["labs", "labs2", "labs3"]) {
    const c = occupied.memory[key];
    if (!c) continue;
    if (c.lab1 === bootstrapId || c.lab2 === bootstrapId || c.reactor === bootstrapId)
      usedByTriple = true;
  }
  ok("автоматически выбранная буст-лаба не входит ни в одну тройку",
    !!bootstrapId && !usedByTriple,
    String(bootstrapId) + "/" + usedByTriple);

  // ── 6. Восстановление видно потребителям того же тика ───────────────────
  nextTick();
  Game.rooms = {};
  Memory.rooms = {};
  const hub = makeRoom("E35S37");
  Memory.rooms.E35S37 = hub.memory;
  delete hub.memory.boostLab;
  labManager.run(hub);
  const configs = labWorker.getConfigs(hub);
  ok("labWorker.getConfigs сразу видит восстановленную буст-лабу",
    configs.some(c => c.key === "boostLab"),
    JSON.stringify(configs.map(c => c.key)));
  ok("ресурсы буст-лабы учитываются как локальный запас комнаты",
    terminalNetwork.resourceInLabs(hub, "XKH2O") ===
      (WORLD.objects[hub.memory.boostLab].store.XKH2O || 0));
}

// ═══════════════════════════════════════════════════════════════════════
// K. Привязка троек: починка по координатам LAB_BINDING
// ═══════════════════════════════════════════════════════════════════════

function testBindingRepair() {
  section("K. ensureTriples: привязка троек починяется по координатам");

  // Живой дефект shard3: E35S37.labs3 был связан с ТЕМИ ЖЕ лабораториями, что
  // labs (30,12 / 32,12 / 31,12), а лаборатории 23,9 / 21,9 / 22,9 не
  // использовались ничем. У хаба оставалось две тройки вместо трёх.
  nextTick();
  Game.rooms = {};
  Memory.rooms = {};
  const room = makeRoom("E35S37");
  Memory.rooms.E35S37 = room.memory;

  // room.find нужен ТОЛЬКО для починки: отдаём лаборатории комнаты с их
  // реальными координатами (как scanner в игре).
  room.find = (type, opts) => {
    const all = Object.keys(WORLD.objects)
      .map(id => WORLD.objects[id])
      .filter(l => l.pos && l.pos.roomName === room.name);
    return opts && opts.filter ? all.filter(opts.filter) : all;
  };

  const { LAB_BINDING } = require("../constants");
  const labAtCoords = (coords) =>
    Object.keys(WORLD.objects).find(id => {
      const l = WORLD.objects[id];
      return (
        l.pos &&
        l.pos.roomName === room.name &&
        l.pos.x === coords[0] &&
        l.pos.y === coords[1]
      );
    });

  // Портим привязку ровно как в живом Memory: labs3 = labs.
  room.memory.labs3.lab1 = room.memory.labs.lab1;
  room.memory.labs3.lab2 = room.memory.labs.lab2;
  room.memory.labs3.reactor = room.memory.labs.reactor;

  labManager.run(room);

  const b = LAB_BINDING.E35S37;
  ok("labs перепривязан на свои координаты (23,9 / 21,9 / 22,9)",
    room.memory.labs.lab1 === labAtCoords(b.labs[0]) &&
    room.memory.labs.lab2 === labAtCoords(b.labs[1]) &&
    room.memory.labs.reactor === labAtCoords(b.labs[2]),
    JSON.stringify(room.memory.labs));
  ok("labs3 перепривязан на свои координаты (30,12 / 32,12 / 31,12)",
    room.memory.labs3.lab1 === labAtCoords(b.labs3[0]) &&
    room.memory.labs3.lab2 === labAtCoords(b.labs3[1]) &&
    room.memory.labs3.reactor === labAtCoords(b.labs3[2]),
    JSON.stringify(room.memory.labs3));
  ok("тройки больше не используют одни и те же лаборатории",
    room.memory.labs.lab1 !== room.memory.labs3.lab1 &&
    room.memory.labs2.lab1 !== room.memory.labs3.lab1);
  // Новый план E35S37.labs3: A = UHO2+X→XUHO2 (300/1200), B = ZHO2+X→XZHO2
  // (400/1200) — highB упал с 5000 до 1200.
  ok("рецепты и пороги после починки на месте (sync отработал)",
    room.memory.labs3.recipeB.product === "XZHO2" &&
    room.memory.labs3.recipeB.reagent1 === "ZHO2" &&
    room.memory.labs3.highB === 1200 &&
    room.memory.labs3.highA === 1200,
    JSON.stringify(room.memory.labs3.recipeB));

  // Корректная привязка не трогается: второй проход ничего не меняет.
  const snapshot = JSON.stringify([
    room.memory.labs.lab1, room.memory.labs3.reactor,
  ]);
  nextTick();
  labManager.run(room);
  ok("корректная привязка не переписывается повторно",
    JSON.stringify([room.memory.labs.lab1, room.memory.labs3.reactor]) === snapshot);
}

// ═══════════════════════════════════════════════════════════════════════
// L. Реакция требует LAB_REACTION_AMOUNT (5), простой не варит
// ═══════════════════════════════════════════════════════════════════════

function testReactionGuard() {
  section("L. lab.manager: порог 5 единиц реагента и простой тройки");

  nextTick();
  Game.rooms = {};
  Memory.rooms = {};
  const room = makeRoom("E35S37");
  Memory.rooms.E35S37 = room.memory;

  // Живой факт shard3: в E35S37.labs лежало KH2O 500 и X 4 — реакция XKH2O не
  // запускалась НИКОГДА, потому что движку нужно ≥5 единиц каждого реагента.
  setStock(room, "labs", "A", "KH2O", 500);
  setStock(room, "labs", "B", "X", 4);
  reactions.length = 0;
  labManager.run(room);
  ok("4 единицы X (< LAB_REACTION_AMOUNT) → реакция не запускается",
    reactions.length === 0, JSON.stringify(reactions));

  setStock(room, "labs", "B", "X", 5);
  reactions.length = 0;
  nextTick();
  labManager.run(room);
  ok("5 единиц X (ровно LAB_REACTION_AMOUNT) → реакция идёт",
    reactions.length === 1 && reactions[0].indexOf("x_r1") >= 0,
    JSON.stringify(reactions));

  // Простой: продукт набран → реакция не идёт, но проекция реагентов остаётся.
  labOf(room, "x_r1").store = new Store(3000, { XKH2O: 3000 });
  reactions.length = 0;
  nextTick();
  labManager.run(room);
  // КОНТРАКТ ИЗМЕНЁН ОСОЗНАННО (ТЗ владельца «ЗАПУСТИТЬ ЛАБЫ — ВСЕ»): план
  // по-прежнему уводит тройку в простой (paused = true — «продукт насыщен»), но
  // пауза больше НЕ запрещает реакцию: пока реагенты лежат в lab1/lab2, тройка
  // варит. Именно этого не хватало живым E36S38.labs (Z 2815 + O 2570 при ZO
  // выше HIGH) и E37S38.labs2 — они стояли при готовом сырье.
  ok("продукт на HIGH → тройка в простое (paused), но с сырьём ВАРИТ",
    reactions.length === 1 && room.memory.labs.paused === true,
    JSON.stringify(reactions) + " paused=" + room.memory.labs.paused);
  // Проекция на простое не пустая и указывает на план тройки: intended-рецепт
  // (тот, что варился бы при наличии сырья) здесь B — продукт B (XZHO2) равен 0,
  // а продукт A (XKH2O) уже на HIGH. Без проекции сеть не знала бы, что везти, и
  // тройка не возобновилась бы никогда.
  ok("на простое проекция реагентов сохранена (сеть знает, что везти)",
    room.memory.labs.reagent1 === "ZHO2" &&
    room.memory.labs.reagent2 === "X" &&
    room.memory.labs.product === "XZHO2",
    JSON.stringify({
      r1: room.memory.labs.reagent1,
      r2: room.memory.labs.reagent2,
      p: room.memory.labs.product,
    }));

  // Возобновление: продукт ушёл ниже LOW → снова варим.
  labOf(room, "x_r1").store = new Store(3000, { XKH2O: 100 });
  reactions.length = 0;
  nextTick();
  labManager.run(room);
  ok("продукт ниже LOW → тройка возобновляет реакцию",
    reactions.length === 1 && room.memory.labs.paused === false,
    JSON.stringify(reactions) + " paused=" + room.memory.labs.paused);

  // КРИТИЧНО: простаивающая тройка обязана ПОЛУЧАТЬ реагенты — именно подвоз и
  // выводит её из простоя (selectRecipe возобновляет работу по canRun, то есть
  // по фактическому наличию реагентов в lab1/lab2). Запрет загрузки для paused
  // запирал бы тройку в простое навсегда.
  nextTick();
  labOf(room, "lab1_r1").store = new Store(3000, {});
  labOf(room, "lab2_r1").store = new Store(3000, {});
  labOf(room, "x_r1").store = new Store(3000, {});
  labManager.run(room);
  ok("реагентов нет и продукт пуст → тройка в простое ждёт подвоза",
    room.memory.labs.paused === true,
    String(room.memory.labs.paused));
  setStock(room, "labs", "A", "KH2O", 10);
  setStock(room, "labs", "B", "X", 10);
  const creep = makeWorkerCreep(room, "labWorker_E35S37_guard", "labWorker");
  creep.memory.task = null;
  room.terminal.store.KH2O = 3000;
  room.terminal.store.X = 3000;
  labWorker.run(creep);
  ok("labWorker по-прежнему снабжает реагентами простаивающую тройку",
    creep.memory.task === "load_lab1" || creep.memory.task === "load_lab2" ||
      creep.memory.task === "clear_lab",
    String(creep.memory.task) + "/" + String(creep.memory.labKey));
}

// ── Запуск ───────────────────────────────────────────────────────────────
testPlan();
testSelection();
testIntegration();
testBoostLab();
testPriorities();
testTerminalNetwork();
testTaskSystemIntact();
testLabSource();
testPriorityDelivery();
testBoostLabBootstrap();
testBindingRepair();
testReactionGuard();

console.log("\n" + "=".repeat(60));
console.log("ПРОЙДЕНО: " + passed + ", ПРОВАЛЕНО: " + failed);
if (failed > 0) {
  console.log("\nПровалы:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
