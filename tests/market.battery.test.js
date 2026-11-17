"use strict";
/**
 * MARKET.BATTERY.TEST.JS — этап 4: продажа батареек по запасу.
 *
 * Запуск: node tests/market.battery.test.js
 */

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

global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.OK = 0;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
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

const { MARKET, TERMINAL_SUPPLY } = require("../constants");
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

let dealCalls = [];
let orderCalls = [];

function makeRoom(name, energy, storageBattery, terminalBattery, terminalEnergy) {
  const terminal = {
    my: true,
    cooldown: 0,
    room: { name },
    store: { energy: terminalEnergy, battery: terminalBattery },
  };
  const storage = {
    store: {
      energy,
      battery: storageBattery,
      getFreeCapacity: () => 500000,
    },
  };
  return {
    name,
    controller: { my: true },
    terminal,
    storage,
  };
}

function setup(time, rooms, orders, cost = 10) {
  dealCalls = [];
  orderCalls = [];
  delete global.__marketOrders;
  delete global.__marketTerminalRooms;
  delete Memory.loadShed;
  delete Memory.loadShedThresholds;
  global.Game = {
    time,
    cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
    rooms: {},
    market: {
      credits: 1000000,
      orders,
      getAllOrders(opts) {
        orderCalls.push(opts.type + "|" + opts.resourceType);
        if (opts.type === global.ORDER_BUY && opts.resourceType === "battery") {
          return orders;
        }
        return [];
      },
      calcTransactionCost: () => cost,
      deal(orderId, amount, roomName) {
        dealCalls.push({ orderId, amount, roomName });
        return global.OK;
      },
    },
  };
  for (const room of rooms) global.Game.rooms[room.name] = room;
}

const orders = [
  { id: "high", price: 1.0, amount: 100000, roomName: "W9N9" },
  { id: "low", price: 0.5, amount: 100000, roomName: "W9N9" },
];

console.log("1. Батарейки продаются без складского резерва");
{
  const rooms = [];
  for (let i = 1; i <= 5; i++) {
    rooms.push(makeRoom("W1N" + i, 210000, i === 1 ? 21200 : 0, 10000, 150000));
  }
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  const total = dealCalls.reduce((a, d) => a + d.amount, 0);
  check("сделки есть", dealCalls.length > 0, dealCalls.length);
  check("сумма сделок <= доступных в терминалах 50000", total <= 50000, total);
  check("сумма сделок <= MAX_DEALS*10000", total <= MARKET.MAX_DEALS_PER_TICK * 10000, total);
  check("цена не ниже low-ордера", dealCalls.every(d => d.orderId === "high"), JSON.stringify(dealCalls));
}

console.log("\n2. Ровно 20 000 — продаётся всё доступное");
{
  const rooms = [makeRoom("W2N1", 210000, 0, 20000, 150000)];
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  check("продано 20 000", dealCalls.length === 1 && dealCalls[0].amount === 20000, JSON.stringify(dealCalls));
}

console.log("\n3. Ниже 20 000 — продаётся всё доступное");
{
  const rooms = [makeRoom("W3N1", 210000, 0, 19999, 150000)];
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  check("продано 19 999", dealCalls.length === 1 && dealCalls[0].amount === 19999, JSON.stringify(dealCalls));
}

console.log("\n4. Объём не превышает доступное в терминале");
{
  const rooms = [makeRoom("W4N1", 210000, 0, 21000, 150000)];
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  check("продано 21 000", dealCalls.length === 1 && dealCalls[0].amount === 21000, JSON.stringify(dealCalls));
}

console.log("\n5. Несколько комнат — каждая продаёт свои батарейки");
{
  const rooms = [];
  for (let i = 1; i <= 5; i++) {
    rooms.push(makeRoom("W5N" + i, 210000, i === 1 ? 21200 : 0, 10000, 150000));
  }
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  const total = dealCalls.reduce((a, d) => a + d.amount, 0);
  check("суммарно не больше доступных 50000", total <= 50000, total);
  const perRoom = {};
  for (const d of dealCalls) perRoom[d.roomName] = (perRoom[d.roomName] || 0) + 1;
  check("каждая комната продала не больше одного раза", Object.values(perRoom).every(n => n === 1), JSON.stringify(perRoom));
}

console.log("\n6. Недостаточно энергии на комиссию — сделки нет");
{
  const rooms = [makeRoom("W6N1", 210000, 0, 70000, TERMINAL_SUPPLY.ENERGY_MIN + 500)];
  setup(MARKET.INTERVAL, rooms, orders, 1000);
  marketManager.run();
  check("сделок нет", dealCalls.length === 0, dealCalls.length);
}

console.log("\n7. Сделка не оставляет складской резерв");
{
  const rooms = [makeRoom("W7N1", 210000, 0, 70000, 150000)];
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  check("продано 70 000", dealCalls.length === 1 && dealCalls[0].amount === 70000, JSON.stringify(dealCalls));
  check("после сделки остаётся 0", 70000 - dealCalls[0].amount === 0);
}

console.log("\n8. Дешёвый ордер не выбирается при дорогом");
{
  const rooms = [makeRoom("W8N1", 210000, 0, 30000, 150000)];
  setup(MARKET.INTERVAL, rooms, orders);
  marketManager.run();
  check("выбран high", dealCalls.every(d => d.orderId === "high"), JSON.stringify(dealCalls));
}

console.log("\n9. Throttle рынка");
{
  const rooms = [makeRoom("W9N1", 210000, 0, 30000, 150000)];
  setup(MARKET.INTERVAL + 1, rooms, orders);
  marketManager.run();
  check("getAllOrders не вызывался", orderCalls.length === 0, orderCalls.length);
  check("сделок нет", dealCalls.length === 0, dealCalls.length);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
