"use strict";
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api = new ScreepsAPI({ token: resolveToken() });
// Роли (linkWorker/miner) с 2026-09 лежат в Memory.cpuStats.roles (opt-in:
// Memory.cpuMonitorRoles), подсистемы — в Memory.cpuStats.profile.blocks.
const CMD = `(function(){var p=(Memory.cpuStats&&Memory.cpuStats.profile)||{},b=p.blocks||{},r=(Memory.cpuStats&&Memory.cpuStats.roles)||{},rb=r.roles||{},o={samples:p.samples||0,roleSamples:r.samples||0,rolesOn:Memory.cpuMonitorRoles===true,t:Game.time};
['linkManager','roomManager'].forEach(function(k){if(b[k])o[k]=b[k].sum.toFixed(1)+'/'+b[k].count+'='+(b[k].sum/b[k].count).toFixed(3);});
['linkWorker','miner'].forEach(function(k){if(rb[k])o[k]=rb[k].sum.toFixed(1)+'/'+rb[k].count+'='+(rb[k].sum/rb[k].count).toFixed(3);});
var c=0;ROOMS=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});
ROOMS.forEach(function(n){c+=Game.rooms[n].find(FIND_MY_CREEPS,{filter:function(x){return x.memory&&x.memory.role==='linkWorker';}}).length;});
o.linkWorkerCreeps=c;console.log('CC'+JSON.stringify(o));})();`;
(async () => {
  let line = null;
  await api.socket.connect();
  api.socket.subscribe("console", (e) => {
    let p; try { p = typeof e === "string" ? JSON.parse(e) : e; } catch (err) { void err; return; }
    const m = p && p.data && p.data.messages; if (!m) return;
    for (const raw of [].concat(m.log||[]).concat(m.error||[]).concat(m.result||[])) {
      const s = String(raw).replace(/&#x22;/g,'"').replace(/&#x3E;/g,'>');
      if (s.indexOf("CC") === 0) line = s.slice(2);
    }
  });
  const res = await api.console(CMD, "shard3");
  if (!res || res.ok !== 1) { console.error("console error", JSON.stringify(res).slice(0,200)); process.exit(1); }
  await new Promise(r => setTimeout(r, 5000));
  try { api.socket.disconnect(); } catch (e) { void e; }
  console.log(line ? JSON.stringify(JSON.parse(line), null, 1) : "нет ответа CC");
})().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
