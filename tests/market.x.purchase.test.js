"use strict";
/**
 * ===================================================
 * MARKET.X.PURCHASE.TEST.JS — автоматическая закупка X и защита X от продажи
 * ===================================================
 * X в империи НЕ добывается: он второй реагент всех финальных реакций E35S37
 * (см. LAB_PLAN в constants.js), поэтому его запас поддерживается покупкой на
 * рынке существующим market.manager (BUY_RESOURCES + X_PURCHASE).
 *
 * Проверяется:
 *   1. сумма по империи: X считается как Storage + Terminal + ЛАБОРАТОРИИ
 *      (включая буст-лабу) всех собственных комнат, а не по одному терминалу;
 *   2. порог LOW: ниже него закупка разрешена, объём — до HIGH (не «сколько
 *      даст ордер», иначе одна покупка перепрыгнула бы HIGH);
 *   3. порог HIGH: при запасе ≥ HIGH покупки прекращаются, рынок не
 *      опрашивается вовсе;
 *   4. лимит цены X_PURCHASE.MAX_PRICE;
 *   5. запрет одновременной продажи: при активной потребности X не продаётся
 *      и закупка имеет приоритет над surplus-поведением;
 *   6. существующий Market не ломается: продажа прочих ресурсов и лимит сделок
 *      работают как раньше.
 *
 * Почему отдельный файл, а не секция market.manager.test.js: фикстуры того
 * файла (SELL_RESOURCES.length = 2, ожидания «getAllOrders читается только для
 * energy/battery») написаны под мир БЕЗ закупок, и включение X в BUY_RESOURCES
 * меняло бы их результаты, не относящиеся к этой задаче.
 *
 * Запуск: node tests/market.x.purchase.test.js
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
// Memory нужен market.manager: защита реагентов читает Memory.rooms[*].labs*.
global.Memory = { rooms: {} };

// ── Изоляция от других тестов рынка ─────────────────────────────────────
// tests/market.manager.test.js на время своего прогона очищает
// MARKET.BUY_RESOURCES (его сценарии описывают мир БЕЗ закупок). Порядок
// запуска файлов не гарантирован, поэтому закупка X включается здесь явно:
// тест проверяет механизм закупки, а не текущее содержимое списка.
const { MARKET, X_PURCHASE } = require("../constants");
const SAVED_BUY_RESOURCES = MARKET.BUY_RESOURCES.slice();
if (MARKET.BUY_RESOURCES.indexOf(X_PURCHASE.RESOURCE) === -1) {
  MARKET.BUY_RESOURCES.push(X_PURCHASE.RESOURCE);
}
// Возврат конфигурации в исходное состояние после прогона: файл не должен
// менять глобальный конфиг для других тестов.
process.on("exit", () => {
  MARKET.BUY_RESOURCES.length = 0;
  for (const r of SAVED_BUY_RESOURCES) MARKET.BUY_RESOURCES.push(r);
});

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

// ── Мир ──────────────────────────────────────────────────────────────────

/** Координаты комнаты из имени (E35S37 → x=35, y=-37). */
function roomCoords(name) {
  const m = /^([EW])(\d+)([NS])(\d+)$/.exec(name);
  return {
    x: (m[1] === "E" ? 1 : -1) * Number(m[2]),
    y: (m[3] === "S" ? -1 : 1) * Number(m[4]),
  };
}

/** Комиссия сделки в энергии — формула движка (без заворота мира). */
function txCost(amount, from, to) {
  const a = roomCoords(from);
  const b = roomCoords(to);
  const distance = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return Math.ceil(amount * (1 - Math.exp(-distance / 30)));
}

function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

/** Store структуры: ресурсы — перечисляемые ключи, методы — не перечисляются. */
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

/**
 * Мир: комнаты с терминалом, складом и (необязательно) лабораториями.
 * @param {Object} spec по комнате: {storage, terminal, lab, boostLab}
 * @param {Object} books книга заявок по ресурсам
 * @param {number} time
 */
function makeGame(spec, books, time) {
  const rooms = {};
  const terminals = {};
  const objects = {};
  const orders = [];
  const removedPlans = {};

  for (const roomName of Object.keys(spec)) {
    const row = spec[roomName];
    // plan: false — комната исключается из LAB_PLAN на время сценария: нужно,
    // чтобы проверить фоллбэк выбора получателя, когда комнат-потребителей X
    // в конфигурации нет.
    if (row.plan === false) {
      const { LAB_PLAN } = require("../constants");
      if (LAB_PLAN[roomName]) {
        removedPlans[roomName] = LAB_PLAN[roomName];
        delete LAB_PLAN[roomName];
      }
    }
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
      // Конфиг тройки финального производства: X — реагент2 ⇒ империя
      // расходует X, и он защищён от продажи (как реагент реакции).
      mem.labs.recipeA = { reagent1: "KH2O", reagent2: "X", product: "XKH2O" };
      mem.labs.recipeB = { reagent1: "KHO2", reagent2: "X", product: "XKHO2" };
      mem.labs.reagent1 = "KH2O";
      mem.labs.reagent2 = "X";
      mem.labs.product = "XKH2O";
      mem.labs.active = "A";
    }
    if (row.boostLab) {
      const id = "BOOST_" + roomName;
      objects[id] = makeLab(id, row.boostLab);
      mem.boostLab = id;
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
      // Копия: менеджер меняет remainingAmount локально.
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

      if (
        order.type === ORDER_BUY &&
        (terminal.store[resourceType] || 0) < amount
      ) {
        return ERR_NOT_ENOUGH_RESOURCES;
      }
      order.remainingAmount -= amount;
      terminal.store[resourceType] =
        (terminal.store[resourceType] || 0) +
        (order.type === ORDER_SELL ? amount : -amount);
      terminal.store[RESOURCE_ENERGY] =
        (terminal.store[RESOURCE_ENERGY] || 0) - cost;
      calls.deals.push({
        orderId: orderId,
        amount: amount,
        roomName: roomName,
        resourceType: resourceType,
        type: order.type,
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
  // Восстановление LAB_PLAN, если сценарий временно убирал комнату из плана.
  calls.restore = () => {
    const { LAB_PLAN } = require("../constants");
    for (const name of Object.keys(removedPlans)) {
      LAB_PLAN[name] = removedPlans[name];
    }
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

/** Пустая Memory.rooms для новой секции. */
function resetMemory() {
  global.Memory = { rooms: {} };
}

/** Временно подменяет MARKET.BUY_RESOURCES / SELL_RESOURCES. */
function withLists(buy, sell, fn) {
  const origBuy = MARKET.BUY_RESOURCES.slice();
  const origSell = MARKET.SELL_RESOURCES.slice();
  try {
    MARKET.BUY_RESOURCES.length = 0;
    for (const r of buy) MARKET.BUY_RESOURCES.push(r);
    MARKET.SELL_RESOURCES.length = 0;
    for (const r of sell) MARKET.SELL_RESOURCES.push(r);
    fn();
  } finally {
    MARKET.BUY_RESOURCES.length = 0;
    for (const r of origBuy) MARKET.BUY_RESOURCES.push(r);
    MARKET.SELL_RESOURCES.length = 0;
    for (const r of origSell) MARKET.SELL_RESOURCES.push(r);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 1. roomResourceTotal / empireResourceTotal: Storage + Terminal + Labs
// ═══════════════════════════════════════════════════════════════════════
function testTotals() {
  console.log("\n1. X считается суммарно: Storage + Terminal + Labs империи");
  resetMemory();

  makeGame(
    {
      E35S37: {
        storage: { energy: 200000, X: 1200 },
        terminal: { energy: 150000, X: 800 },
        // Тройка: lab2 держит X как реагент (reagent2), reactor — продукт.
        lab: { lab1: { KH2O: 500 }, lab2: { X: 1000 }, reactor: { XKH2O: 300 } },
        boostLab: { X: 250 },
      },
      E35S39: {
        storage: { energy: 200000, X: 400 },
        terminal: { energy: 150000, X: 100 },
      },
    },
    {},
    5,
  );

  const room = Game.rooms.E35S37;
  // 1200 (storage) + 800 (terminal) + 1000 (lab2) + 250 (буст-лаба) = 3250
  check(
    "roomResourceTotal = Storage + Terminal + лаборатории (включая буст-лабу)",
    marketManager.roomResourceTotal(room, "X") === 3250,
    String(marketManager.roomResourceTotal(room, "X")),
  );
  check(
    "лаборатория-реагент (lab2, 1000 X) учтена, а не только склады",
    marketManager.roomResourceTotal(room, "X") > 1200 + 800,
    String(marketManager.roomResourceTotal(room, "X")),
  );
  check(
    "буст-лаба (250 X) учтена",
    marketManager.roomResourceTotal(room, "X") === 1200 + 800 + 1000 + 250,
    String(marketManager.roomResourceTotal(room, "X")),
  );
  check(
    "продукт реактора (XKH2O, 300) в запас X не попадает",
    marketManager.roomResourceTotal(room, "XKH2O") === 300 &&
      marketManager.roomResourceTotal(room, "X") === 3250,
    String(marketManager.roomResourceTotal(room, "XKH2O")),
  );
  check(
    "empireResourceTotal суммирует ВСЕ собственные комнаты",
    marketManager.empireResourceTotal("X") === 3250 + 500,
    String(marketManager.empireResourceTotal("X")),
  );
  check(
    "комната без X ничего не добавляет",
    marketManager.empireResourceTotal("XGHO2") === 0,
    String(marketManager.empireResourceTotal("XGHO2")),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2. shouldBuyX: пороги LOW / HIGH
// ═══════════════════════════════════════════════════════════════════════
function testThresholds() {
  console.log("\n2. shouldBuyX: закупка ниже LOW, отказ на HIGH");

  const low = marketManager.shouldBuyX(X_PURCHASE.LOW - 1);
  check("запас ниже LOW → закупка разрешена", low.buy === true, JSON.stringify(low));
  check(
    "объём считается до HIGH (ограничен MAX_AMOUNT)",
    low.amount === X_PURCHASE.MAX_AMOUNT,
    String(low.amount),
  );

  const atLow = marketManager.shouldBuyX(X_PURCHASE.LOW);
  check(
    "запас = LOW → закупки нет (гистерезис, без дребезга)",
    atLow.buy === false,
    JSON.stringify(atLow),
  );

  const mid = marketManager.shouldBuyX(X_PURCHASE.HIGH - 1);
  check(
    "LOW < запас < HIGH → закупки нет (идёт накопленный запас)",
    mid.buy === false,
    JSON.stringify(mid),
  );

  const atHigh = marketManager.shouldBuyX(X_PURCHASE.HIGH);
  check("запас = HIGH → закупки нет", atHigh.buy === false, JSON.stringify(atHigh));

  const above = marketManager.shouldBuyX(X_PURCHASE.HIGH * 3);
  check("запас выше HIGH → закупки нет", above.buy === false, JSON.stringify(above));

  // Падение ниже LOW после насыщения снова разрешает закупку.
  check(
    "после падения ниже LOW закупка снова разрешена",
    marketManager.shouldBuyX(X_PURCHASE.HIGH).buy === false &&
      marketManager.shouldBuyX(X_PURCHASE.LOW - 1).buy === true,
  );

  check(
    // Пороги подняты под резерв экспансии: 17 000 единиц конечных бустов
    // расходуют 17 000 X (реакция 5 + 5 → 5). Старый HIGH = 15000 закрывал
    // закупку ровно на границе нужды, а LOW = 5000 в живом shard3 (X = 6993)
    // вообще запрещал закупку. См. docs/EXPEDITION_BOOST_STOCK_PLAN.md §7.
    "порог LOW из конфигурации (под резерв: 10000)",
    X_PURCHASE.LOW === 10000,
    String(X_PURCHASE.LOW),
  );
  check(
    "порог HIGH из конфигурации (под резерв: 25000)",
    X_PURCHASE.HIGH === 25000,
    String(X_PURCHASE.HIGH),
  );
  check(
    "цель закупки X покрывает резерв конечных бустов (17000)",
    X_PURCHASE.HIGH >= 17000,
    String(X_PURCHASE.HIGH),
  );
  check("LOW < HIGH (гистерезис корректен)", X_PURCHASE.LOW < X_PURCHASE.HIGH);
  check(
    "параметры закупки X вынесены в constants.js",
    X_PURCHASE.RESOURCE === "X" && X_PURCHASE.MAX_AMOUNT > 0,
    JSON.stringify(X_PURCHASE),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3. run(): фактическая сделка закупки X
// ═══════════════════════════════════════════════════════════════════════
function testBuy() {
  console.log("\n3. Закупка X через существующий market.manager.run()");

  withLists(["X"], [], () => {
    // 3.1. Запас 3000 < LOW → покупка до HIGH, объём ограничен MAX_AMOUNT.
    resetMemory();
    const calls = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 3000 },
          terminal: { energy: 150000 },
          lab: { lab1: { KH2O: 100 }, lab2: { X: 0 }, reactor: {} },
        },
        E35S39: {
          storage: { energy: 200000, X: 0 },
          terminal: { energy: 150000 },
        },
      },
      {
        X: [sellOrder("sx", 225, 20000, "E34S31")],
        energy: [buyOrder("be", 65, 100000, "E34S31")],
      },
      5,
    );

    check(
      "MAX_DEALS_PER_TICK > 0 (закупка вообще возможна)",
      MARKET.MAX_DEALS_PER_TICK > 0,
      String(MARKET.MAX_DEALS_PER_TICK),
    );

    runCaptured();
    const buys = calls.deals.filter(d => d.type === ORDER_SELL);
    check("сделка закупки X состоялась", buys.length === 1, JSON.stringify(calls.deals));
    if (buys.length === 1) {
      check(
        "куплено ровно MAX_AMOUNT (3000 + 5000 = 8000 ≤ HIGH)",
        buys[0].amount === X_PURCHASE.MAX_AMOUNT,
        String(buys[0].amount),
      );
      // Получатель — комната-потребитель X из ПЛАНА (lab.recipes.consumerRooms)
      // с наименьшим запасом. Раньше единственным потребителем X был хаб E35S37,
      // и проверка совпадала с «roomName === E35S37». После того как финальные
      // X-тройки появились в каждой рабочей комнате (LAB_PLAN: комнату-финишёра
      // определяет продукт с маркером "X", а не имя), потребителей пять, и самая
      // пустая из них в этой фикстуре — E35S39 (X = 0 против 3000 в хабе).
      // Инвариант сохранён и стал строже: получатель обязан быть потребителем
      // ИЗ ПЛАНА и самым пустым среди них.
      const consumers = require("../lab.recipes").consumerRooms("X");
      check(
        "получатель — самая пустая комната-потребитель X из плана",
        consumers.indexOf(buys[0].roomName) !== -1 &&
          buys[0].roomName === "E35S39",
        buys[0].roomName + " | потребители: " + consumers.join(","),
      );
      check(
        "комиссия оплачена энергией терминала-получателя",
        buys[0].fee > 0,
        JSON.stringify(buys[0]),
      );
      check(
        "сделка записана в журнал Memory.__xDeal (эксплуатационный контроль)",
        Array.isArray(Memory.__xDeal) &&
          Memory.__xDeal.length === 1 &&
          Memory.__xDeal[0].a === "buy" &&
          Memory.__xDeal[0].n === X_PURCHASE.MAX_AMOUNT,
        JSON.stringify(Memory.__xDeal),
      );
    }
    check(
      "книга заявок X прочитана (закупка реально искала ордер)",
      calls.orders.indexOf("X") !== -1,
      JSON.stringify(calls.orders),
    );

    // 3.2. Запас ≥ HIGH → покупки нет и книга заявок не читается.
    resetMemory();
    const rich = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 12000 },
          terminal: { energy: 150000, X: 4000 },
          lab: { lab1: {}, lab2: { X: 3000 }, reactor: {} },
        },
      },
      { X: [sellOrder("sx", 225, 20000, "E34S31")] },
      5,
    );
    // 12000 + 4000 + 3000 (lab2) = 19000 > HIGH
    runCaptured();
    check(
      "запас 19000 ≥ HIGH → покупки нет",
      rich.deals.length === 0,
      JSON.stringify(rich.deals),
    );
    check(
      "при запасе ≥ HIGH книга заявок X не читается вовсе",
      rich.orders.indexOf("X") === -1,
      JSON.stringify(rich.orders),
    );

    // 3.3. Абсолютный лимит цены X_PURCHASE.MAX_PRICE.
    resetMemory();
    const limit = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 1000 },
          terminal: { energy: 150000 },
        },
      },
      { X: [sellOrder("sx", 225, 20000, "E34S31")] },
      5,
    );
    const savedMaxPrice = X_PURCHASE.MAX_PRICE;
    X_PURCHASE.MAX_PRICE = 100;
    try {
      runCaptured();
    } finally {
      X_PURCHASE.MAX_PRICE = savedMaxPrice;
    }
    check(
      "X_PURCHASE.MAX_PRICE ограничивает цену закупки",
      limit.deals.length === 0,
      JSON.stringify(limit.deals),
    );

    // 3.4. Мало энергии на комиссию → покупки нет (резерв не тратится).
    resetMemory();
    const poor = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 1000 },
          terminal: { energy: 500 },
        },
      },
      { X: [sellOrder("sx", 225, 20000, "E34S31")] },
      5,
    );
    runCaptured();
    check(
      "мало энергии в терминале → закупка X не проходит (резерв комиссий цел)",
      poor.deals.length === 0,
      JSON.stringify(poor.deals),
    );

    // 3.5. Комнат-потребителей X нет в игре → фоллбэк на терминал с
    //      наименьшим запасом X (империя всё равно не остаётся без X).
    resetMemory();
    const fallback = makeGame(
      {
        E36S38: {
          plan: false,
          storage: { energy: 200000, X: 100 },
          terminal: { energy: 150000 },
        },
        E37S37: {
          plan: false,
          storage: { energy: 200000, X: 50 },
          terminal: { energy: 150000 },
        },
      },
      {
        X: [sellOrder("sx", 225, 20000, "E34S31")],
        energy: [buyOrder("be", 65, 100000, "E34S31")],
      },
      5,
    );
    runCaptured();
    const fbBuy = fallback.deals.filter(d => d.type === ORDER_SELL);
    fallback.restore();
    check(
      "без комнат-потребителей закупка идёт в терминал с наименьшим запасом X",
      fbBuy.length === 1 && fbBuy[0].roomName === "E37S37",
      JSON.stringify(fallback.deals),
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 4. X не продаётся, пока есть потребность (приоритет закупки)
// ═══════════════════════════════════════════════════════════════════════
function testSellProtection() {
  console.log("\n4. X не продаётся при активной потребности");

  withLists([], ["X"], () => {
    // 4.1. Запас ниже HIGH → X защищён, книга заявок даже не читается.
    resetMemory();
    const lowWorld = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 2000 },
          terminal: { energy: 150000, X: 12000 },
          lab: { lab1: {}, lab2: { X: 0 }, reactor: {} },
        },
      },
      { X: [buyOrder("bx", 5000, 100000, "E34S31")] },
      5,
    );
    runCaptured();
    // 2000 + 12000 = 14000 < HIGH (15000) → продажи быть не должно.
    check(
      "запас 14000 ниже HIGH → X не продан",
      lowWorld.deals.length === 0,
      JSON.stringify(lowWorld.deals),
    );
    check(
      "книга заявок X не читалась (отсечка до запроса к рынку)",
      lowWorld.orders.indexOf("X") === -1,
      JSON.stringify(lowWorld.orders),
    );

    // 4.2. Запас ≥ HIGH → X это излишек, продажа разрешена (surplus не сломан).
    resetMemory();
    const richWorld = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 30000 },
          terminal: { energy: 150000, X: 30000 },
        },
      },
      { X: [buyOrder("bx", 5000, 100000, "E34S31")] },
      5,
    );
    runCaptured();
    const sold = richWorld.deals.filter(d => d.type === ORDER_BUY);
    check(
      "запас ≥ HIGH → излишек X продаётся (surplus-поведение сохранено)",
      sold.length === 1,
      JSON.stringify(richWorld.deals),
    );
  });

  // 4.3. Закупка и продажа одного X в одном тике невозможны.
  withLists(["X"], ["X"], () => {
    resetMemory();
    const bothWorld = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 1000 },
          terminal: { energy: 150000, X: 2000 },
          // Тройка финального производства: комната — потребитель X.
          lab: { lab1: {}, lab2: { X: 0 }, reactor: {} },
        },
      },
      {
        X: [
          sellOrder("sx", 225, 20000, "E34S31"),
          buyOrder("bx", 5000, 100000, "E34S31"),
        ],
      },
      5,
    );
    runCaptured();
    const bought = bothWorld.deals.filter(d => d.type === ORDER_SELL);
    const soldX = bothWorld.deals.filter(d => d.type === ORDER_BUY);
    check(
      "при дефиците X покупается",
      bought.length === 1,
      JSON.stringify(bothWorld.deals),
    );
    check(
      "при дефиците X НЕ продаётся (закупка приоритетнее surplus)",
      soldX.length === 0,
      JSON.stringify(bothWorld.deals),
    );
  });

  // 4.4. Закупка X не забирает лимит сделок у продажи прочих ресурсов
  //      (пока запас X в норме, закупка вообще не идёт).
  withLists(["X"], ["battery"], () => {
    resetMemory();
    const calls = makeGame(
      {
        E35S37: {
          storage: { energy: 200000, X: 20000 },
          terminal: { energy: 150000, battery: 3000 },
        },
      },
      {
        X: [sellOrder("sx", 225, 20000, "E34S31")],
        battery: [buyOrder("bb", 430, 1000, "E35S38")],
      },
      5,
    );
    const logs = runCaptured();
    check(
      "запас X в норме → продажа battery работает как раньше",
      calls.deals.length === 1 && calls.deals[0].resourceType === "battery",
      JSON.stringify(calls.deals),
    );
    check(
      "лог продажи сохранён",
      logs.some(l => l.indexOf("продано 1000 battery") !== -1),
      JSON.stringify(logs),
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Существующий Market не сломан
// ═══════════════════════════════════════════════════════════════════════
function testMarketIntact() {
  console.log("\n5. Существующий Market продолжает работать");

  check(
    "X остаётся в SELL_RESOURCES (запрет даёт порог потребности, а не список)",
    MARKET.SELL_RESOURCES.indexOf("X") !== -1,
    JSON.stringify(MARKET.SELL_RESOURCES),
  );
  check(
    "BUY_RESOURCES содержит X (закупка включена конфигурацией)",
    MARKET.BUY_RESOURCES.indexOf("X") !== -1,
    JSON.stringify(MARKET.BUY_RESOURCES),
  );
  check(
    "лимит сделок за тик не изменён",
    MARKET.MAX_DEALS_PER_TICK === 6,
    String(MARKET.MAX_DEALS_PER_TICK),
  );
  check(
    "пороги surplus/deficit терминальной сети не тронуты",
    require("../constants").TERMINAL_NETWORK.RESOURCE_SURPLUS_ABOVE === 10000 &&
      require("../constants").TERMINAL_NETWORK.RESOURCE_DEFICIT_BELOW === 2000,
    JSON.stringify(require("../constants").TERMINAL_NETWORK),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Импорт критичного сырья O/Z/H (MARKET.IMPORT)
// ═══════════════════════════════════════════════════════════════════════
/**
 * O и Z в империи добыть НЕЛЬЗЯ (минералы комнат — K/H/L/L/U), H выработан.
 * Без закупки этих трёх ресурсов конечные бусты не производятся вовсе, поэтому
 * у импорта свои пороги (LOW/HIGH/MAX_AMOUNT) и свой энергопол закупки
 * (MARKET.BUY_ENERGY_FLOOR вместо SELL_RESERVE.energy = 100000, который в живом
 * shard3 блокировал ЛЮБУЮ закупку при энергии терминалов 48–77k).
 */
function testImport() {
  console.log("\n6. Импорт O/Z/H: пороги MARKET.IMPORT и энергопол закупки");
  const { MARKET: M } = require("../constants");

  // ── 6.1 Пороги: ниже LOW покупаем до HIGH, в коридоре — нет ─────────────
  resetMemory();
  const spec = {
    E35S37: { terminal: { energy: 200000 }, storage: {} },
  };
  makeGame(spec, {}, 10);
  check(
    "O ниже LOW → закупка разрешена, объём ограничен MAX_AMOUNT",
    (() => {
      global.Game.rooms.E35S37.terminal.store.O = 0;
      const d = marketManager.shouldBuyImport("O");
      return d.buy === true && d.amount === M.IMPORT.O.MAX_AMOUNT;
    })(),
    JSON.stringify(marketManager.shouldBuyImport("O")),
  );
  check(
    "O в коридоре LOW..HIGH → закупка запрещена (гистерезис)",
    (() => {
      global.Game.time++;
      global.Game.rooms.E35S37.terminal.store.O = M.IMPORT.O.LOW + 100;
      return marketManager.shouldBuyImport("O").buy === false;
    })(),
  );
  check(
    "Z отсутствует в империи → закупка разрешена (Z не добывается вообще)",
    (() => {
      global.Game.time++;
      global.Game.rooms.E35S37.terminal.store.O = 0;
      const d = marketManager.shouldBuyImport("Z");
      return d.buy === true && d.total === 0;
    })(),
  );
  check(
    "ресурс без записи в MARKET.IMPORT не покупается (защита от покупки наугад)",
    (() => {
      const saved = M.IMPORT.QQ;
      delete M.IMPORT.QQ;
      const d = marketManager.shouldBuyImport("QQ");
      if (saved) M.IMPORT.QQ = saved;
      return d.buy === false && d.amount === 0;
    })(),
  );

  // ── 6.2 Энергопол закупки: 20000, а не 100000 ──────────────────────────
  resetMemory();
  makeGame(
    { E35S37: { terminal: { energy: 60000 } } },
    { O: [sellOrder("oO", 20, 3000, "E36S37")] },
    20, // Game.time % CHECK_INTERVAL === 0: иначе run() не доходит до закупки
  );
  withLists(["O"], [], () => {
    const logs = runCaptured();
    check(
      "закупка O проходит при энергии терминала 60000 (старый пол 100k её блокировал)",
      logs.some(l => l.indexOf("куплено") >= 0 && l.indexOf("O") >= 0),
      JSON.stringify(logs),
    );
  });

  resetMemory();
  makeGame(
    { E35S37: { terminal: { energy: M.BUY_ENERGY_FLOOR - 1000 } } },
    { O: [sellOrder("oO", 20, 3000, "E36S37")] },
    25,
  );
  withLists(["O"], [], () => {
    const logs = runCaptured();
    check(
      "ниже энергопола закупка не идёт (комиссия не должна съесть терминал)",
      !logs.some(l => l.indexOf("куплено") >= 0),
      JSON.stringify(logs),
    );
  });
  // Смысл проверки — СОГЛАСОВАННОСТЬ полов, а не конкретное число: закупка
  // сырья приравнена к приоритетной логистике (см. комментарий у
  // BUY_ENERGY_FLOOR в constants.js). Литерал 20000 здесь ломался при пересмотре
  // значения по живому замеру (энергия терминалов 6.8–26.5k, при 20000 закупать
  // могла ровно одна комната), поэтому проверяем равенство полов и границы.
  const tnFloors = require("../constants").TERMINAL_NETWORK;
  check(
    "энергопол закупки равен уровню приоритетной логистики",
    M.BUY_ENERGY_FLOOR === tnFloors.PRIORITY_ENERGY_FLOOR &&
      M.BUY_ENERGY_FLOOR >= 10000 &&
      M.BUY_ENERGY_FLOOR <= 20000,
    `${M.BUY_ENERGY_FLOOR} / ${tnFloors.PRIORITY_ENERGY_FLOOR}`,
  );

  // ── 6.3 O/H/U/OH больше не продаются ───────────────────────────────────
  check(
    "O, H, U, OH убраны из SELL_RESOURCES (сырьё бустов, а не излишек)",
    ["O", "H", "U", "OH"].every(r => MARKET.SELL_RESOURCES.indexOf(r) === -1),
    JSON.stringify(MARKET.SELL_RESOURCES),
  );
  check(
    "X, K, L остались в списке продажи (минералы K/L живы, X защищён порогом)",
    ["X", "K", "L"].every(r => MARKET.SELL_RESOURCES.indexOf(r) !== -1),
    JSON.stringify(MARKET.SELL_RESOURCES),
  );
}

// ── Запуск ───────────────────────────────────────────────────────────────
testTotals();
testThresholds();
testBuy();
testSellProtection();
testMarketIntact();
testImport();

console.log("\n" + "=".repeat(60));
console.log("ПРОЙДЕНО: " + passed + ", ПРОВАЛЕНО: " + failed);
if (failed > 0) {
  console.log("\nПровалы:");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
