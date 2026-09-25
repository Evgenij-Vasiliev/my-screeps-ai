"use strict";
/**
 * Задача 16 «Экономика: рынок и структуры» — снимок только для чтения.
 * Собирает на живом шарде:
 *   - комнаты: RCL, storage/terminal/factory/powerSpawn (store), лабы, минералы;
 *   - Memory.rooms[*].terminalExports и конфиги лаб;
 *   - рынок: credits, лучшие ORDER_BUY/ORDER_SELL/историю по ресурсам,
 *     которые реально лежат в избытке.
 * Результат кладётся в Memory.__t16 и печатается локально.
 *
 * Запуск: node tests/live.task16.inspect.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Выражение разбито на части: у консоли шарда есть лимит на размер expression.
const EXPR_MAIN = [
  "var res={tick:Game.time,shard:Game.shard.name,credits:Game.market.credits};",
  "res.rooms={};",
  "Object.keys(Game.rooms).forEach(function(n){var r=Game.rooms[n];if(!r.controller||!r.controller.my)return;",
  "res.rooms[n]={rcl:r.controller.level,name:n,",
  "storage:r.storage?JSON.parse(JSON.stringify(r.storage.store)):null,",
  "terminal:r.terminal?JSON.parse(JSON.stringify(r.terminal.store)):null};});",
  "Memory.__t16=res;",
].join("");

const EXPR_STRUCT = [
  "var res=Memory.__t16;",
  "Object.keys(res.rooms).forEach(function(n){var r=Game.rooms[n];if(!r)return;var o=res.rooms[n];",
  "var fs=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_FACTORY}});",
  "if(fs[0])o.factory={store:JSON.parse(JSON.stringify(fs[0].store)),cooldown:fs[0].cooldown,level:fs[0].level};",
  "var ps=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_POWER_SPAWN}});",
  "if(ps[0])o.powerSpawn=JSON.parse(JSON.stringify(ps[0].store));",
  "if(r.mineral)o.myMineral={type:r.mineral.mineralType,amount:r.mineral.mineralAmount};",
  "var labs=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_LAB}});",
  "o.labCount=labs.length;o.labs={};labs.forEach(function(l){o.labs[l.id.slice(-6)]=JSON.parse(JSON.stringify(l.store))});",
  "var mem=Memory.rooms[n]||{};o.terminalExports=mem.terminalExports||null;",
  "o.labConfigs={};['labs','labs2','labs3','labs4','labs5'].forEach(function(k){if(mem[k])o.labConfigs[k]=mem[k]});});",
  "Memory.__t16=res;",
].join("");

/** Лучшая цена и объём по каждому типу ордера. */
function summarize(orders, type) {
  const filtered = (orders || []).filter(o => o.type === type);
  if (filtered.length === 0) return null;
  const best = filtered.reduce((b, o) =>
    type === "buy" ? (o.price > b.price ? o : b) : o.price < b.price ? o : b,
  );
  return {
    count: filtered.length,
    price: best.price,
    amount: best.amount,
    remaining: best.remainingAmount,
    room: best.roomName,
  };
}

async function marketFor(resourceType) {
  const res = await api.raw.game.market.orders(resourceType, SHARD);
  const list = (res && res.list) || [];
  let stats = null;
  try {
    const s = await api.raw.game.market.stats(resourceType, SHARD);
    stats = (s && s.stats) || null;
  } catch {
    /* статистики может не быть — не критично */
  }
  return {
    resourceType,
    orders: list.length,
    bestBuy: summarize(list, "buy"),
    bestSell: summarize(list, "sell"),
    stats: stats ? { avgPrice: stats.avgPrice, stddevPrice: stats.stddevPrice } : null,
  };
}

(async () => {
  for (const [name, expr] of [
    ["MAIN", EXPR_MAIN],
    ["STRUCT", EXPR_STRUCT],
  ]) {
    const res = await api.console(expr, SHARD);
    if (!res || res.ok !== 1)
      throw new Error(`console ${name}: ` + JSON.stringify(res));
    await sleep(3000);
  }
  const data = (await api.memory.get("__t16", SHARD)).data;

  // Типы ресурсов, реально лежащие в storage/terminal, + важные для рынка.
  const types = new Set(["energy", "power", "battery"]);
  for (const room of Object.values(data.rooms || {})) {
    for (const holder of [room.storage, room.terminal]) {
      if (holder) for (const rt of Object.keys(holder)) types.add(rt);
    }
    if (room.factory && room.factory.store)
      for (const rt of Object.keys(room.factory.store)) types.add(rt);
    if (room.myMineral && room.myMineral.type) types.add(room.myMineral.type);
  }

  const market = [];
  for (const rt of types) {
    market.push(await marketFor(rt));
    await sleep(300);
  }
  data.market = market;

  require("fs").writeFileSync("/tmp/t16.json", JSON.stringify(data, null, 2));
  console.log("Полный снимок: /tmp/t16.json");
  for (const [rt, m] of market.map(m => [m.resourceType, m])) {
    console.log(
      `${rt.padEnd(10)} buy=${m.bestBuy ? m.bestBuy.price + "×" + m.bestBuy.amount : "-"}` +
        ` sell=${m.bestSell ? m.bestSell.price + "×" + m.bestSell.amount : "-"}`,
    );
  }
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
