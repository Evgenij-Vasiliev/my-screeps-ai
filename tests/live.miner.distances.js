"use strict";
/**
 * ЖИВОЙ ЗАМЕР: путь майнера от спавна до рабочего спота — ТОЛЬКО ЧТЕНИЕ.
 * Нужен, чтобы перестать угадывать MOVE в теле майнера: MOVE определяется
 * временем рейса (окно преспавна PRESPAWN_THRESHOLD.miner = 100 тиков минус
 * время спавна 3×частей) и длиной пути.
 *
 * Команды разбиты на две: консоль шарда ограничивает размер выражения.
 *   MD1 — комнаты, число источников, майнеры (ttl, спот, расстояние Чебышёва);
 *   MD2 — для каждого майнера: длина реального пути (findPathTo) и число
 *         болотных клеток на нём (они дороже по усталости).
 *
 * Запуск: node tests/live.miner.distances.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });
const TAGS = ["MD1", "MD2"];

const MYROOMS = `var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});`;

const CMDS = [
  `(function(){${MYROOMS}
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n],S=q.find(FIND_MY_SPAWNS);
var ms=q.find(FIND_MY_CREEPS,{filter:function(c){return c.memory&&c.memory.role==='miner';}});
o[n]={src:q.find(FIND_SOURCES).length,sp:S.length?S[0].pos.x+','+S[0].pos.y:null,m:ms.map(function(c){
var sp=c.memory.spot;
return {n:c.name,ttl:c.ticksToLive,sp:sp?sp.x+','+sp.y:null,d:(sp&&S.length)?Math.max(Math.abs(S[0].pos.x-sp.x),Math.abs(S[0].pos.y-sp.y)):null};});};});
console.log('MD1'+JSON.stringify(o));})();`,

  `(function(){${MYROOMS}
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n],S=q.find(FIND_MY_SPAWNS);
if(!S.length){o[n]='нет спавна';return;}
var ms=q.find(FIND_MY_CREEPS,{filter:function(c){return c.memory&&c.memory.role==='miner';}});
o[n]=ms.map(function(c){var sp=c.memory.spot;if(!sp)return 'нет спота';
var p=S[0].pos.findPathTo(sp.x,sp.y,{ignoreCreeps:true});
var sw=0,tr=q.getTerrain();
for(var i=0;i<p.length;i++){if(tr.get(p[i].x,p[i].y)===TERRAIN_MASK_SWAMP)sw++;}
return c.name+' path='+p.length+' swamp='+sw;});});
console.log('MD2'+JSON.stringify(o));})();`,
];

(async () => {
  const lines = {};
  const dump = [];
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
      const s = String(raw).replace(/&#x22;/g, '"').replace(/&#x3E;/g, ">");
      dump.push(s.slice(0, 300));
      for (const tag of TAGS) {
        if (s.indexOf(tag) === 0) lines[tag] = s.slice(tag.length);
      }
    }
  });
  for (const expr of CMDS) {
    const res = await api.console(expr, SHARD);
    if (!res || res.ok !== 1) {
      console.error("console error:", JSON.stringify(res).slice(0, 300));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }
  for (const tag of TAGS) {
    if (tag in lines) {
      console.log(tag + " = " + JSON.stringify(JSON.parse(lines[tag]), null, 1));
    } else {
      console.log(tag + " — НЕ ПОЛУЧЕНО");
    }
  }
  if (dump.length) {
    console.log("\n--- сырой вывод консоли (первые 5 строк) ---");
    for (const d of dump.slice(0, 5)) console.log(d);
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
