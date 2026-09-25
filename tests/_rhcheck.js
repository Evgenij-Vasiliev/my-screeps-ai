"use strict";
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api = new ScreepsAPI({ token: resolveToken() });
const CMD = `(function(){var K=require('constants'),o={t:Game.time,
body:K.CREEP_BODIES.remoteHauler,quota:K.SPAWN_QUOTA.remoteHauler,slots:K.REMOTE.HAULERS_PER_ROOM,h:[]};
Object.keys(Game.creeps).forEach(function(n){var c=Game.creeps[n];
if(!c.memory||c.memory.role!=='remoteHauler')return;
var ca=0,m=0;for(var i=0;i<c.body.length;i++){var t=c.body[i].type;if(t===CARRY)ca++;else if(t===MOVE)m++;}
o.h.push(n+' tr='+(c.memory.targetRoom||'-')+' '+ca+'/'+m+' cap='+c.store.getCapacity()+' ttl='+c.ticksToLive);});
console.log('RC'+JSON.stringify(o));})();`;
(async () => {
  let line = null;
  await api.socket.connect();
  api.socket.subscribe("console", (e) => {
    let p; try { p = typeof e === "string" ? JSON.parse(e) : e; } catch (err) { return; }
    const m = p && p.data && p.data.messages; if (!m) return;
    for (const raw of [].concat(m.log||[]).concat(m.error||[]).concat(m.result||[])) {
      const s = String(raw).replace(/&#x22;/g,'"').replace(/&#x3E;/g,'>');
      if (s.indexOf("RC") === 0) line = s.slice(2);
    }
  });
  const res = await api.console(CMD, "shard3");
  if (!res || res.ok !== 1) { console.error("console error", JSON.stringify(res).slice(0,150)); process.exit(1); }
  await new Promise(r => setTimeout(r, 6000));
  try { api.socket.disconnect(); } catch (e) { void e; }
  console.log(line ? JSON.stringify(JSON.parse(line), null, 1) : "нет ответа RC");
})().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
