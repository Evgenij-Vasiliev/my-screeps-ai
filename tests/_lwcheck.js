"use strict";
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api = new ScreepsAPI({ token: resolveToken() });
const CMD = `(function(){var K=require('constants');
var o={t:Game.time,body:K.CREEP_BODIES.linkWorker,prespawn:K.PRESPAWN_THRESHOLD.linkWorker,
workerBody:K.CREEP_BODIES.worker,minerBody:K.CREEP_BODIES.miner,rooms:{}};
Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;}).forEach(function(n){
var q=Game.rooms[n];
o.rooms[n]=q.find(FIND_MY_CREEPS,{filter:function(x){return x.memory&&x.memory.role==='linkWorker';}}).map(function(x){
return x.body.length+'ч ttl='+x.ticksToLive;});});
console.log('LW'+JSON.stringify(o));})();`;
(async () => {
  let line = null;
  await api.socket.connect();
  api.socket.subscribe("console", (e) => {
    let p; try { p = typeof e === "string" ? JSON.parse(e) : e; } catch (err) { void err; return; }
    const m = p && p.data && p.data.messages; if (!m) return;
    for (const raw of [].concat(m.log||[]).concat(m.error||[]).concat(m.result||[])) {
      const s = String(raw).replace(/&#x22;/g,'"').replace(/&#x3E;/g,'>');
      if (s.indexOf("LW") === 0) line = s.slice(2);
    }
  });
  const res = await api.console(CMD, "shard3");
  if (!res || res.ok !== 1) { console.error("console error", JSON.stringify(res).slice(0,200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 6000));
  try { api.socket.disconnect(); } catch (e) { void e; }
  console.log(line ? JSON.stringify(JSON.parse(line), null, 1) : "нет ответа LW");
})().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
