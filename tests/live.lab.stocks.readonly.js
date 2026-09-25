"use strict";
/**
 * ЖИВОЙ СНИМОК ЛАБОРАТОРНОГО КОНТУРА — ТОЛЬКО ЧТЕНИЕ.
 *
 * Ничего не пишет ни в Memory, ни в игру: команды в консоль шарда печатают JSON
 * через console.log, а результат забирается по websocket-подписке 'console'
 * (см. screeps-api). Тот же приём, что в остальных live-скриптах проекта, но без
 * записей Memory.__*.
 *
 * ВАЖНО: консоль шарда ограничивает размер выражения, поэтому снимок собирается
 * из НЕСКОЛЬКИХ маленьких команд (каждая печатает одну строку с меткой), а не
 * одной большой.
 *
 * Что показывает:
 *   - минерал каждой owned-комнаты (тип и остаток) — ключевой факт для цепочек;
 *   - storage и terminal каждой комнаты (полные store);
 *   - тройки Memory.rooms[*].labs* (активный рецепт, paused, реагенты, продукт);
 *   - store лабораторий троек и буст-лабы;
 *   - имена ресурсов движка (REACTIONS/BOOSTS) и стоимость буста;
 *   - CPU-бакеты labManager/labWorker/terminalNetwork/marketManager;
 *   - запас X по империи и журнал сделок Memory.__xDeal.
 *
 * Запуск: node tests/live.lab.stocks.readonly.js
 * Токен: SCREEPS_TOKEN или встроенный (как в остальных live-тестах проекта).
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const ROOMS = ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"];
const TAGS = ["SNAP_ROOMS", "SNAP_PLAN", "SNAP_LABS", "SNAP_ENG", "SNAP_X"];

const CMDS = [
  `(function(){function s(o){var r={};if(!o)return null;for(var k in o.store)if(o.store[k]>0)r[k]=o.store[k];return r;}
var o={t:Game.time,r:{}};${JSON.stringify(ROOMS)}.forEach(function(n){var q=Game.rooms[n],e={v:!!q};
if(q){e.st=s(q.storage);e.te=s(q.terminal);e.mi=q.mineral?q.mineral.mineralType+':'+q.mineral.mineralAmount:null;}o.r[n]=e;});
console.log('SNAP_ROOMS'+JSON.stringify(o));})();`,
  `(function(){var o={};${JSON.stringify(ROOMS)}.forEach(function(n){var m=Memory.rooms[n]||{},e={};
['labs','labs2','labs3'].forEach(function(k){var c=m[k];if(!c)return;
e[k]=c.active+'|paused='+(c.paused===true)+'|'+c.reagent1+'+'+c.reagent2+'=>'+c.product+'|'+c.lowA+'/'+c.highA+'|'+c.lowB+'/'+c.highB;});o[n]=e;});
console.log('SNAP_PLAN'+JSON.stringify(o));})();`,
  `(function(){function s(o){var r={};if(!o)return null;for(var k in o.store)if(o.store[k]>0)r[k]=o.store[k];return r;}
var o={};${JSON.stringify(ROOMS)}.forEach(function(n){var m=Memory.rooms[n]||{},e={};
['labs','labs2','labs3'].forEach(function(k){var c=m[k];if(!c)return;var x={};
['lab1','lab2','reactor'].forEach(function(sl){var L=c[sl]?Game.getObjectById(c[sl]):null;x[sl]=L?s(L):null;});
if(c.reactor){var R=Game.getObjectById(c.reactor);x.cd=R?R.cooldown:null;}e[k]=x;});
var b=m.boostLab?Game.getObjectById(m.boostLab):null;e.boost=b?s(b):null;o[n]=e;});
console.log('SNAP_LABS'+JSON.stringify(o));})();`,
  `(function(){var o={uoo:REACTIONS.UO.OH,uho:REACTIONS.UH.OH,
wh:BOOSTS.work.UHO2?BOOSTS.work.UHO2.harvest:null,whx:BOOSTS.work.XUHO2?BOOSTS.work.XUHO2.harvest:null,
atk:BOOSTS.attack.UH2O?BOOSTS.attack.UH2O.attack:null,
min:LAB_BOOST_MINERAL,en:LAB_BOOST_ENERGY,rea:LAB_REACTION_AMOUNT,
t60:REACTION_TIME.XKH2O+','+REACTION_TIME.XUHO2+','+REACTION_TIME.OH};
var p=Memory.cpuStats||{};if(p.profile&&p.profile.blocks){var b=p.profile.blocks,c={};
['labManager','terminalNetwork','boostManager','marketManager','roomManager'].forEach(function(k){if(b[k])c[k]=Math.round(b[k].sum/b[k].count*1000)/1000;});
c.samples=p.profile.samples;o.cpu=c;}
var r=p.roles||{};if(r.roles){var rb=r.roles,rc={};
['labWorker','linkWorker','miner'].forEach(function(k){if(rb[k])rc[k]=Math.round(rb[k].sum/r.samples*1000)/1000;});
rc.samples=r.samples;o.cpuRoles=rc;}o.avg=p.average||null;o.bucket=Game.cpu.bucket;
console.log('SNAP_ENG'+JSON.stringify(o));})();`,
  `(function(){var x=0;${JSON.stringify(ROOMS)}.forEach(function(n){var q=Game.rooms[n];if(!q)return;
var m=Memory.rooms[n]||{};['labs','labs2','labs3'].forEach(function(k){var c=m[k];if(!c)return;
['lab1','lab2','reactor'].forEach(function(sl){var L=c[sl]?Game.getObjectById(c[sl]):null;if(L)x+=L.store.X||0;});});
var b=m.boostLab?Game.getObjectById(m.boostLab):null;if(b)x+=b.store.X||0;
if(q.storage)x+=q.storage.store.X||0;if(q.terminal)x+=q.terminal.store.X||0;});
console.log('SNAP_X'+JSON.stringify({x:x,xDeal:Memory.__xDeal||null}));})();`,
];

(async () => {
  const lines = {};
  await api.socket.connect();
  api.socket.subscribe("console", (event) => {
    let payload;
    try {
      payload = typeof event === "string" ? JSON.parse(event) : event;
    } catch (err) {
      void err; // не JSON — не наша строка
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
    await new Promise((r) => setTimeout(r, 1500));
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err; // сокет мог уже закрыться
  }

  const out = {};
  for (const tag of Object.keys(lines)) {
    try {
      out[tag] = JSON.parse(lines[tag]);
    } catch (err) {
      void err; // секция не JSON — отдаём как есть
      out[tag] = lines[tag];
    }
  }
  console.log(JSON.stringify(out));
  const missing = TAGS.filter((t) => !(t in out));
  if (missing.length) {
    console.error("Не получены секции: " + missing.join(","));
    process.exit(2);
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
