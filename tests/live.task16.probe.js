"use strict";
/**
 * Задача 16 «Экономика» — узкие проверки через консоль шарда (только чтение).
 * Проверяем допущения менеджера рынка:
 *   1) `getAllOrders({resourceType})` без `type` возвращает и buy, и sell;
 *   2) сколько стоит доставка (calcTransactionCost) до покупателей из терминалов
 *      империи — комиссия оплачивается энергией, а энергия на shard3 дорогая.
 *
 * Запуск: node tests/live.task16.probe.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXPR = [
  "var r={},b=Game.market.getAllOrders({resourceType:'battery'}),e=Game.market.getAllOrders({resourceType:'energy'});",
  "r.bc={};b.forEach(function(o){r.bc[o.type]=(r.bc[o.type]||0)+1});",
  "r.ec={};e.forEach(function(o){r.ec[o.type]=(r.ec[o.type]||0)+1});",
  "var eb=null,es=null;e.forEach(function(o){if(o.type==='buy'){if(!eb||o.price>eb.price)eb=o}else{if(!es||o.price<es.price)es=o}});",
  "r.eb=[eb.price,eb.remainingAmount,eb.roomName];",
  "r.es=[es.price,es.remainingAmount,es.roomName];",
  "r.b1=['E35S37',b[0].roomName,Game.market.calcTransactionCost(1000,'E35S37',b[0].roomName)];",
  "r.e1=['E35S37',eb.roomName,Game.market.calcTransactionCost(1000,'E35S37',eb.roomName)];",
  "Memory.__t16p=r;",
].join("");

(async () => {
  const res = await api.console(EXPR, SHARD);
  if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
  await sleep(6000);
  const data = (await api.memory.get("__t16p", SHARD)).data;
  console.log(JSON.stringify(data, null, 2));
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
