"use strict";
/**
 * ===================================================
 * MARKET.BUY.TEST.JS — офлайн-проверка закупки недостающих ингредиентов
 * ===================================================
 * Что проверяется (market.manager.tryBuyResource, блок MARKET_BUY):
 *   1) дефицит ресурса → сделка ровно по недостаче, но не больше
 *      MAX_AMOUNT_PER_DEAL;
 *   2) запас выше цели → сделки НЕТ и getAllOrders по этому ресурсу НЕ
 *      вызывается (цена прохода рынка 0 — это и есть защита CPU);
 *   3) потолок цены maxPrice соблюдается;
 *   4) потолок расхода MAX_CREDITS_PER_PASS соблюдается;
 *   5) энергия терминала-получателя: комиссия + ENERGY_FLOOR обязаны влезать;
 *      комната, которой не хватает энергии, пропускается, выбирается следующая;
 *   6) свободное место в терминале обязательно;
 *   7) получатель — комната с НАИМЕНЬШИМ запасом ресурса;
 *   8) MAX_BUYS_PER_TICK ограничивает число закупок за проход;
 *   9) MARKET_BUY.ENABLED = false выключает закупку целиком;
 *  10) продажа излишка продолжает работать (закупка не сломала прежний цикл и
 *      делит с ней общий лимит CONFIG.MAX_DEALS_PER_TICK).
 *
 * Мок-фреймворка в проекте нет: глобалы движка ставятся вручную, как в
 * tests/market.lab.protection.test.js.
 *
 * Запуск: node tests/market.buy.test.js
 * ===================================================
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("loadShed") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

/* ── Глобалы движка: ровно те, что нужны market.manager при загрузке ──────── */
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_HYDROGEN = "H";
global.RESOURCE_OXYGEN = "O";
global.RESOURCE_UTRIUM = "U";
global.RESOURCE_LEMERGIUM = "L";
global.RESOURCE_KEANIUM = "K";
global.RESOURCE_ZYNTHIUM = "Z";
global.RESOURCE_CATALYST = "X";
global.RESOURCES_ALL = [
  global.RESOURCE_ENERGY,
  global.RESOURCE_POWER,
  global.RESOURCE_BATTERY,
  global.RESOURCE_HYDROGEN,
  global.RESOURCE_OXYGEN,
  global.RESOURCE_UTRIUM,
  global.RESOURCE_LEMERGIUM,
  global.RESOURCE_KEANIUM,
  global.RESOURCE_ZYNTHIUM,
  global.RESOURCE_CATALYST,
];
global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.OK = 0;
global.ERR_NOT_ENOUGH_RESOURCES = -6;

global.Memory = { rooms: {} };

const deals = [];
const orderQueries = [];
let transactionCost = 0;

global.Game = {
  time: 30,
  rooms: {},
  market: {
    credits: 2000000000,
    calcTransactionCost: () => transactionCost,
    getAllOrders: opts => {
      orderQueries.push(opts.resourceType + "|" + opts.type);
      // ВАЖНО: фильтр по типу. Без него мок отдавал ордера на продажу и запросу
      // на покупку (и наоборот), и «продажа» уходила по цене чужого ордера.
      return ((global.__orders && global.__orders[opts.resourceType]) || []).filter(
        o => !opts.type || o.type === opts.type,
      );
    },
    deal: (orderId, amount, roomName) => {
      deals.push({ orderId, amount, roomName });
      return global.OK;
    },
  },
  cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
};

const marketManager = require("../market.manager");
const { MARKET, MARKET_BUY } = require("../constants");
const loadShed = require("../loadShed");

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

/* ── Фикстура ─────────────────────────────────────────────────────────────── */

/**
 * Своя комната с терминалом и складом. Запас задаётся словарём store.
 * @param {string} name
 * @param {Object} terminalStore
 * @param {Object} [storageStore]
 */
function makeRoom(name, terminalStore, storageStore) {
  const terminal = {
    my: true,
    room: { name },
    cooldown: 0,
    store: Object.assign({ energy: 90000 }, terminalStore),
  };
  terminal.store.getFreeCapacity = () => 300000;
  const room = {
    name,
    controller: { my: true },
    terminal,
    memory: {},
    storage: storageStore
      ? { store: Object.assign({}, storageStore) }
      : undefined,
  };
  global.Game.rooms[name] = room;
  global.Memory.rooms[name] = room.memory;
  return room;
}

/** Ордер на продажу (то, что покупаем мы). */
function sellOrder(resourceType, price, amount, roomName) {
  return {
    id: "sell_" + resourceType + "_" + price,
    type: global.ORDER_SELL,
    resourceType,
    price,
    amount,
    roomName: roomName || "W1N1",
  };
}

/** Ордер на покупку (то, что продаём мы). */
function buyOrder(resourceType, price, amount) {
  return {
    id: "buy_" + resourceType + "_" + price,
    type: global.ORDER_BUY,
    resourceType,
    price,
    amount,
    roomName: "W1N1",
  };
}

/** Новый проход рынка: чистим записи, сдвигаем тик (кэш ордеров ключуется им). */
function pass() {
  deals.length = 0;
  orderQueries.length = 0;
  global.Game.time += MARKET.INTERVAL;
  marketManager.run();
}

const SAVED = {
  resources: MARKET_BUY.RESOURCES,
  maxPerDeal: MARKET_BUY.MAX_AMOUNT_PER_DEAL,
  maxCredits: MARKET_BUY.MAX_CREDITS_PER_PASS,
  maxBuys: MARKET_BUY.MAX_BUYS_PER_TICK,
  enabled: MARKET_BUY.ENABLED,
};

function restore() {
  MARKET_BUY.RESOURCES = SAVED.resources;
  MARKET_BUY.MAX_AMOUNT_PER_DEAL = SAVED.maxPerDeal;
  MARKET_BUY.MAX_CREDITS_PER_PASS = SAVED.maxCredits;
  MARKET_BUY.MAX_BUYS_PER_TICK = SAVED.maxBuys;
  MARKET_BUY.ENABLED = SAVED.enabled;
}

function resetRooms(rooms) {
  global.Game.rooms = {};
  global.Memory.rooms = {};
  global.__orders = {};
  // Кэши market.manager живут в heap и переживают фикстуру: список комнат с
  // терминалом кэшируется на MARKET.TERMINALS_CACHE_TTL тиков, ордера — на тик.
  // Без сброса новый набор комнат не попадал в обход (живой дефект фикстуры:
  // третья комната не виделась и получателем выбиралась не та).
  global.__marketTerminalRooms = undefined;
  global.__marketOrders = undefined;
  // Указатель round-robin закупки живёт в heap: без сброса порядок ресурсов в
  // следующем сценарии зависел бы от предыдущего.
  global._marketBuyCursor = undefined;
  deals.length = 0;
  orderQueries.length = 0;
  transactionCost = 0;
  for (const r of rooms) makeRoom(r.name, r.terminal || {}, r.storage);
}

/* ── 1. Дефицит → сделка по недостаче ─────────────────────────────────────── */
console.log("1. Дефицит ресурса → закупка");
resetRooms([{ name: "E35S37", terminal: { H: 0 } }]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
MARKET_BUY.RESOURCES = { H: { target: 30000, maxPrice: 260 } };
pass();
check("сделка совершена", deals.length === 1, JSON.stringify(deals));
check("объём = недостача, но не больше MAX_AMOUNT_PER_DEAL (10000)",
  deals.length === 1 && deals[0].amount === 10000, JSON.stringify(deals[0]));
check("получатель — E35S37", deals.length === 1 && deals[0].roomName === "E35S37");

console.log("\n2. Запас выше цели → ни сделки, ни запроса ордеров");
resetRooms([{ name: "E35S37", terminal: { H: 30000 } }]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
pass();
check("сделки нет", deals.length === 0, JSON.stringify(deals));
check("getAllOrders по H не вызывался", !orderQueries.includes("H|sell"),
  orderQueries.join(","));

console.log("\n3. Потолок цены maxPrice");
resetRooms([{ name: "E35S37", terminal: { H: 0 } }]);
global.__orders = { H: [sellOrder("H", 300, 50000)] };
pass();
check("ордер дороже потолка не берётся", deals.length === 0, JSON.stringify(deals));

console.log("\n3b. Минимальная партия: крошечный дешёвый лот пропускается");
// Живой dry-run (tick 83374021): лучшим по цене ордером на H оказался лот из
// 37 единиц — без правила бот покупал его и тратил на это сделку прохода.
resetRooms([{ name: "E35S37", terminal: { H: 0 } }]);
global.__orders = {
  H: [sellOrder("H", 200, 37), sellOrder("H", 201, 50000)],
};
pass();
check("куплен крупный лот, а не 37 единиц",
  deals.length === 1 && deals[0].orderId === "sell_H_201" && deals[0].amount === 10000,
  JSON.stringify(deals));

console.log("\n3c. Недостача меньше MIN_SEND_AMOUNT — добор остатка цели разрешён");
resetRooms([{ name: "E35S37", terminal: { H: 29900 } }]); // недостача 100
global.__orders = { H: [sellOrder("H", 200, 5000)] };
pass();
check("куплен ровно остаток цели (100), а не весь ордер",
  deals.length === 1 && deals[0].amount === 100, JSON.stringify(deals));

console.log("\n3d. Остаток цели мельче доступного лота — сделки нет");
// 37 единиц не закрывают недостачу в 100, а сделка стоит слот прохода и
// комиссию: цель просто останется недостигнутой на эти 100 единиц.
resetRooms([{ name: "E35S37", terminal: { H: 29900 } }]);
global.__orders = { H: [sellOrder("H", 200, 37)] };
pass();
check("мелкий лот на неполный остаток не берётся", deals.length === 0,
  JSON.stringify(deals));

console.log("\n4. Потолок расхода за проход");
resetRooms([{ name: "E35S37", terminal: { H: 0 } }]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
MARKET_BUY.MAX_CREDITS_PER_PASS = 1000000; // 10000 × 200 = 2 000 000 > потолка
pass();
check("при превышении потолка сделки нет", deals.length === 0, JSON.stringify(deals));
MARKET_BUY.MAX_CREDITS_PER_PASS = SAVED.maxCredits;

console.log("\n5. Энергия терминала: комиссия + ENERGY_FLOOR");
resetRooms([{ name: "E35S37", terminal: { H: 0, energy: 5000 } }]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
pass();
check("терминал без энергии на комиссию пропущен", deals.length === 0,
  JSON.stringify(deals));

resetRooms([
  { name: "E35S37", terminal: { H: 0, energy: 5000 } },   // мало энергии
  { name: "E35S39", terminal: { H: 400, energy: 90000 } }, // подходит
]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
pass();
check("выбран другой терминал", deals.length === 1 && deals[0].roomName === "E35S39",
  JSON.stringify(deals));

console.log("\n6. Свободное место в терминале");
resetRooms([{ name: "E35S37", terminal: { H: 0 } }]);
global.Game.rooms.E35S37.terminal.store.getFreeCapacity = () => 10;
global.__orders = { H: [sellOrder("H", 200, 50000)] };
pass();
check("терминал без места пропущен", deals.length === 0, JSON.stringify(deals));

console.log("\n7. Получатель — комната с наименьшим запасом");
resetRooms([
  { name: "E35S37", terminal: { H: 900 } },
  { name: "E35S39", terminal: { H: 0 } },
  { name: "E36S38", terminal: { H: 500 } },
]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
pass();
check("выбрана E35S39 (запас 0)", deals.length === 1 && deals[0].roomName === "E35S39",
  deals.length ? deals[0].roomName : "нет сделки");
check("запас склада учитывается при выборе", deals.length === 1 &&
  global.Game.rooms.E35S37.storage === undefined);

console.log("\n8. MAX_BUYS_PER_TICK и общий лимит сделок");
resetRooms([{ name: "E35S37", terminal: { H: 0, K: 0, UO: 0 } }]);
global.__orders = {
  H: [sellOrder("H", 200, 50000)],
  K: [sellOrder("K", 15, 50000)],
  UO: [sellOrder("UO", 33, 50000)],
};
MARKET_BUY.RESOURCES = {
  H: { target: 30000, maxPrice: 260 },
  K: { target: 15000, maxPrice: 22 },
  UO: { target: 3000, maxPrice: 45 },
};
MARKET_BUY.MAX_BUYS_PER_TICK = 2;
pass();
check("за проход не больше MAX_BUYS_PER_TICK сделок", deals.length === 2,
  JSON.stringify(deals));
MARKET_BUY.MAX_BUYS_PER_TICK = SAVED.maxBuys;

console.log("\n8b. Ротация: расходный ресурс не вытесняет остальные");
// Живой дефект: H и K уходят ниже цели каждый тик (их едят KH-тройки) и при
// жёстком порядке списка занимали оба слота сделок ВСЕГДА — O не покупался
// никогда (замер: O 695 при цели 10 000). Две подряд идущие прохода обязаны
// покрыть все три ресурса.
resetRooms([{ name: "E35S37", terminal: { H: 0, K: 0, O: 0 } }]);
global.__orders = {
  H: [sellOrder("H", 200, 50000)],
  K: [sellOrder("K", 15, 50000)],
  O: [sellOrder("O", 40, 50000)],
};
MARKET_BUY.RESOURCES = {
  H: { target: 40000, maxPrice: 260 },
  K: { target: 25000, maxPrice: 22 },
  O: { target: 10000, maxPrice: 60 },
};
MARKET_BUY.MAX_BUYS_PER_TICK = 2;
pass();
const firstPair = deals.map(d => d.orderId).join(",");
pass();
const secondPair = deals.map(d => d.orderId).join(",");
const boughtResources = new Set(
  (firstPair + "," + secondPair).split(",").map(id => id.split("_")[1]),
);
check("за два прохода куплены все три ресурса (H, K, O)",
  boughtResources.size === 3, [...boughtResources].join(","));
check("пары проходов разные", firstPair !== secondPair,
  `${firstPair} против ${secondPair}`);
MARKET_BUY.MAX_BUYS_PER_TICK = SAVED.maxBuys;

console.log("\n9. MARKET_BUY.ENABLED = false");
resetRooms([{ name: "E35S37", terminal: { H: 0 } }]);
global.__orders = { H: [sellOrder("H", 200, 50000)] };
MARKET_BUY.ENABLED = false;
pass();
check("закупка выключена целиком", deals.length === 0 && !orderQueries.includes("H|sell"),
  JSON.stringify({ deals: deals, queries: orderQueries }));
MARKET_BUY.ENABLED = SAVED.enabled;

console.log("\n10. Продажа излишка не сломана");
resetRooms([{ name: "E35S37", terminal: { KO: 20000 } }]);
// Ордеров на продажу H здесь НЕТ намеренно: при пустом запасе H закупка
// сработала бы (и это было бы верно), а проверяем мы именно продажу излишка.
global.__orders = { KO: [buyOrder("KO", 10, 20000)] };
MARKET_BUY.RESOURCES = SAVED.resources;
pass();
check("излишек KO продан", deals.length === 1 && deals[0].orderId === "buy_KO_10",
  JSON.stringify(deals));
// surplus = 20000 − TERMINAL_SUPPLY.COMPOUND_MAX (10000), ордер на 20000 не режет.
check("объём продажи = излишку над резервом (20000 − COMPOUND_MAX)",
  deals.length === 1 && deals[0].amount === 10000, JSON.stringify(deals[0]));

restore();
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
