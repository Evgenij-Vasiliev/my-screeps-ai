"use strict";
/**
 * Живой контроль лабораторного буст-контура на shard3 (только чтение).
 * Проверяет после деплоя:
 *   1. E35S37 получает недостающие промежуточные компоненты;
 *   2. финальные тройки E35S37 реально варят X-бусты;
 *   3. X закупается на рынке при дефиците (журнал Memory.__xDeal);
 *   4. boostLab существует в Memory автоматически;
 *   5. терминальная балансировка продолжает работать;
 *   6. CPU и bucket в норме.
 * Запуск: node tests/live.verify.labboost.state.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const TOKEN = resolveToken();
const SHARD = "shard3";
const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const A = `
function S(o){var a=[];for(var k in o.store){if(o.store[k]>0)a.push(k+':'+o.store[k]);}return a.join(' ');}
var r={};r.tick=Game.time;r.rooms={};
['E35S37','E35S39','E36S38','E37S37','E37S38'].forEach(function(n){
var rm=Game.rooms[n];if(!rm){r.rooms[n]='novision';return;}
var o={};o.term=S(rm.terminal);
var m=Memory.rooms[n]||{};
o.boostLab=m.boostLab||null;
['labs','labs2','labs3'].forEach(function(k){var c=m[k];if(!c)return;
var l1=Game.getObjectById(c.lab1),l2=Game.getObjectById(c.lab2),rx=Game.getObjectById(c.reactor);
o[k]=c.active+' '+c.reagent1+'='+(l1?l1.store[c.reagent1]||0:'?')+' '+c.reagent2+'='+(l2?l2.store[c.reagent2]||0:'?')+' '+c.product+'='+(rx?rx.store[c.product]||0:'?');});
r.rooms[n]=o;});
r.xDeal=Memory.__xDeal||null;
r.exports={};
['E35S37','E35S39'].forEach(function(n){r.exports[n]=JSON.stringify((Memory.rooms[n]||{}).terminalExports||{});});
r.boostMetric=Memory.__boostMetric||null;
Memory.__lvA=JSON.stringify(r,null,1);`;

const B = `
var r={};r.tick=Game.time;
var x=0;
for(var rn in Game.rooms){var q=Game.rooms[rn];if(!q.controller||!q.controller.my)continue;
x+=(q.storage?q.storage.store.X||0:0)+(q.terminal?q.terminal.store.X||0:0);
var mm=Memory.rooms[rn]||{};
['labs','labs2','labs3'].forEach(function(k){var c=mm[k];if(!c)return;
['lab1','lab2','reactor'].forEach(function(s){var L=c[s]?Game.getObjectById(c[s]):null;if(L)x+=L.store.X||0;});});
var b=mm.boostLab?Game.getObjectById(mm.boostLab):null;if(b)x+=b.store.X||0;}
r.X=x;
var p=Memory.cpuStats||{};
r.cpuAvg=p.average||null; r.cpuTotal=p.total||null; r.cpuCount=p.count||null;
r.bucket=Game.cpu.bucket; r.limit=Game.cpu.limit;
// Роли — отдельное окно Memory.cpuStats.roles (opt-in Memory.cpuMonitorRoles);
// поле называлось profile.roles, когда роли лежали в blocks профиля.
r.profile=(p.roles&&p.roles.roles)?JSON.stringify(p.roles.roles):null;
Memory.__lvB=JSON.stringify(r,null,1);`;

(async () => {
  for (const cmd of [A, B]) {
    const res = await api.console(cmd, SHARD);
    if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res).slice(0, 200));
  }
  await sleep(4000);
  for (const key of ["__lvA", "__lvB"]) {
    const st = await api.memory.get(key, SHARD);
    console.log("=== " + key + " ===");
    console.log(typeof st.data === "string" ? st.data : JSON.stringify(st.data, null, 1));
  }
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
