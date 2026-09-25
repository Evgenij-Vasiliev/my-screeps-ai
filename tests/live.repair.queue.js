"use strict";
/**
 * ЖИВОЙ СНИМОК ОЧЕРЕДИ РЕМОНТА — ТОЛЬКО ЧТЕНИЕ.
 * Состав очереди repairStructures по комнатам: сколько задач, какие типы
 * структур, сколько хитов осталось добрать. Нужен, чтобы понять, что именно
 * ремонтируют воркеры (башни ремонтируют 1 цель за REPAIR_INTERVAL).
 *
 * Запуск: node tests/live.repair.queue.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const CMDS = [
  `(function(){var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n];var t=((Memory.rooms[n]||{}).tasks||{}).repairStructures||[];
var by={},mh=0;
t.forEach(function(k){var s=Game.getObjectById(k.targetId);if(!s)return;
var ty=s.structureType;by[ty]=(by[ty]||0)+1;mh+=s.hitsMax-s.hits;});
o[n]={tasks:t.length,byType:by,missingHits:mh,
ctrl:q.controller?q.controller.ticksToDowngrade:null,
up:(((Memory.rooms[n]||{}).tasks||{}).upgradeController||[]).length};});
console.log('RQ'+JSON.stringify(o));})();`,
  `(function(){var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});
var o={t:Game.time};
R.forEach(function(n){var c=Game.rooms[n].find(FIND_MY_CREEPS,{filter:function(x){return x.memory&&x.memory.role==='worker';}});
o[n]=c.map(function(x){var w=0,ca=0,m=0;
for(var i=0;i<x.body.length;i++){var t=x.body[i].type;if(t===WORK)w++;else if(t===CARRY)ca++;else if(t===MOVE)m++;}
return w+'/'+ca+'/'+m;});});
console.log('WB'+JSON.stringify(o));})();`,
  `(function(){var g=require('task.generators');
var s=g.generateRepairStructures?String(g.generateRepairStructures):'';
var e=require('task.executors').executors;
var r=e.repairStructures?String(e.repairStructures):'';
console.log('VER'+JSON.stringify({genRoad: s.indexOf('STRUCTURE_ROAD')!==-1,
execRoad: r.indexOf('STRUCTURE_ROAD')!==-1, genLen: s.length, execLen: r.length}));})();`,
];

const TAGS = ["RQ", "WB", "VER"];

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
    await new Promise((r) => setTimeout(r, 2500));
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
