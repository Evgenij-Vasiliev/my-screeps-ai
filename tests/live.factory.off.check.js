"use strict";
/**
 * ПРОВЕРКА НА ЖИВОМ ШАРДЕ — ТОЛЬКО ЧТЕНИЕ.
 * Что показывает: выключены ли фабричные флаги, остались ли в очередях Memory
 * задачи fillFactoryEnergy/collectFactoryBattery, и текущие энергии
 * storage/terminal/фабрики по комнатам.
 *
 * Запуск: node tests/live.factory.off.check.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const MYROOMS = `var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});`;

const CMDS = [
  `(function(){var K=require('constants');var c=K.TASK_CONFIG;
var o={factory:c.factory,fillFactoryEnergy:c.fillFactoryEnergy,collectFactoryBattery:c.collectFactoryBattery,
fillTerminalEnergy:c.fillTerminalEnergy,fillTerminalResources:c.fillTerminalResources,powerSpawn:c.powerSpawn,
workerBody:K.CREEP_BODIES.worker,normalBody:K.WORKER.NORMAL_BODY_ENERGY,
minerBody:K.CREEP_BODIES.miner,minerPrespawn:K.PRESPAWN_THRESHOLD.miner};
var q={};${MYROOMS}
R.forEach(function(n){var t=(Memory.rooms[n]||{}).tasks||{},e={};
Object.keys(t).forEach(function(k){if(t[k]&&t[k].length)e[k]=t[k].length;});
q[n]=e;});
o.queues=q;console.log('CHK'+JSON.stringify(o));})();`,
  `(function(){function e(o){return o?(o.store.energy||0):0;}
var o={t:Game.time};${MYROOMS}
R.forEach(function(n){var q=Game.rooms[n];
var f=q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==='factory';}})[0];
o[n]={st:e(q.storage),te:e(q.terminal),fe:f?(f.store.energy||0):null,
fb:f?(f.store.battery||0):null,cd:f?f.cooldown:null,
labE:q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==='lab';}}).reduce(function(a,s){return a+(s.store.energy||0);},0),
labN:q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==='lab';}}).length};});
console.log('NRG'+JSON.stringify(o));})();`,
  `(function(){${MYROOMS}
var o={t:Game.time};
R.forEach(function(n){var c=Game.rooms[n].find(FIND_MY_CREEPS,{filter:function(x){return x.memory&&x.memory.role==='miner';}});
o[n]=c.map(function(x){var w=0,ca=0,m=0;
for(var i=0;i<x.body.length;i++){var t=x.body[i].type;if(t===WORK)w++;else if(t===CARRY)ca++;else if(t===MOVE)m++;}
return w+'/'+ca+'/'+m;});});
console.log('MB'+JSON.stringify(o));})();`,
];

const TAGS = ["CHK", "NRG", "MB"];

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
      console.error("console error:", JSON.stringify(res).slice(0, 300));
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
  for (const tag of TAGS) {
    if (!(tag in lines)) {
      console.error("нет секции " + tag);
      process.exit(2);
    }
    console.log(tag + " = " + JSON.stringify(JSON.parse(lines[tag]), null, 1));
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
