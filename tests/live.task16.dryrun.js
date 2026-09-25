"use strict";
/**
 * ===================================================
 * LIVE.TASK16.DRYRUN.JS — «примерка» новой логики рынка на живые данные
 * ===================================================
 * Читает с шарда терминалы империи (room-objects) и реальные книги заявок
 * (game/market/orders), подставляет их в market.manager через заглушённый Game
 * и печатает, какие сделки менеджер совершил бы СЕЙЧАС — без единого интента
 * на шарде. Нужен, чтобы оценить эффект задачи 16 до деплоя.
 *
 * Оговорка: книга заявок — снимок, он не «выгорает» между фазами (каждая фаза
 * — независимый взгляд на ту же книгу, а не симуляция опустошения ордеров);
 * терминалы при этом реально теряют ресурс, поэтому 2-я и следующие фазы
 * показывают, что можно продать при том же рынке, но уже с меньшим запасом.
 *
 * Комиссия считается по формуле движка `ceil(amount × (1 − e^(−range/30)))`,
 * где range — непрерывная комнатная дистанция (worldSize шарда, координаты как
 * в движке: E/S — +n, W/N — −(n+1)).
 *
 * Запуск: node tests/live.task16.dryrun.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const { MARKET } = require("../constants");
const marketManager = require("../market.manager");

const TOKEN = resolveToken();
const SHARD = "shard3";
const PHASES = 6;

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Дистанция и комиссия (как в движке) ──────────────────────────────────
let WORLD_SIZE = 122;

function roomXY(name) {
  const m = /^([EW])(\d+)([NS])(\d+)$/.exec(name);
  return {
    x: m[1] === "E" ? Number(m[2]) : -(Number(m[2]) + 1),
    y: m[3] === "S" ? Number(m[4]) : -(Number(m[4]) + 1),
  };
}

function rangeBetween(from, to) {
  const a = roomXY(from);
  const b = roomXY(to);
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  dx = Math.min(dx, WORLD_SIZE - dx);
  dy = Math.min(dy, WORLD_SIZE - dy);
  return Math.max(dx, dy);
}

function txCost(amount, from, to) {
  return Math.ceil(amount * (1 - Math.exp(-rangeBetween(from, to) / 30)));
}

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

// ── Данные с шарда ───────────────────────────────────────────────────────
async function fetchOwnRooms() {
  const res = await api.console(
    "var a=[];for(var k in Game.rooms){var r=Game.rooms[k];" +
      "if(r.controller&&r.controller.my&&r.terminal)a.push(k)};" +
      "Memory.__t16r={rooms:a,ws:Game.map.getWorldSize()};",
    SHARD,
  );
  if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
  await sleep(6000);
  const data = (await api.memory.get("__t16r", SHARD)).data;
  await api.console("delete Memory.__t16r; delete Memory.__t16q; OK", SHARD);
  return data;
}

async function fetchTerminals(roomNames) {
  const stores = {};
  for (const room of roomNames) {
    const ans = await api.raw.game.roomObjects(room, SHARD);
    const objects = ans.objects || ans;
    const terminal = objects.find(o => o.type === "terminal");
    if (terminal) stores[room] = terminal.store || {};
  }
  return stores;
}

async function fetchBooks(resourceTypes) {
  const books = {};
  for (const rt of resourceTypes) {
    const ans = await api.raw.game.market.orders(rt, SHARD);
    books[rt] = (ans.list || []).map(o => ({
      id: o._id,
      type: o.type,
      price: o.price,
      amount: o.amount,
      remainingAmount:
        o.remainingAmount === undefined ? o.amount : o.remainingAmount,
      roomName: o.roomName,
    }));
    await sleep(250);
  }
  return books;
}

// ── Заглушка Game с живыми данными ───────────────────────────────────────
function makeGame(terminalStores, books) {
  const rooms = {};
  const terminals = {};
  const allOrders = [];

  for (const [roomName, contents] of Object.entries(terminalStores)) {
    const terminal = {
      room: { name: roomName },
      store: makeStore(300000, contents),
      cooldown: 0,
    };
    rooms[roomName] = { controller: { my: true }, terminal: terminal };
    terminals[roomName] = terminal;
  }

  for (const rt of Object.keys(books)) {
    for (const order of books[rt]) {
      allOrders.push(Object.assign({ resourceType: rt }, order));
    }
  }

  const log = { orders: [], deals: [] };
  const dealOrders = [];

  global.ORDER_BUY = "buy";
  global.ORDER_SELL = "sell";
  global.RESOURCE_ENERGY = "energy";
  global.RESOURCE_POWER = "power";
  global.OK = 0;
  global.Game = {
    time: 5,
    rooms: rooms,
    market: {
      getAllOrders(filter) {
        log.orders.push(filter.resourceType);
        return (books[filter.resourceType] || []).map(o => Object.assign({}, o));
      },
      calcTransactionCost(amount, from, to) {
        return txCost(amount, from, to);
      },
      deal(orderId, amount, roomName) {
        const order = allOrders.find(o => o.id === orderId);
        const terminal = terminals[roomName];
        const resourceType = order.resourceType;
        const fee = txCost(amount, roomName, order.roomName);
        if ((terminal.store[resourceType] || 0) < amount) return -6;

        terminal.store[resourceType] -= amount;
        terminal.store[RESOURCE_ENERGY] =
          (terminal.store[RESOURCE_ENERGY] || 0) - fee;
        order.remainingAmount -= amount;
        const record = {
          orderId: order.id,
          roomName: roomName,
          resourceType: resourceType,
          amount: amount,
          price: order.price,
          buyerRoom: order.roomName,
          fee: fee,
          gross: amount * order.price,
          range: rangeBetween(roomName, order.roomName),
        };
        log.deals.push(record);
        dealOrders.push(record);
        return OK;
      },
    },
  };

  return { rooms: rooms, log: log };
}

// ── Диагностика: почему ресурс не продался ───────────────────────────────
function explain(resourceType, books, terminals) {
  let sellable = 0;
  let roomName = null;
  for (const terminal of Object.values(terminals)) {
    const amount = marketManager.sellableFrom(terminal, resourceType);
    sellable += amount;
    if (amount >= MARKET.MIN_DEAL_AMOUNT && !roomName) roomName = terminal.room.name;
  }
  if (sellable < MARKET.MIN_DEAL_AMOUNT) return `нет излишка (резерв ${MARKET.SELL_RESERVE[resourceType] || 0})`;

  const book = books[resourceType] || [];
  const bid = marketManager.bestBuyOrder(book);
  if (!bid) return "нет заявок покупки";
  const ask = marketManager.bestSellOrder(book);
  if (ask && bid.price < ask.price * MARKET.MIN_SELL_PRICE_RATIO) {
    return `бид ${bid.price.toFixed(3)} < ${MARKET.MIN_SELL_PRICE_RATIO}×аск ${ask.price.toFixed(3)}`;
  }

  const candidates = marketManager.buyCandidates(
    book,
    MARKET.MAX_ORDER_CANDIDATES,
  );
  const notes = [];
  for (const order of candidates) {
    const amount = Math.min(sellable, order.remainingAmount);
    if (amount < MARKET.MIN_DEAL_AMOUNT) continue;
    const fee = txCost(amount, roomName, order.roomName);
    const gross = amount * order.price;
    const margin = (gross - fee * bid.price) / gross;
    notes.push(
      `${order.price.toFixed(3)}@${order.roomName}(range ${
        rangeBetween(roomName, order.roomName)
      }, миг ${fee}, маржа ${(margin * 100).toFixed(0)}%)`,
    );
  }
  return `кандидаты: ${notes.join(" | ") || "нет"}`;
}


// ── Запуск ───────────────────────────────────────────────────────────────
async function main() {
  const info = await fetchOwnRooms();
  const roomNames = info.rooms;
  WORLD_SIZE = info.ws;
  console.log(`Комнат с терминалом: ${roomNames.join(", ")} (worldSize ${WORLD_SIZE})`);

  const terminalStores = await fetchTerminals(roomNames);
  for (const [room, store] of Object.entries(terminalStores)) {
    console.log(
      `${room}: занято ${storeUsed(store)}/300000 — ${JSON.stringify(store)}`,
    );
  }

  const types = [];
  for (const rt of MARKET.SELL_RESOURCES) types.push(rt);
  if (types.indexOf("energy") === -1) types.push("energy");
  for (const rt of MARKET.BUY_RESOURCES) types.push(rt);
  const books = await fetchBooks(types);

  const world = makeGame(terminalStores, books);
  const terminalByName = {};
  for (const room of roomNames) {
    terminalByName[room] = world.rooms[room].terminal;
  }

  const totals = {
    deals: 0,
    credits: 0,
    fee: 0,
    byResource: {},
    byRoom: {},
  };

  const origLog = console.log;
  for (let phase = 0; phase < PHASES; phase++) {
    Game.time = MARKET.CHECK_INTERVAL * (phase + 1);
    world.log.orders.length = 0;
    world.log.deals.length = 0;
    console.log = () => {}; // сделки печатаем только в сводке
    try {
      marketManager.run();
    } finally {
      console.log = origLog;
    }

    let credits = 0;
    let fee = 0;
    for (const deal of world.log.deals) {
      totals.deals++;
      totals.credits += deal.gross;
      totals.fee += deal.fee;
      credits += deal.gross;
      fee += deal.fee;
      const byRes = totals.byResource[deal.resourceType] || {
        amount: 0,
        credits: 0,
        fee: 0,
      };
      byRes.amount += deal.amount;
      byRes.credits += deal.gross;
      byRes.fee += deal.fee;
      totals.byResource[deal.resourceType] = byRes;
      const byRoom = totals.byRoom[deal.roomName] || { amount: 0, credits: 0 };
      byRoom.amount += deal.amount;
      byRoom.credits += deal.gross;
      totals.byRoom[deal.roomName] = byRoom;
    }
    console.log(
      `тик ${Game.time}: сделок ${world.log.deals.length}, ` +
        `кредитов ${credits}, комиссия ${fee} энергии, ` +
        `обращений к рынку ${world.log.orders.length} (${world.log.orders.join(", ")})`,
    );
    for (const deal of world.log.deals) {
      console.log(
        `    ${deal.roomName} → ${deal.resourceType} ${deal.amount} ` +
          `по ${deal.price.toFixed(3)} = ${Math.round(deal.gross)} кр ` +
          `(покупатель ${deal.buyerRoom}, range ${deal.range}, комиссия ${deal.fee})`,
      );
    }
  }

  console.log("\n── Итог за 6 фаз (30 тиков) ──");
  console.log(
    `сделок ${totals.deals}, кредитов ${Math.round(totals.credits)}, ` +
      `комиссия ${totals.fee} энергии`,
  );
  for (const rt of Object.keys(totals.byResource)) {
    const r = totals.byResource[rt];
    console.log(
      `  ${rt.padEnd(8)} продано ${String(r.amount).padStart(7)}, ` +
        `кредитов ${String(Math.round(r.credits)).padStart(10)}, ` +
        `комиссия ${String(r.fee).padStart(7)} энергии`,
    );
  }
  for (const room of Object.keys(totals.byRoom)) {
    const r = totals.byRoom[room];
    console.log(
      `  ${room}: продано ${r.amount}, кредитов ${Math.round(r.credits)}`,
    );
  }

  console.log("\n── Почему остальные ресурсы не проданы ──");
  for (const rt of types) {
    console.log(`  ${rt.padEnd(8)} ${explain(rt, books, terminalByName)}`);
  }

  console.log("\n── Терминалы после 6 фаз ──");
  for (const room of roomNames) {
    const terminal = world.rooms[room].terminal;
    console.log(`${room}: занято ${storeUsed(terminal.store)}/300000`);
  }
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});

