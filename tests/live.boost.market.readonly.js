"use strict";
/**
 * ЖИВОЙ СНИМОК РЫНКА И МИНЕРАЛОВ — ТОЛЬКО ЧТЕНИЕ.
 *
 * Зачем: план бустов держится на сырье (K, U, Z, H, O) и катализаторе X. Если
 * минерал комнаты выработан, а ресурса нет в BUY_RESOURCES, вся цепочка встаёт
 * независимо от лабораторий. Скрипт показывает:
 *   - минерал и extractor каждой owned-комнаты (FIND_MINERALS, не room.mineral);
 *   - запас сырья/бустов по комнатам;
 *   - книгу ПРОДАЖ рынка по каждому нужному ресурсу (число заявок, минимум
 *     цены, суммарный объём) и кредиты аккаунта.
 *
 * Запуск: node tests/live.boost.market.readonly.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const ROOMS = ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"];
const RES = [
  "K", "U", "Z", "H", "O", "X", "KH", "UO", "ZO", "OH", "KH2O", "UHO2", "ZHO2",
];
const TAGS = ["LIVEMIN", "LIVESTOCK", "LIVEMKT"];

const CMDS = [
  // ВАЖНО: room.mineral в консоли шарда возвращает undefined даже при живом
  // месторождении, поэтому единственный надёжный способ — FIND_MINERALS.
  `(function(){var o={};${JSON.stringify(ROOMS)}.forEach(function(n){
var q=Game.rooms[n];if(!q){o[n]=null;return;}
var m=q.find(FIND_MINERALS);
o[n]=m.length?m.map(function(x){return x.mineralType+':'+x.mineralAmount;}).join(','):'none';});
console.log('LIVEMIN'+JSON.stringify(o));})();`,

  `(function(){var B=${JSON.stringify(RES)};
function pick(o){var r={};if(!o)return r;for(var i=0;i<B.length;i++)if(o.store[B[i]]>0)r[B[i]]=o.store[B[i]];return r;}
var o={};${JSON.stringify(ROOMS)}.forEach(function(n){var q=Game.rooms[n];if(!q)return;
o[n]={st:pick(q.storage),te:pick(q.terminal)};});
console.log('LIVESTOCK'+JSON.stringify(o));})();`,

  `(function(){var R=${JSON.stringify(["XKH2O", "XZHO2", "XUHO2", "K", "U", "Z", "H", "O"])};
var o={credits:Math.floor(Game.market.credits)};R.forEach(function(r){
var s=Game.market.getAllOrders({type:'sell',resourceType:r});
var n=s.length,amt=0,min=1e9;for(var i=0;i<n;i++){amt+=s[i].remainingAmount||0;var p=s[i].price;if(p<min)min=p;}
o[r]={n:n,amount:amt,min:min===1e9?null:Math.round(min*100)/100};});
console.log('LIVEMKT'+JSON.stringify(o));})();`,
];

(async () => {
  const lines = {};
  await api.socket.connect();
  api.socket.subscribe("console", (event) => {
    let payload;
    try {
      payload = typeof event === "string" ? JSON.parse(event) : event;
    } catch (err) {
      void err;
      return;
    }
    const msgs = payload && payload.data && payload.data.messages;
    if (!msgs) return;
    const all = []
      .concat(msgs.log || [])
      .concat(msgs.error || [])
      .concat(msgs.result || []);
    for (const raw of all) {
      const line = String(raw).replace(/&#x22;/g, '"').replace(/&#x3E;/g, ">");
      for (const tag of TAGS) {
        if (line.indexOf(tag) === 0) lines[tag] = line.slice(tag.length);
      }
    }
  });

  for (const expr of CMDS) {
    const res = await api.console(expr, SHARD);
    if (!res || res.ok !== 1) {
      console.error("console error:", JSON.stringify(res).slice(0, 200));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }

  const out = {};
  for (const tag of Object.keys(lines)) {
    try {
      out[tag] = JSON.parse(lines[tag]);
    } catch (err) {
      void err;
      out[tag] = lines[tag];
    }
  }
  console.log(JSON.stringify(out, null, 1));
  const missing = TAGS.filter((t) => !(t in out));
  if (missing.length) {
    console.error("Не получены секции: " + missing.join(","));
    process.exit(2);
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
