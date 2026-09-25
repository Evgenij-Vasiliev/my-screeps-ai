"use strict";
/**
 * ЖИВОЙ ЗАМЕР: CPU по бакетам + покрытие ремонта башнями — ТОЛЬКО ЧТЕНИЕ.
 *
 * Отвечает на два вопроса сразу:
 *   1) CPU — Memory.cpuStats.average и профиль по бакетам (окно cpuMonitor).
 *      Сравнивать с базой 17.09.2026 (docs/PROJECT_AUDIT_AND_ROADMAP.md):
 *      roomManager 0.7391 мс/тик (9.46 %), роли 64.03 %, генерация задач 12.70 %.
 *      Выросший бакет — виновник; отдельно смотреть "towers" (там теперь ремонт
 *      каждый тик) и "worker" (там Task System).
 *   2) Покрытие: сколько долга ремонта лежит ВНЕ радиуса всех башен
 *      (TOWER_FALLOFF_RANGE). outR > 0 — эти дороги не ремонтирует никто
 *      (воркерам дороги запрещены), outO — работа воркеров-фолбэка.
 *
 * Команды держим короткими: консоль Screeps отклоняет слишком большие
 * выражения («expression size is too large»), поэтому без отступов и с
 * короткими именами.
 *
 * Запуск: node tests/live.tower.coverage.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const CMDS = [
  // 1. CPU: среднее и профиль по бакетам
  `(function(){var c=Memory.cpuStats||{};console.log('CPU'+JSON.stringify({avg:c.average,count:c.count,total:c.total,prof:c.profile}));})();`,

  // 2. Покрытие ремонта башнями по owned-комнатам
  `(function(){var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;}),o={t:Game.time,r:TOWER_FALLOFF_RANGE};
R.forEach(function(n){var q=Game.rooms[n],tw=q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_TOWER;}}),te=0,i,j;
for(i=0;i<tw.length;i++){te+=tw[i].energy;}
var S=q.find(FIND_STRUCTURES),d=0,mh=0,rd=0,oo=0,outR=0,outO=0,outN=0;
for(j=0;j<S.length;j++){var s=S[j];if(s.hits>=s.hitsMax){continue;}var m=s.hitsMax-s.hits,isR=s.structureType===STRUCTURE_ROAD;d++;mh+=m;if(isR){rd+=m;}
var cov=false;for(i=0;i<tw.length;i++){if(Math.max(Math.abs(tw[i].pos.x-s.pos.x),Math.abs(tw[i].pos.y-s.pos.y))<=TOWER_FALLOFF_RANGE){cov=true;break;}}
if(!cov){oo+=m;if(isR){outR+=m;}else{outO+=m;outN++;}}}
var tk=(((Memory.rooms[n]||{}).tasks||{}).repairStructures||[]).length;
o[n]={tw:tw.length,te:te,dmg:d,mh:mh,rd:rd,out:oo,outR:outR,outO:outO,outN:outN,rt:tk};});
console.log('TCV'+JSON.stringify(o));})();`,

  // 3. Что именно развёрнуто на шарде
  `(function(){var a=String(require('role.tower').run),b=String(require('room.manager').runRoom||''),c=String(require('task.generators').generateRepairStructures);
console.log('VER2'+JSON.stringify({towerTargetArg:a.indexOf('repairTarget')!==-1,towerOldGate:a.indexOf('REPAIR_INTERVAL !== 0')!==-1,towerPerTick:b.indexOf('countRepairCapableTowers')!==-1,genFallback:c.indexOf('isInTowerRange')!==-1}));})();`,
];

const TAGS = ["CPU", "TCV", "VER2"];

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
      continue;
    }
    console.log(tag + " = " + JSON.stringify(JSON.parse(lines[tag]), null, 1));
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
