"use strict";
/**
 * ===================================================
 * MARKET.THROTTLE.TEST.JS — офлайн-проверка throttle и кэша ордеров
 * ===================================================
 * Проверяем ровно то, что даёт выигрыш по CPU (задание 1 плана
 * docs/CPU-OPTIMIZATION-PLAN.md) и при этом не меняет поведение:
 *   1) на тиках, не кратных MARKET.INTERVAL, рынок не трогается вообще;
 *   2) за один проход getAllOrders вызывается один раз на пару
 *      (тип, ресурс), а не по разу на каждый терминал;
 *   3) кэш живёт ровно один тик и на следующем проходе обновляется;
 *   4) сделки по-прежнему заключаются (поведение не изменилось).
 *
 * Запуск: node tests/market.throttle.test.js
 */

/* ── Шим разрешения модулей (как на шарде: require("loadShed")) ────────── */
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

/* ── Минимальные игровые глобалы, которые нужны модулю ────────────────── */
global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.OK = 0;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_UTRIUM = "U";
global.RESOURCE_HYDROGEN = "H";
global.RESOURCE_OXYGEN = "O";
global.RESOURCE_LEMERGIUM = "L";
global.RESOURCE_KEANIUM = "K";
global.RESOURCE_ZYNTHIUM = "Z";
global.RESOURCE_CATALYST = "X";
global.RESOURCES_ALL = [
  "energy",
  "power",
  "battery",
  "U",
  "H",
  "O",
  "Z",
  "K",
  "L",
  "X",
  "OH",
  "ZK",
];

global.Memory = {};

const { MARKET } = require("../constants");

/** Журнал обращений к рынку. */
let orderCalls = [];
let dealCalls = [];

function makeTerminal(roomName, store) {
  return {
    my: true,
    room: { name: roomName },
    store,
  };
}

function makeRoom(roomName, terminal) {
  return { name: roomName, terminal };
}

/**
 * Собирает фейковый Game на заданном тике.
 * Три терминала с избытком утрия — чтобы проверить именно дедупликацию
 * запросов: без кэша было бы три обращения вместо одного.
 *
 * @param {number} time игровой тик
 * @param {number} bucket Game.cpu.bucket: гейт по bucket (шаг 6) пропускает
 *   рынок, когда bucket ниже порога loadShed.lite (по умолчанию 9000)
 */
function setupGame(time, bucket = 10000) {
  orderCalls = [];
  dealCalls = [];

  // Кэши прошлого раздела не должны переезжать в следующий: разделы
  // отличаются только тиком и bucket, и «пустой» ответ кэша выглядел бы
  // как сработавший гейт.
  delete global.__marketOrders;
  delete global.__marketTerminalRooms;
  delete Memory.loadShedThresholds;
  delete Memory.loadShed;

  global.Game = {
    time,
    cpu: { bucket },
    rooms: {
      W1N1: makeRoom("W1N1", makeTerminal("W1N1", { U: 12000, energy: 50000 })),
      W2N1: makeRoom("W2N1", makeTerminal("W2N1", { U: 12000, energy: 50000 })),
      W3N1: makeRoom("W3N1", makeTerminal("W3N1", { U: 12000, energy: 50000 })),
    },
    market: {
      credits: 0,
      orders: {},
      getAllOrders(opts) {
        orderCalls.push(opts.type + "|" + opts.resourceType);
        if (opts.type === global.ORDER_BUY && opts.resourceType === "U") {
          return [
            { id: "order1", price: 1.0, amount: 100, roomName: "W5N5" },
            { id: "order2", price: 0.5, amount: 100, roomName: "W5N5" },
          ];
        }
        return [];
      },
      calcTransactionCost: () => 0,
      deal(orderId, amount, roomName) {
        dealCalls.push(orderId);
        return global.OK;
      },
    },
  };
}

const marketManager = require("../market.manager");

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

console.log("1. Тик не кратен интервалу — рынок не трогается");
setupGame(MARKET.INTERVAL + 1);
marketManager.run();
check("getAllOrders не вызывался", orderCalls.length === 0, String(orderCalls.length));
check("сделок нет", dealCalls.length === 0, String(dealCalls.length));

console.log("\n2. Тик кратен интервалу — один запрос на пару (тип, ресурс)");
setupGame(MARKET.INTERVAL);
marketManager.run();
const buyU = orderCalls.filter(k => k === "buy|U").length;
check("buy|U запрошен ровно 1 раз на 3 терминала", buyU === 1, String(buyU));
check("энергия не запрашивалась (нет избытка)", !orderCalls.includes("buy|energy"), orderCalls.join(","));
check("сделки заключены (3 терминала)", dealCalls.length === 3, String(dealCalls.length));
check(
  "выбран лучший ордер (order1, цена 1.0)",
  dealCalls.every(id => id === "order1"),
  dealCalls.join(","),
);

console.log("\n3. Повторный проход в том же тике — кэш, новых запросов нет");
const before = orderCalls.length;
marketManager.run();
check("новых запросов нет", orderCalls.length === before, String(orderCalls.length - before));

console.log("\n4. Следующий проход (следующее окно) — кэш обновляется");
setupGame(MARKET.INTERVAL * 2);
marketManager.run();
check("buy|U запрошен снова", orderCalls.filter(k => k === "buy|U").length === 1, orderCalls.join(","));

console.log("\n5. Игрок без терминалов — рынок не трогается");
orderCalls = [];
dealCalls = [];
global.Game.rooms = { W1N1: { name: "W1N1", terminal: null } };
marketManager.run();
check("getAllOrders не вызывался", orderCalls.length === 0, String(orderCalls.length));

console.log("\n6. Bucket ниже порога lite — рынок не трогается (шаг 6)");
setupGame(MARKET.INTERVAL * 3, 8999);
marketManager.run();
check("getAllOrders не вызывался", orderCalls.length === 0, String(orderCalls.length));
check("сделок нет", dealCalls.length === 0, String(dealCalls.length));

console.log("\n7. Bucket ровно на пороге (9000) — рынок работает");
// Порог в loadShed строгий (`bucket < lite`), поэтому 9000 — ещё off.
setupGame(MARKET.INTERVAL * 4, 9000);
marketManager.run();
check("getAllOrders вызван", orderCalls.includes("buy|U"), orderCalls.join(","));
check("сделки заключены", dealCalls.length === 3, String(dealCalls.length));

console.log("\n8. Порог переопределяется из консоли (Memory.loadShedThresholds)");
setupGame(MARKET.INTERVAL * 5, 10000);
Memory.loadShedThresholds = { lite: 11000 };
marketManager.run();
check("порог 11000, bucket 10000 → рынок не трогается", orderCalls.length === 0, String(orderCalls.length));
check("сделок нет", dealCalls.length === 0, String(dealCalls.length));

console.log("\n9. Полный bucket — рынок работает как раньше");
setupGame(MARKET.INTERVAL * 6, 10000);
marketManager.run();
check("getAllOrders вызван", orderCalls.includes("buy|U"), orderCalls.join(","));
check("сделки заключены", dealCalls.length === 3, String(dealCalls.length));

console.log("\n10. Без Game.cpu (симулятор) гейт не срабатывает");
setupGame(MARKET.INTERVAL * 7, 10000);
delete global.Game.cpu;
marketManager.run();
check("getAllOrders вызван", orderCalls.includes("buy|U"), orderCalls.join(","));

console.log("\n11. Ручной Memory.loadShed в bucket-гейте не участвует");
// Гейт шага 6 — только по bucket. Ручное глушение рынка (Memory.loadShed
// = "hard") — отдельное решение, здесь зафиксировано текущее поведение.
setupGame(MARKET.INTERVAL * 8, 10000);
Memory.loadShed = "hard";
marketManager.run();
check("ручной hard при полном bucket рынок не глушит", orderCalls.includes("buy|U"), orderCalls.join(","));

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
