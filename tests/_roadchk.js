"use strict";
/**
 * ЖИВОЙ ЗАМЕР (только чтение): покрытие путей майнеров ДОРОГАМИ и болото БЕЗ
 * дороги. Нужен, чтобы понять реальную цену рейса: усталость на дороге —
 * 1 за тяжёлую часть, на болоте — 5.
 *
 * Запуск: node tests/_roadchk.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const api = new ScreepsAPI({
  token: resolveToken(),
});

const CMD = `(function(){
var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n],S=q.find(FIND_MY_SPAWNS);
if(!S.length)return;
var roads={};
q.find(FIND_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_ROAD;}}).forEach(function(s){roads[s.pos.x+','+s.pos.y]=1;});
var ms=q.find(FIND_MY_CREEPS,{filter:function(c){return c.memory&&c.memory.role==='miner';}});
o[n]=ms.map(function(c){var sp=c.memory.spot;if(!sp)return 'нет спота';
var p=S[0].pos.findPathTo(sp.x,sp.y,{ignoreCreeps:true});
var r=0,tr=q.getTerrain(),swNoRoad=0;
for(var i=0;i<p.length;i++){var k=p[i].x+','+p[i].y;
 var isRoad=!!roads[k]; if(isRoad)r++;
 if(tr.get(p[i].x,p[i].y)===TERRAIN_MASK_SWAMP&&!isRoad)swNoRoad++;}
return 'path='+p.length+' roads='+r+' swampNoRoad='+swNoRoad;});});
console.log('RC'+JSON.stringify(o));})();`;

(async () => {
  let line = null;
  await api.socket.connect();
  api.socket.subscribe("console", (e) => {
    let p;
    try {
      p = typeof e === "string" ? JSON.parse(e) : e;
    } catch (err) {
      void err;
      return;
    }
    const m = p && p.data && p.data.messages;
    if (!m) return;
    for (const raw of []
      .concat(m.log || [])
      .concat(m.error || [])
      .concat(m.result || [])) {
      const s = String(raw).replace(/&#x22;/g, '"').replace(/&#x3E;/g, ">");
      if (s.indexOf("RC") === 0) line = s.slice(2);
    }
  });
  const res = await api.console(CMD, "shard3");
  if (!res || res.ok !== 1) {
    console.error("console error", JSON.stringify(res).slice(0, 200));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 5000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }
  console.log(line ? JSON.stringify(JSON.parse(line), null, 1) : "нет ответа RC");
})().catch((e) => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
