"use strict";
/**
 * ===================================================
 * LAB.AUTOIMPORT.TEST.JS — автоматическая закупка реагентов лаб
 * ===================================================
 * ТЗ владельца: «если чего-то не хватает для лаб — и нет во всех комнатах —
 * автоматически закупаем». Реализация:
 *   - lab.recipes.requiredReagents() выводит набор реагентов и плановый резерв
 *     из LAB_PLAN (а не из ручного списка в market.manager);
 *   - market.manager.runLabImport() покупает ресурс, если запас ВСЕЙ империи
 *     (Storage + Terminal + лаборатории) ниже резерва, и кладёт его в терминал
 *     комнаты-потребителя.
 *
 * Проверяется:
 *   1. requiredReagents: резерв = сумма LOW по тройкам, внутри тройки — МАКСИМУМ
 *      из слотов, а не сумма (тройка варит один слот за раз);
 *   2. shouldBuyLabImport: порог/цель от резерва, полы MIN_LOW/MIN_HIGH,
 *      гистерезис (ниже порога — покупаем, выше — нет), потолок сделки;
 *   3. сквозная закупка: UHO2 нет ВО ВСЕХ комнатах → покупается дешёвый ордер
 *      и ложится в терминал комнаты-потребителя; журнал Memory.__labBuys;
 *   4. «нет во всех комнатах» = запас по ИМПЕРИИ: ресурс в любой комнате выше
 *      порога отменяет закупку, даже если у потребителя ноль;
 *   5. ресурсы с курируемыми порогами (X_PURCHASE, MARKET.IMPORT: O/Z/H/U и
 *      готовые бусты) автозаккупка НЕ трогает — их ведёт прежний механизм;
 *   6. без настроенных троек в Memory автозаккупка не запускается вовсе;
 *   7. ценовые предохранители: абсолютный LAB_IMPORT.MAX_PRICE и относительный
 *      MAX_BUY_PRICE_RATIO;
 *   8. обход по кругу: за запуск проверяется не больше MAX_RESOURCES_PER_RUN
 *      ресурсов, и «первый в списке» не съедает проверку навсегда;
 *   9. общий лимит сделок MAX_DEALS_PER_TICK соблюдается.
 *
 * Запуск: node tests/lab.autoimport.test.js
 */

global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.OK = 0;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_ARGS = -10;
global.ERR_TIRED = -11;
global.ERR_FULL = -8;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.Memory = { rooms: {} };

const { MARKET, X_PURCHASE, LAB_PLAN } = require("../constants");
const labRecipes = require("../lab.recipes");
const marketManager = require("../market.manager");

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

// ── Изоляция плана ──────────────────────────────────────────────────────
// Сценарии подменяют LAB_PLAN на короткий эталонный план, чтобы закупка была
// детерминированной (в реальном плане десяток ресурсов и обход по кругу).
// Исходный план возвращается на выходе: файл не должен менять конфиг.
const SAVED_PLAN = {};
for (const name of Object.keys(LAB_PLAN)) {
  SAVED_PLAN[name] = LAB_PLAN[name];
}
function restorePlan() {
  for (const name of Object.keys(LAB_PLAN)) delete LAB_PLAN[name];
  for (const name of Object.keys(SAVED_PLAN)) LAB_PLAN[name] = SAVED_PLAN[name];
}
process.on("exit", restorePlan);

function setPlan(plan) {
  restorePlan();
  for (const name of Object.keys(LAB_PLAN)) delete LAB_PLAN[name];
  for (const name of Object.keys(plan)) LAB_PLAN[name] = plan[name];
  // Кэш резервов привязан к тику: сбрасываем, чтобы смена плана не ждала тика.
  global._labRequiredReagents = null;
}

/** Эталонный план: одна тройка, UHO2 + X → XUHO2 / ZHO2 + X → XZHO2. */
function oneTriplePlan(planRoom) {
  const room = planRoom || "E35S37";
  const plan = {};
  plan[room] = {
    labs: {
      recipeA: { reagent1: "UHO2", reagent2: "X", product: "XUHO2" },
      recipeB: { reagent1: "ZHO2", reagent2: "X", product: "XZHO2" },
      lowA: 300,
      highA: 1200,
      lowB: 400,
      highB: 1200,
    },
  };
  return plan;
}

// ── Мир ─────────────────────────────────────────────────────────────────

function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

function makeStore(capacity, contents) {
  const target = Object.assign({}, contents);
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

function makeLab(id, contents) {
  return { id: id, store: makeStore(3000, contents) };
}

function roomCoords(name) {
  const m = /^([EW])(\d+)([NS])(\d+)$/.exec(name);
  return {
    x: (m[1] === "E" ? 1 : -1) * Number(m[2]),
    y: (m[3] === "S" ? -1 : 1) * Number(m[4]),
  };
}

function txCost(amount, from, to) {
  const a = roomCoords(from);
  const b = roomCoords(to);
  const distance = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return Math.ceil(amount * (1 - Math.exp(-distance / 30)));
}

/**
 * @param {Object} spec по комнате: {storage, terminal, lab, labReagent}
 * @param {Object} books книга заявок по ресурсам
 * @param {number} time
 */
function makeGame(spec, books, time) {
  const rooms = {};
  const terminals = {};
  const objects = {};
  const orders = [];

  for (const roomName of Object.keys(spec)) {
    const row = spec[roomName];
    if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
    const mem = Memory.rooms[roomName];
    const terminal = {
      room: null,
      store: makeStore(300000, row.terminal || {}),
      cooldown: 0,
    };
    const room = {
      name: roomName,
      controller: { my: true },
      memory: mem,
      terminal: terminal,
      storage: {
        id: "ST_" + roomName,
        store: makeStore(1000000, row.storage || {}),
      },
    };
    terminal.room = room;

    if (row.lab) {
      for (const slot of ["lab1", "lab2", "reactor"]) {
        const id = "LAB_" + roomName + "_" + slot;
        objects[id] = makeLab(id, row.lab[slot] || {});
        mem.labs = mem.labs || {};
        mem.labs[slot] = id;
      }
      // Проекция тройки — как её пишет lab.recipes; рынку важен только факт
      // существования тройки (labImportActive) и состав плана.
      mem.labs.reagent1 = row.labReagent || "UHO2";
      mem.labs.reagent2 = "X";
      mem.labs.product = "XUHO2";
      mem.labs.active = "A";
    }

    rooms[roomName] = room;
    terminals[roomName] = terminal;
  }

  for (const resourceType of Object.keys(books)) {
    for (const order of books[resourceType]) {
      orders.push(Object.assign({ resourceType }, order));
    }
  }

  const calls = { orders: [], deals: [] };

  const market = {
    getAllOrders(filter) {
      calls.orders.push(filter.resourceType);
      const book = books[filter.resourceType] || [];
      return book.map(o => Object.assign({}, o));
    },
    calcTransactionCost(amount, from, to) {
      return txCost(amount, from, to);
    },
    deal(orderId, amount, roomName) {
      const order = orders.find(o => o.id === orderId);
      if (!order) return ERR_INVALID_ARGS;
      const terminal = terminals[roomName];
      const cost = txCost(amount, roomName, order.roomName);
      const resourceType = order.resourceType;
      order.remainingAmount -= amount;
      terminal.store[resourceType] = (terminal.store[resourceType] || 0) + amount;
      terminal.store[RESOURCE_ENERGY] =
        (terminal.store[RESOURCE_ENERGY] || 0) - cost;
      calls.deals.push({
        orderId: orderId,
        amount: amount,
        roomName: roomName,
        resourceType: resourceType,
        type: order.type,
        price: order.price,
        fee: cost,
      });
      return OK;
    },
  };

  global.Game = {
    time: time,
    rooms: rooms,
    market: market,
    getObjectById: id => objects[id] || null,
  };
  return calls;
}

/** Запуск run() с перехватом консоли. */
function runCaptured() {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    marketManager.run();
  } finally {
    console.log = orig;
  }
  return logs;
}

function sellOrder(id, price, amount, roomName) {
  return {
    id: id,
    type: ORDER_SELL,
    price: price,
    remainingAmount: amount,
    amount: amount,
    roomName: roomName,
  };
}

function buyOrder(id, price, amount, roomName) {
  return {
    id: id,
    type: ORDER_BUY,
    price: price,
    remainingAmount: amount,
    amount: amount,
    roomName: roomName,
  };
}

function resetMemory() {
  global.Memory = { rooms: {} };
}

/** Временно подменяет списки закупки/продажи и настройки LAB_IMPORT. */
function withConfig(opts, fn) {
  const origBuy = MARKET.BUY_RESOURCES.slice();
  const origSell = MARKET.SELL_RESOURCES.slice();
  const origImport = MARKET.LAB_IMPORT;
  try {
    MARKET.BUY_RESOURCES.length = 0;
    for (const r of opts.buy || []) MARKET.BUY_RESOURCES.push(r);
    MARKET.SELL_RESOURCES.length = 0;
    for (const r of opts.sell || []) MARKET.SELL_RESOURCES.push(r);
    if (opts.labImport) MARKET.LAB_IMPORT = opts.labImport;
    fn();
  } finally {
    MARKET.BUY_RESOURCES.length = 0;
    for (const r of origBuy) MARKET.BUY_RESOURCES.push(r);
    MARKET.SELL_RESOURCES.length = 0;
    for (const r of origSell) MARKET.SELL_RESOURCES.push(r);
    MARKET.LAB_IMPORT = origImport;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 1. requiredReagents: резерв из плана
// ═══════════════════════════════════════════════════════════════════════
function testRequiredReagents() {
  console.log("\n1. requiredReagents: резерв из LAB_PLAN");
  restorePlan();
  global._labRequiredReagents = null;
  global.Game = { time: 100 };

  const real = labRecipes.requiredReagents();
  check(
    "реальный план: UHO2 найден с резервом 900 (E35S37.labs3 + E37S37.labs3 lowB 300 + 600)",
    real.UHO2 && real.UHO2.low === 900,
    real.UHO2 ? JSON.stringify(real.UHO2) : "нет",
  );
  check(
    "реальный план: UHO2 нужен E35S37 и E37S37",
    real.UHO2 &&
      real.UHO2.rooms.indexOf("E35S37") !== -1 &&
      real.UHO2.rooms.indexOf("E37S37") !== -1,
    real.UHO2 ? JSON.stringify(real.UHO2.rooms) : "нет",
  );
  check(
    "реальный план: X и O присутствуют (у них свои пороги, их отсекает labImportHandled)",
    !!real.X && !!real.O,
    Object.keys(real).join(","),
  );
  check(
    "каждый реагент имеет резерв > 0 и хотя бы одну комнату",
    Object.keys(real).every(
      k => real[k].low > 0 && real[k].rooms.length > 0,
    ),
    JSON.stringify(real),
  );

  // Алгоритм на эталонном плане: внутри тройки МАКСИМУМ, между тройками СУММА.
  setPlan(oneTriplePlan());
  global._labRequiredReagents = null;
  const one = labRecipes.requiredReagents();
  check(
    "одна тройка: UHO2 = lowA 300 (не 300 + 400 по двум слотам)",
    one.UHO2 && one.UHO2.low === 300,
    JSON.stringify(one.UHO2),
  );
  check(
    "одна тройка: X = max(lowA 300, lowB 400) = 400",
    one.X && one.X.low === 400,
    JSON.stringify(one.X),
  );

  const two = {};
  two.E35S37 = oneTriplePlan().E35S37;
  two.E37S37 = oneTriplePlan().E35S37;
  setPlan(two);
  global._labRequiredReagents = null;
  const sum = labRecipes.requiredReagents();
  check(
    "две тройки: резерв UHO2 = 300 + 300 = 600 (сумма по тройкам)",
    sum.UHO2 && sum.UHO2.low === 600,
    JSON.stringify(sum.UHO2),
  );
  check(
    "две тройки: обе комнаты в списке потребителей",
    sum.UHO2 && sum.UHO2.rooms.length === 2,
    JSON.stringify(sum.UHO2 ? sum.UHO2.rooms : null),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2. shouldBuyLabImport: пороги, полы, потолок сделки
// ═══════════════════════════════════════════════════════════════════════
function testShouldBuy() {
  console.log("\n2. shouldBuyLabImport: порог от резерва, полы, потолок сделки");
  setPlan(oneTriplePlan());
  resetMemory();
  global._labRequiredReagents = null;

  makeGame(
    { E35S37: { terminal: { energy: 150000 }, lab: {} } },
    {},
    200,
  );
  const cfg = MARKET.LAB_IMPORT;
  const reserve = { low: 300, rooms: ["E35S37"] };

  let d = marketManager.shouldBuyLabImport("UHO2", reserve);
  check(
    "резерв 300 → порог поднят полом MIN_LOW (500)",
    d.low === cfg.MIN_LOW && d.high >= cfg.MIN_HIGH,
    JSON.stringify(d),
  );
  check("запас 0 < порога → закупка разрешена", d.buy === true, JSON.stringify(d));
  check(
    "объём ограничен MAX_AMOUNT",
    d.amount === Math.min(d.high, cfg.MAX_AMOUNT),
    JSON.stringify(d),
  );

  // Запас в лаборатории-реакторе тоже считается (Storage + Terminal + Labs).
  resetMemory();
  makeGame(
    {
      E35S37: {
        terminal: { energy: 150000 },
        lab: { reactor: { UHO2: 600 } },
      },
    },
    {},
    205,
  );
  d = marketManager.shouldBuyLabImport("UHO2", reserve);
  check(
    "600 UHO2 в реакторе ≥ порога → закупки нет (гистерезис)",
    d.buy === false && d.total === 600,
    JSON.stringify(d),
  );

  // Большой резерв: порог и цель растут от плана, а не от пола.
  resetMemory();
  makeGame({ E35S37: { terminal: { energy: 150000 }, lab: {} } }, {}, 210);
  d = marketManager.shouldBuyLabImport("UHO2", { low: 4000, rooms: [] });
  check(
    "резерв 4000 → порог 4000, цель 8000",
    d.low === 4000 && d.high === 8000,
    JSON.stringify(d),
  );
  check(
    "объём всё равно не больше MAX_AMOUNT",
    d.amount === cfg.MAX_AMOUNT,
    JSON.stringify(d),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Сквозная закупка: UHO2 нет нигде → покупаем в комнату-потребитель
// ═══════════════════════════════════════════════════════════════════════
function testEndToEnd() {
  console.log("\n3. Сквозная закупка отсутствующего реагента");
  setPlan(oneTriplePlan());
  resetMemory();
  global._labRequiredReagents = null;

  const calls = makeGame(
    {
      E35S37: {
        terminal: { energy: 150000 },
        lab: { lab1: {}, lab2: { X: 500 }, reactor: {} },
      },
      E36S38: {
        terminal: { energy: 150000 },
        // Тройки нет: комната не потребитель UHO2.
      },
    },
    {
      UHO2: [
        sellOrder("uho-cheap", 120, 2000, "E45S38"),
        sellOrder("uho-dear", 300, 2000, "E45S38"),
      ],
    },
    300,
  );

  const logs = runCaptured();
  const labDeals = calls.deals.filter(d => d.resourceType === "UHO2");

  check("UHO2 отсутствует во всех комнатах → сделка состоялась", labDeals.length === 1, JSON.stringify(calls.deals));
  check(
    "куплен САМЫЙ ДЕШЁВЫЙ ордер (120, не 300)",
    labDeals.length === 1 && labDeals[0].price === 120,
    JSON.stringify(labDeals),
  );
  check(
    "получатель — комната-потребитель E35S37 (есть тройка)",
    labDeals.length === 1 && labDeals[0].roomName === "E35S37",
    JSON.stringify(labDeals),
  );
  check(
    "объём не больше MAX_AMOUNT и не больше дефицита",
    labDeals.length === 1 &&
      labDeals[0].amount <= MARKET.LAB_IMPORT.MAX_AMOUNT,
    JSON.stringify(labDeals),
  );
  check(
    "журнал Memory.__labBuys заполнен",
    Array.isArray(Memory.__labBuys) &&
      Memory.__labBuys.length === 1 &&
      Memory.__labBuys[0].res === "UHO2",
    JSON.stringify(Memory.__labBuys),
  );
  check(
    "диагностика Memory.__labImport отмечает дефицит",
    !!Memory.__labImport && Memory.__labImport.need.join(",").indexOf("UHO2:") === 0,
    JSON.stringify(Memory.__labImport),
  );
  check(
    "лог сделки содержит пометку «реагент лаб»",
    logs.some(l => l.indexOf("UHO2") !== -1 && l.indexOf("реагент лаб") !== -1),
    JSON.stringify(logs),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 4. «Нет во всех комнатах» = запас по ИМПЕРИИ, а не у потребителя
// ═══════════════════════════════════════════════════════════════════════
function testEmpireWide() {
  console.log("\n4. Запас считается по империи, а не по комнате-потребителю");
  setPlan(oneTriplePlan());
  resetMemory();
  global._labRequiredReagents = null;

  const calls = makeGame(
    {
      E35S37: {
        terminal: { energy: 150000 },
        lab: { lab1: {}, lab2: { X: 500 }, reactor: {} },
      },
      E36S38: {
        // UHO2 лежит в ДРУГОЙ комнате, у самого потребителя ноль.
        storage: { UHO2: 1000 },
      },
    },
    { UHO2: [sellOrder("uho", 120, 2000, "E45S38")] },
    400,
  );

  runCaptured();
  const labDeals = calls.deals.filter(d => d.resourceType === "UHO2");
  check(
    "UHO2 есть в империи (1000 в E36S38) → закупки нет",
    labDeals.length === 0,
    JSON.stringify(calls.deals),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Курируемые ресурсы не трогаются автозаккупкой лаб
// ═══════════════════════════════════════════════════════════════════════
function testHandled() {
  console.log("\n5. Ресурсы с курируемыми порогами пропускаются");
  check("X ведёт X_PURCHASE", marketManager.labImportHandled(X_PURCHASE.RESOURCE) === true);
  check("O ведёт MARKET.IMPORT", marketManager.labImportHandled("O") === true);
  check("H ведёт MARKET.IMPORT", marketManager.labImportHandled("H") === true);
  check("UHO2 автозаккупка лаб берёт на себя", marketManager.labImportHandled("UHO2") === false);
  check("KH2O автозаккупка лаб берёт на себя", marketManager.labImportHandled("KH2O") === false);

  // План, где нужен и O (курируемый), и UHO2 (автоматический). O никто не
  // покупает (BUY_RESOURCES пуст, IMPORT-петля не запущена), UHO2 — покупается.
  setPlan(oneTriplePlan());
  global._labRequiredReagents = null;
  // Добавляем в тройку слот с O: он должен быть проигнорирован автозаккупкой.
  LAB_PLAN.E35S37.labs.recipeB = {
    reagent1: "O",
    reagent2: "H",
    product: "OH",
  };
  global._labRequiredReagents = null;
  resetMemory();

  const calls = makeGame(
    { E35S37: { terminal: { energy: 150000 }, lab: {} } },
    {
      UHO2: [sellOrder("uho", 120, 2000, "E45S38")],
      O: [sellOrder("o", 40, 5000, "E45S38")],
    },
    500,
  );

  withConfig({ buy: [], sell: [] }, () => runCaptured());
  const res = calls.deals.map(d => d.resourceType);
  check(
    "UHO2 куплен, O — нет (его ведёт IMPORT, а не автозаккупка лаб)",
    res.indexOf("UHO2") !== -1 && res.indexOf("O") === -1,
    JSON.stringify(calls.deals),
  );
  restorePlan();
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Без настроенных троек автозаккупка не запускается
// ═══════════════════════════════════════════════════════════════════════
function testGate() {
  console.log("\n6. Нет троек в Memory → автозаккупка молчит");
  setPlan(oneTriplePlan());
  global._labRequiredReagents = null;
  resetMemory();

  const calls = makeGame(
    { E35S37: { terminal: { energy: 150000 } } },
    { UHO2: [sellOrder("uho", 120, 2000, "E45S38")] },
    600,
  );

  withConfig({ buy: [], sell: [] }, () => runCaptured());
  check(
    "рынок реагента лаб не опрашивался",
    calls.orders.indexOf("UHO2") === -1,
    JSON.stringify(calls.orders),
  );
  check("сделок нет", calls.deals.length === 0, JSON.stringify(calls.deals));

  check(
    "labImportActive: без тройки false",
    marketManager.labImportActive() === false,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Ценовые предохранители
// ═══════════════════════════════════════════════════════════════════════
function testPrices() {
  console.log("\n7. Ценовые предохранители");
  setPlan(oneTriplePlan());
  global._labRequiredReagents = null;
  resetMemory();

  // Абсолютный потолок: 300 > MAX_PRICE 200 → сделки нет.
  let calls = makeGame(
    { E35S37: { terminal: { energy: 150000 }, lab: {} } },
    { UHO2: [sellOrder("uho", 300, 2000, "E45S38")] },
    700,
  );
  withConfig(
    { buy: [], sell: [], labImport: Object.assign({}, MARKET.LAB_IMPORT, { MAX_PRICE: { UHO2: 200 } }) },
    () => runCaptured(),
  );
  check(
    "цена 300 выше MAX_PRICE 200 → сделки нет",
    calls.deals.length === 0,
    JSON.stringify(calls.deals),
  );

  // Относительный предохранитель: продажа 300 при лучшем биде 100 (>×1.2).
  global._labRequiredReagents = null;
  resetMemory();
  calls = makeGame(
    { E35S37: { terminal: { energy: 150000 }, lab: {} } },
    {
      UHO2: [
        buyOrder("bid", 100, 500, "E45S38"),
        sellOrder("ask", 300, 2000, "E45S38"),
      ],
    },
    705,
  );
  withConfig({ buy: [], sell: [] }, () => runCaptured());
  check(
    "продажа дороже лучшего бида × 1.2 → сделки нет",
    calls.deals.length === 0,
    JSON.stringify(calls.deals),
  );

  // Без встречного бида относительное правило не применяется — сделка идёт.
  global._labRequiredReagents = null;
  resetMemory();
  calls = makeGame(
    { E35S37: { terminal: { energy: 150000 }, lab: {} } },
    { UHO2: [sellOrder("ask", 300, 2000, "E45S38")] },
    710,
  );
  withConfig({ buy: [], sell: [] }, () => runCaptured());
  check(
    "без встречной заявки цена свободная → сделка идёт",
    calls.deals.length === 1,
    JSON.stringify(calls.deals),
  );

  // Энергопол: комиссия не должна проедать терминал.
  global._labRequiredReagents = null;
  resetMemory();
  calls = makeGame(
    { E35S37: { terminal: { energy: 1000 }, lab: {} } },
    { UHO2: [sellOrder("ask", 300, 2000, "E45S38")] },
    715,
  );
  withConfig({ buy: [], sell: [] }, () => runCaptured());
  check(
    "энергии терминала меньше комиссии + BUY_ENERGY_FLOOR → сделки нет",
    calls.deals.length === 0,
    JSON.stringify(calls.deals),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Обход по кругу и лимит проверок за запуск
// ═══════════════════════════════════════════════════════════════════════
function testRoundRobin() {
  console.log("\n8. MAX_RESOURCES_PER_RUN и обход по кругу");
  setPlan(oneTriplePlan());
  global._labRequiredReagents = null;

  // В эталонном плане два «наших» ресурса: UHO2 и ZHO2 (X отсекается).
  function ordersFor(time) {
    resetMemory();
    global._labRequiredReagents = null;
    const calls = makeGame(
      { E35S37: { terminal: { energy: 150000 }, lab: {} } },
      {
        UHO2: [sellOrder("u", 120, 2000, "E45S38")],
        ZHO2: [sellOrder("z", 130, 2000, "E45S38")],
      },
      time,
    );
    withConfig(
      {
        buy: [],
        sell: [],
        labImport: Object.assign({}, MARKET.LAB_IMPORT, {
          MAX_RESOURCES_PER_RUN: 1,
        }),
      },
      () => runCaptured(),
    );
    return calls;
  }

  // start = floor(time / CHECK_INTERVAL) % names.length; names = [UHO2, ZHO2].
  const t0 = 800; // 800/5 = 160 → 160 % 2 = 0 → UHO2
  const t1 = 805; // 805/5 = 161 → 161 % 2 = 1 → ZHO2
  const c0 = ordersFor(t0);
  const c1 = ordersFor(t1);

  const q0 = c0.orders.filter(r => r === "UHO2" || r === "ZHO2");
  const q1 = c1.orders.filter(r => r === "UHO2" || r === "ZHO2");
  check(
    "за запуск проверяется ровно один реагент",
    q0.length === 1 && q1.length === 1,
    JSON.stringify({ q0, q1 }),
  );
  check(
    "следующий запуск сдвигает старт (обход по кругу, не первый всегда)",
    q0[0] !== q1[0],
    JSON.stringify({ q0, q1 }),
  );

  // Общий лимит сделок: при MAX_DEALS_PER_TICK = 1 вторая закупка не пройдёт.
  resetMemory();
  global._labRequiredReagents = null;
  const c = makeGame(
    { E35S37: { terminal: { energy: 150000 }, lab: {} } },
    {
      UHO2: [sellOrder("u", 120, 2000, "E45S38")],
      ZHO2: [sellOrder("z", 130, 2000, "E45S38")],
    },
    900,
  );
  const origMax = MARKET.MAX_DEALS_PER_TICK;
  try {
    MARKET.MAX_DEALS_PER_TICK = 1;
    withConfig(
      {
        buy: [],
        sell: [],
        labImport: Object.assign({}, MARKET.LAB_IMPORT, {
          MAX_RESOURCES_PER_RUN: 5,
        }),
      },
      () => runCaptured(),
    );
  } finally {
    MARKET.MAX_DEALS_PER_TICK = origMax;
  }
  check(
    "лимит сделок на тик соблюдён (1, а не 2)",
    c.deals.length === 1,
    JSON.stringify(c.deals),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 9. labTerminalCandidates: потребитель впереди, беднейший первым
// ═══════════════════════════════════════════════════════════════════════
function testCandidates() {
  console.log("\n9. Выбор терминала-получателя");
  const plan = {};
  plan.E35S37 = oneTriplePlan().E35S37;
  plan.E37S37 = oneTriplePlan().E35S37;
  setPlan(plan);
  resetMemory();
  global._labRequiredReagents = null;

  makeGame(
    {
      E35S37: { terminal: { energy: 150000 }, lab: {} },
      E37S37: { terminal: { energy: 150000 }, lab: {} },
      E36S38: { terminal: { energy: 150000 } },
    },
    {},
    1000,
  );

  const terminals = Object.keys(Game.rooms).map(n => Game.rooms[n].terminal);
  const cands = marketManager.labTerminalCandidates(terminals, "UHO2");
  check(
    "потребители UHO2 (E35S37, E37S37) идут раньше не-потребителя E36S38",
    cands.length === 3 &&
      cands[0].room.name !== "E36S38" &&
      cands[1].room.name !== "E36S38",
    cands.map(t => t.room.name).join(","),
  );
}

// ═══════════════════════════════════════════════════════════════════════
(function main() {
  testRequiredReagents();
  testShouldBuy();
  testEndToEnd();
  testEmpireWide();
  testHandled();
  testGate();
  testPrices();
  testRoundRobin();
  testCandidates();
  restorePlan();

  console.log("\n" + "=".repeat(60));
  console.log(`ПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
  if (failed > 0) {
    console.log("ЕСТЬ ПРОВАЛЫ");
    process.exit(1);
  }
  console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
})();
