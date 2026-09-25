"use strict";
/**
 * ===================================================
 * MARKET.MANAGER.TEST.JS — офлайн-проверка менеджера рынка (задача 16)
 * ===================================================
 * Проверяем не «продажу ради продажи», а ограничители, которые защищают
 * экономику от разбазаривания (все они — конфиг constants.MARKET):
 *   1) sellableFrom: резерв терминала (SELL_RESERVE) и лимит объёма
 *      (MAX_DEAL_AMOUNT / MAX_DEAL_AMOUNT_DEFAULT);
 *   2) ресурс ниже резерва не заставляет читать книгу заявок (0 обращений);
 *   3) MIN_SELL_PRICE_RATIO: бид сильно ниже встречной заявки — не торгуем;
 *   4) MIN_DEAL_MARGIN_RATIO: далёкий покупатель «съедает» выручку комиссией —
 *      берём следующего кандидата (или не торгуем вовсе);
 *   5) MAX_DEALS_PER_TICK: лимит сделок за тик;
 *   6) CHECK_INTERVAL: в «пустые» тики рынок не опрашивается;
 *   7) книга заявок каждого ресурса читается один раз за запуск;
 *   8) round-robin: список SELL_RESOURCES обходится по кругу;
 *   9) комиссия из энергии: при нехватке энергии в терминале сделки нет и
 *      предупреждение пишется один раз;
 *  10) power и реагенты активных реакций (Memory.rooms[*].labs*) не продаются,
 *      даже если ошибочно вернутся в SELL_RESOURCES.
 *
 * Мир Screeps минимально заглушён, но комиссия считается по формуле движка
 * `ceil(amount × (1 − e^(−distance/30)))` (в моке без заворота мира — он на
 * проверяемую логику не влияет).
 *
 * Запуск: node tests/market.manager.test.js
 */

global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.OK = 0;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
// Memory нужен market.manager: защита реагентов читает Memory.rooms[*].labs*.
global.Memory = { rooms: {} };

const { MARKET, STORAGE } = require("../constants");
const marketManager = require("../market.manager");

// ── Изоляция от закупок (задача «автоматическая закупка X») ──────────────
// Все сценарии ниже описывают мир без закупок: они проверяют ПРОДАЖУ излишков
// и её ограничители. MARKET.BUY_RESOURCES теперь содержит X (закупка X
// включается конфигурацией, пороги — X_PURCHASE), и в мире с нулевым запасом X
// менеджер справедливо пошёл бы в книгу заявок за X — эти сценарии такую
// закупку не подразумевают.
//
// Поэтому список закупок здесь очищается на время файла и сохраняется для
// проверки конфигурации в конце. Сама закупка X покрыта отдельным файлом
// tests/market.x.purchase.test.js (там список, наоборот, включает X).
const SAVED_BUY_RESOURCES = MARKET.BUY_RESOURCES.slice();
if (!global.__marketBuyIsolated) {
  global.__marketBuyIsolated = true;
  MARKET.BUY_RESOURCES.length = 0;
}

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
  const x = (m[1] === "E" ? 1 : -1) * Number(m[2]);
  const y = (m[3] === "S" ? -1 : 1) * Number(m[4]);
  return { x: x, y: y };
}

/** Комиссия сделки в энергии — формула движка. */
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

/** Store структуры: ресурсы — перечисляемые ключи, методы — нет. */
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

function makeTerminal(roomName, contents) {
  return {
    room: { name: roomName },
    store: makeStore(300000, contents),
    cooldown: 0,
  };
}

/**
 * Собирает Game с терминалами и книгой заявок.
 * @param {Object<string, Object>} terminalContents по комнате — store терминала
 * @param {Object<string, Object[]>} books по ресурсу — список заявок
 * @param {number} time
 */
function makeGame(terminalContents, books, time) {
  const rooms = {};
  const terminals = {};
  const orders = [];

  for (const roomName of Object.keys(terminalContents)) {
    const terminal = makeTerminal(roomName, terminalContents[roomName]);
    // Комната держит ссылку на Memory.rooms[roomName]: тесты задают реакции
    // (labs) уже после создания мира, а менеджер читает их через room.memory.
    if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
    rooms[roomName] = {
      name: roomName,
      controller: { my: true },
      memory: Memory.rooms[roomName],
      terminal: terminal,
      // Storage выше резерва: продажа из комнаты разрешена (roomMaySell).
      // Отдельный тест проверяет, что на резерве продажа запрещена.
      storage: { id: "ST_" + roomName, store: { energy: 200000 } },
    };
    // Терминал ссылается на реальную комнату (нужно для roomMaySell: продажа
    // разрешена только когда storage выше резерва).
    terminal.room = rooms[roomName];
    terminals[roomName] = terminal;
  }

  for (const resourceType of Object.keys(books)) {
    for (const order of books[resourceType]) {
      orders.push(Object.assign({ resourceType: resourceType }, order));
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
      const terminal = terminals[roomName];
      const resourceType = order.resourceType;
      const cost = txCost(amount, roomName, order.roomName);

      if ((terminal.store[resourceType] || 0) < amount) {
        return ERR_NOT_ENOUGH_RESOURCES;
      }
      order.remainingAmount -= amount;
      terminal.store[resourceType] =
        (terminal.store[resourceType] || 0) - amount;
      terminal.store[RESOURCE_ENERGY] =
        (terminal.store[RESOURCE_ENERGY] || 0) - cost;
      calls.deals.push({
        orderId: order.id,
        amount: amount,
        roomName: roomName,
        resourceType: resourceType,
        fee: cost,
      });
      return OK;
    },
  };

  global.Game = { time: time, rooms: rooms, market: market };
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

/** Заявка покупки. */
function buy(id, price, amount, roomName) {
  return {
    id: id,
    type: ORDER_BUY,
    price: price,
    remainingAmount: amount,
    amount: amount,
    roomName: roomName,
  };
}

/** Заявка продажи. */
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
// ── 1. sellableFrom: резерв и лимит объёма ───────────────────────────────
{
  console.log("\n1. sellableFrom: резерв и лимит объёма");
  const terminal = makeTerminal("E35S37", {
    energy: 150000,
    power: 100000,
    battery: 500,
    U: 5000,
  });

  check(
    "power 100000 → лимит сделки (MAX_DEAL_AMOUNT_DEFAULT)",
    marketManager.sellableFrom(terminal, "power") ===
      MARKET.MAX_DEAL_AMOUNT_DEFAULT,
    String(marketManager.sellableFrom(terminal, "power")),
  );
  check(
    "energy 150000 → лимит energy (MAX_DEAL_AMOUNT)",
    marketManager.sellableFrom(terminal, "energy") ===
      MARKET.MAX_DEAL_AMOUNT.energy,
    String(marketManager.sellableFrom(terminal, "energy")),
  );
  check(
    "battery 500 (резерв 0) → весь объём",
    marketManager.sellableFrom(terminal, "battery") === 500,
    String(marketManager.sellableFrom(terminal, "battery")),
  );
  check(
    "U 5000 при резерве 1000 → 4000",
    marketManager.sellableFrom(terminal, "U") === 4000,
    String(marketManager.sellableFrom(terminal, "U")),
  );

  const low = makeTerminal("E35S37", { power: 3000 });
  check(
    "power 3000 при резерве 5000 → 0 (резерв важнее лимита)",
    marketManager.sellableFrom(low, "power") === 0,
    String(marketManager.sellableFrom(low, "power")),
  );
}

// ── 2. Излишек ниже MIN_DEAL_AMOUNT: книгу заявок не читаем ──────────────
{
  console.log("\n2. Ресурс ниже резерва/минимума: 0 обращений к рынку");
  const calls = makeGame({ E35S37: { energy: 100050 } }, {}, 5);
  runCaptured();
  check("сделок нет", calls.deals.length === 0, String(calls.deals.length));
  check(
    "getAllOrders не вызывался",
    calls.orders.length === 0,
    JSON.stringify(calls.orders),
  );
}

// ── 3. Хэппи-пас: energy + battery, книги читаются один раз ──────────────
{
  console.log("\n3. Продажа energy и battery: по одной сделке, 1 чтение книги");
  const calls = makeGame(
    { E35S37: { energy: 150000, battery: 100000 } },
    {
      energy: [buy("be", 65.5, 1000, "E35S38")],
      battery: [buy("bb", 430, 1000, "E35S38")],
    },
    10,
  );
  // Порядок сделок считаем ОТ КОНФИГА, а не литералом: SELL_RESOURCES — список
  // из шести ресурсов, и round-robin стартует с индекса
  // floor(time / CHECK_INTERVAL) % длины. Прежнее ожидание «energy первой» было
  // верно только для списка из двух элементов.
  const expectedOrder = [];
  {
    const list = MARKET.SELL_RESOURCES;
    const start = Math.floor(10 / MARKET.CHECK_INTERVAL) % list.length;
    for (let i = 0; i < list.length; i++) {
      const resource = list[(start + i) % list.length];
      if (resource === "energy" || resource === "battery") expectedOrder.push(resource);
    }
  }
  const logs = runCaptured();

  check("2 сделки", calls.deals.length === 2, JSON.stringify(calls.deals));
  check(
    "сделки идут в порядке round-robin конфига",
    calls.deals[0].resourceType === expectedOrder[0] &&
      calls.deals[1].resourceType === expectedOrder[1],
    JSON.stringify(calls.deals) + " vs " + JSON.stringify(expectedOrder),
  );
  check(
    "объём ограничен заявкой (1000)",
    calls.deals[0].amount === 1000 && calls.deals[1].amount === 1000,
    JSON.stringify(calls.deals),
  );
  check(
    "getAllOrders: 1 раз на ресурс, в порядке обхода",
    calls.orders.length === 2 &&
      calls.orders[0] === expectedOrder[0] &&
      calls.orders[1] === expectedOrder[1],
    JSON.stringify(calls.orders) + " vs " + JSON.stringify(expectedOrder),
  );
  check(
    "energy после сделок: −объём energy −2 комиссии (energy и battery)",
    // 150000 − 1000 (продано energy) − 33 (комиссия energy) − 33 (комиссия battery):
    // обе сделки проходят через этот терминал, комиссия всегда в энергии.
    global.Game.rooms.E35S37.terminal.store[RESOURCE_ENERGY] ===
      150000 - 1000 - 33 - 33,
    String(global.Game.rooms.E35S37.terminal.store[RESOURCE_ENERGY]),
  );
  check(
    "логи только об успешных сделках (2 строки)",
    logs.length === 2,
    JSON.stringify(logs),
  );
}



// ── 4. MIN_SELL_PRICE_RATIO: бид ниже встречной заявки ───────────────────
{
  console.log("\n4. MIN_SELL_PRICE_RATIO: дешёвый бид не берём");
  const calls = makeGame(
    { E35S37: { energy: 1000, battery: 100000 } },
    {
      battery: [
        buy("low", 100, 1000, "E35S38"),
        sellOrder("ask", 200, 1000, "E35S39"),
      ],
    },
    5,
  );
  runCaptured();
  check("сделок нет", calls.deals.length === 0, JSON.stringify(calls.deals));
}

// ── 5. MIN_DEAL_MARGIN_RATIO: далёкий покупатель съедает выручку ─────────
{
  console.log("\n5. Комиссия: далёкого покупателя пропускаем, берём ближнего");
  const calls = makeGame(
    { E35S37: { energy: 150000, battery: 100000 } },
    {
      battery: [buy("far", 9, 1000, "E80S80"), buy("near", 8, 1000, "E35S38")],
    },
    5,
  );
  runCaptured();
  check(
    "сделка с ближним покупателем по 8",
    calls.deals.length === 1 && calls.deals[0].orderId === "near",
    JSON.stringify(calls.deals),
  );

  const onlyFar = makeGame(
    { E35S37: { energy: 150000, battery: 100000 } },
    {
      battery: [buy("far", 9, 1000, "E80S80")],
    },
    5,
  );
  runCaptured();
  check(
    "единственный далёкий покупатель — сделки нет",
    onlyFar.deals.length === 0,
    JSON.stringify(onlyFar.deals),
  );
}

// ── 6. MAX_DEALS_PER_TICK ───────────────────────────────────────────────
{
  console.log("\n6. MAX_DEALS_PER_TICK ограничивает число сделок");
  const terminalContents = {};
  for (let i = 0; i < 8; i++) {
    terminalContents["E3" + i + "S37"] = { energy: 150000, battery: 100000 };
  }
  // battery идёт первым в round-robin и исчерпает лимит сделок за тик.
  const calls = makeGame(
    terminalContents,
    { battery: [buy("big", 430, 100000, "E30S38")] },
    5,
  );
  runCaptured();
  check(
    `ровно ${MARKET.MAX_DEALS_PER_TICK} сделок (из 8 терминалов)`,
    calls.deals.length === MARKET.MAX_DEALS_PER_TICK,
    String(calls.deals.length),
  );
  check(
    "каждая сделка — по лимиту объёма ресурса",
    calls.deals.every(d => d.amount === MARKET.MAX_DEAL_AMOUNT_DEFAULT),
    JSON.stringify(calls.deals.map(d => d.amount)),
  );
}


// ── 7. CHECK_INTERVAL: вне фазы рынок не опрашивается ────────────────────
{
  console.log("\n7. CHECK_INTERVAL: «пустой» тик бесплатен");
  const calls = makeGame(
    { E35S37: { energy: 150000, battery: 100000 } },
    {
      energy: [buy("be", 65.5, 1000, "E35S38")],
      battery: [buy("bb", 430, 1000, "E35S38")],
    },
    7, // 7 % 5 !== 0
  );
  runCaptured();
  check(
    "ни одного обращения к рынку",
    calls.orders.length === 0 && calls.deals.length === 0,
    JSON.stringify(calls),
  );
}

// ── 8. Round-robin по SELL_RESOURCES ────────────────────────────────────
{
  console.log("\n8. Round-robin: стартовый ресурс сдвигается каждый запуск");
  const books = {
    energy: [buy("be", 65.5, 1000, "E35S38")],
    battery: [buy("bb", 430, 1000, "E35S38")],
  };
  const contents = { E35S37: { energy: 150000, battery: 1000 } };

  const t5 = makeGame(contents, books, 5);
  runCaptured();
  const t10 = makeGame(contents, books, 10);
  runCaptured();

  // Ожидание выводим из конфига: старт round-robin
  // floor(time / CHECK_INTERVAL) % SELL_RESOURCES.length, затем первый ресурс
  // обхода, для которого есть книга заявок.
  const firstSold = time => {
    const list = MARKET.SELL_RESOURCES;
    const start = Math.floor(time / MARKET.CHECK_INTERVAL) % list.length;
    for (let i = 0; i < list.length; i++) {
      const resource = list[(start + i) % list.length];
      if (books[resource]) return resource;
    }
    return null;
  };
  check(
    "стартовый ресурс сдвигается со временем по round-robin конфига",
    t5.orders[0] === firstSold(5) &&
      t10.orders[0] === firstSold(10) &&
      firstSold(5) !== firstSold(10),
    JSON.stringify({ t5: t5.orders, t10: t10.orders }) +
      " vs " +
      JSON.stringify([firstSold(5), firstSold(10)]),
  );
}

// ── 9. Не хватает энергии на комиссию: предупреждение один раз ───────────
{
  console.log("\n9. Комиссия дороже энергии терминала: сделки нет, 1 предупреждение");
  const calls = makeGame(
    { E35S37: { energy: 10, battery: 100000 } },
    { battery: [buy("bb", 430, 1000, "E35S38")] },
    5,
  );
  const logs = runCaptured();
  check("сделок нет", calls.deals.length === 0, JSON.stringify(calls.deals));
  check(
    "одно предупреждение про комиссию",
    logs.length === 1 && logs[0].indexOf("мало энергии") !== -1,
    JSON.stringify(logs),
  );
}

// ── 10. Storage на резерве: рынок не экспортирует из комнаты ────────────
{
  console.log("\n10. Storage на резерве: продажа из комнаты запрещена");
  const calls = makeGame(
    { E35S37: { energy: 150000, battery: 100000 } },
    { battery: [buy("bb", 430, 1000, "E35S38")] },
    5,
  );
  // Комната «на резерве» — излишка, которым можно рисковать, нет.
  global.Game.rooms.E35S37.storage.store.energy = STORAGE.ENERGY_MIN;
  runCaptured();
  check("сделок нет", calls.deals.length === 0, JSON.stringify(calls.deals));
  check(
    "книгу заявок даже не читали",
    calls.orders.length === 0,
    JSON.stringify(calls.orders),
  );
}

// ── 11. Комиссия не имеет права есть резерв энергии терминала ────────────
{
  console.log(
    "\n11. Комиссия не опускает энергию терминала ниже резерва",
  );
  // Энергии хватает ровно на то, чтобы после комиссии остаться НИЖЕ пола
  // MARKET.SELL_ENERGY_FLOOR: сначала floor + 10, комиссия (33) уводит остаток
  // под пол — сделка обязана не состояться. Значение считается от конфига, а не
  // литералом 100010 (тот был привязан к резерву 100 000, который на живом
  // шарде недостижим и потому был выключен вместе с проверкой).
  const calls = makeGame(
    { E35S37: { energy: MARKET.SELL_ENERGY_FLOOR + 10, battery: 100000 } },
    { battery: [buy("bb", 430, 1000, "E35S38")] },
    5,
  );
  runCaptured();
  check(
    "продажа battery не состоялась (комиссия съела бы резерв)",
    calls.deals.length === 0,
    JSON.stringify(calls.deals),
  );
}

// ── 12. power не продаётся (катализатор PowerSpawn/GPL) ──────────────────
{
  console.log("\n12. power защищён от продажи");
  const calls = makeGame(
    { E35S37: { energy: 150000, power: 100000 } },
    { power: [buy("bp", 1710, 100000, "E35S38")] },
    5,
  );
  runCaptured();
  check("сделок нет", calls.deals.length === 0, JSON.stringify(calls.deals));
  check(
    "книгу заявок power даже не читали",
    calls.orders.indexOf("power") === -1,
    JSON.stringify(calls.orders),
  );
}

// ── 13. Защита реагентов: даже «ошибочный» список не продаёт их ──────────
{
  console.log(
    "\n13. Реагенты реакций и power не продаются, даже если вернутся в SELL_RESOURCES",
  );
  // E99S99 использует X и O как ингредиенты активной реакции.
  const calls = makeGame(
    {
      E99S99: {
        energy: 150000,
        X: 100000,
        O: 100000,
        power: 100000,
        battery: 50000,
      },
    },
    {
      X: [buy("bx", 5000, 100000, "E99S98")],
      O: [buy("bo", 500, 100000, "E99S98")],
      power: [buy("bp", 1710, 100000, "E99S98")],
      battery: [buy("bb", 430, 1000, "E99S98")],
    },
    5,
  );
  Memory.rooms.E99S99.labs = {
    lab1: "L1",
    lab2: "L2",
    reactor: "R1",
    reagent1: "X",
    reagent2: "O",
    product: "XO",
  };

  // Имитируем ошибку конфига: реагенты и power снова в списке продажи.
  MARKET.SELL_RESOURCES.push("X", "O", "power");
  let sold;
  let queried;
  try {
    runCaptured();
    sold = calls.deals.map(d => d.resourceType);
    queried = calls.orders;
  } finally {
    MARKET.SELL_RESOURCES.length = 2; // назад к ["energy", "battery"]
  }

  check("power не продан", sold.indexOf("power") === -1, JSON.stringify(sold));
  check("реагент X не продан", sold.indexOf("X") === -1, JSON.stringify(sold));
  check("реагент O не продан", sold.indexOf("O") === -1, JSON.stringify(sold));
  check(
    "battery продан (защита блокирует только расходуемое)",
    sold.indexOf("battery") !== -1,
    JSON.stringify(sold),
  );
  check(
    "книга заявок power/X/O даже не читалась",
    queried.indexOf("power") === -1 &&
      queried.indexOf("X") === -1 &&
      queried.indexOf("O") === -1,
    JSON.stringify(queried),
  );
}

// ── 14. Конфигурация закупки не потеряна изоляцией выше ─────────────────
{
  console.log(
    "\n14. Закупка X остаётся включённой в конфигурации (изоляция её не меняет)",
  );
  console.log(
    `  INFO  MARKET.BUY_RESOURCES при загрузке = ${JSON.stringify(SAVED_BUY_RESOURCES)}`,
  );
}

// ── 15. Закупка готовых бустов: потолок цены вместо сравнения с заявкой ──
{
  console.log(
    "\n15. Закупка XKH2O: BUY_MAX_PRICE работает там, где правило 1.2 блокирует",
  );
  // Живой shard3: лучшая продажа XKH2O 1531.98 при лучшей покупке 265.98
  // (отношение 5.76). Правило «не покупать дороже лучшей встречной заявки × 1.2»
  // отклоняло ЛЮБУЮ закупку бустов, поэтому подстраховка не срабатывала.
  const calls = makeGame(
    { E99S99: { energy: 150000 } },
    {
      XKH2O: [
        buy("bkh", 266, 20000, "E99S98"),
        sellOrder("skh", 1532, 7395, "E99S98"),
      ],
    },
    5,
  );
  // makeGame.deal написан под продажу (списывает ресурс из терминала). Для
  // закупки переопределяем: ресурс ПРИХОДИТ в терминал, энергия уходит на комиссию.
  Game.market.deal = (orderId, amount, roomName) => {
    const terminal = Game.rooms[roomName].terminal;
    const cost = txCost(amount, roomName, "E99S98");
    terminal.store.XKH2O = (terminal.store.XKH2O || 0) + amount;
    terminal.store.energy = (terminal.store.energy || 0) - cost;
    calls.deals.push({
      orderId,
      amount,
      roomName,
      resourceType: "XKH2O",
      fee: cost,
    });
    return OK;
  };

  const savedBuy = MARKET.BUY_RESOURCES.slice();
  try {
    MARKET.BUY_RESOURCES.length = 0;
    MARKET.BUY_RESOURCES.push("XKH2O");

    // (а) со штатным потолком из constants.js покупка проходит
    runCaptured();
    const withCeiling = calls.deals.filter(d => d.resourceType === "XKH2O");
    check(
      "со штатным потолком цены закупка XKH2O проходит",
      withCeiling.length === 1 && withCeiling[0].amount > 0,
      JSON.stringify(withCeiling),
    );
    check(
      "объём ограничен IMPORT.MAX_AMOUNT (3000, а не весь ордер)",
      withCeiling.length === 1 && withCeiling[0].amount === 3000,
      String(withCeiling.length ? withCeiling[0].amount : "нет сделки"),
    );

    // (б) без потолка — работает прежнее правило и сделка отклоняется
    calls.deals.length = 0;
    const savedCeiling = MARKET.BUY_MAX_PRICE.XKH2O;
    delete MARKET.BUY_MAX_PRICE.XKH2O;
    runCaptured();
    check(
      "без потолка правило 1.2 снова отклоняет сделку (регресс не вернётся)",
      calls.deals.length === 0,
      JSON.stringify(calls.deals),
    );

    // (в) потолок ниже рынка тоже запрещает покупку (защита от роста цены)
    MARKET.BUY_MAX_PRICE.XKH2O = 1000;
    runCaptured();
    check(
      "цена выше потолка (1532 > 1000) не покупается",
      calls.deals.length === 0,
      JSON.stringify(calls.deals),
    );
    MARKET.BUY_MAX_PRICE.XKH2O = savedCeiling;
  } finally {
    MARKET.BUY_RESOURCES.length = 0;
    for (const r of savedBuy) MARKET.BUY_RESOURCES.push(r);
  }
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
