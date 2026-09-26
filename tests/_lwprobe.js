"use strict";
/**
 * ВРЕМЕННЫЙ зонд: подтверждает гипотезу о причине CPU роли labWorker.
 *
 * Гипотеза: блок «если рюкзак пуст — сбросить задачу» в lab.worker.run срабатывает
 * и в ФАЗЕ ЗАБОРА (крип пустой едет к источнику). Из-за этого крип без груза
 * перепланирует рейс КАЖДЫЙ тик: getRotatedConfigs двигает round-robin, цель
 * может смениться, а Traveler на пропущенном тике (действие withdraw/transfer)
 * удаляет путь и пересчитывает его через PathFinder.search.
 *
 * Что считаем: пустые входы с задачей, сбросы задачи, смены цели за один вызов,
 * число вызовов findTravelPath (полный пересчёт пути) и его CPU.
 *
 * Запуск: DURATION=120 node tests/_lwprobe.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const DURATION = Number(process.env.DURATION || 120);
const MODE = process.env.MODE || "all";

const api = new ScreepsAPI({ token: TOKEN });

const INSTALL_COUNTERS = [
  "global.__p={n:0,empty:0,emptyTask:0,cleared:0,tgtChange:0,newTask:0,sameReplan:0,",
  "pathN:0,pathT:0,ltw:0,ltwN:0,cfgN:0,dest:{},",
  "wN:0,wOK:0,wBad:0,tN:0,tOK:0,tBad:0,eFull:0,idleCargo:0,wErr:{},tErr:{},wT:{},tT:{},wAmt:0};",
  "if(!global.__po){global.__po={};}",
  "if(!global.__po.f&&global.traveler){",
  // Метод живёт на прототипе класса, а global.traveler пересоздаётся каждый тик
  // (см. Creep.prototype.travelTo) — поэтому оборачиваем ПРОТОТИП, иначе счётчик
  // теряется на следующем тике.
  "var P=global.traveler.constructor.prototype;",
  "global.__po.f=P.findTravelPath;",
  "P.findTravelPath=function(c,d,o){",
  "if(c&&c.memory.role==='labWorker'){var t0=Game.cpu.getUsed();",
  "var r=global.__po.f.apply(this,arguments);",
  "global.__p.pathT+=Game.cpu.getUsed()-t0;global.__p.pathN++;",
  "var k=d.roomName+':'+d.x+':'+d.y;global.__p.dest[k]=(global.__p.dest[k]||0)+1;return r}",
  "return global.__po.f.apply(this,arguments)}};",
].join("");

// Отдельная команда: вместе с обёрткой findTravelPath строка не влезает в лимит
// консоли. Считаем travelTo целиком, чтобы отделить «путь посчитан заново» от
// «путь из кэша»: pathT входит в ltw.
const INSTALL_TRAVEL = [
  "if(!global.__po.t){global.__po.t=Creep.prototype.travelTo;",
  "Creep.prototype.travelTo=function(d,o){",
  "if(this.memory&&this.memory.role==='labWorker'){var t0=Game.cpu.getUsed();",
  "var r=global.__po.t.apply(this,arguments);",
  "global.__p.ltw+=Game.cpu.getUsed()-t0;global.__p.ltwN++;return r}",
  "return global.__po.t.apply(this,arguments)}};",
].join("");

// Обёртки действий: результат withdraw/transfer нужен, чтобы увидеть холостые
// рейсы (ERR_FULL = лабу заполнил другой крип, груз остался на руках).
const INSTALL_ACT = [
  "if(!global.__po.w){global.__po.w=Creep.prototype.withdraw;global.__po.x=Creep.prototype.transfer;",
  "Creep.prototype.withdraw=function(t,res,a){var bf=t&&t.store?(t.store[res]||0):0;var r=global.__po.w.apply(this,arguments);",
  "if(this.memory&&this.memory.role==='labWorker'){var tk=this.memory.task||'none';",
  "global.__p.wT[tk]=(global.__p.wT[tk]||0)+1;global.__p.wN++;",
  "if(r===OK){global.__p.wOK++;global.__p.wAmt+=bf-(t.store[res]||0)}else{global.__p.wBad++;global.__p.wErr[r]=(global.__p.wErr[r]||0)+1}}return r};",
  "Creep.prototype.transfer=function(t,res){var r=global.__po.x.apply(this,arguments);",
  "if(this.memory&&this.memory.role==='labWorker'){var tk=this.memory.task||'none';",
  "global.__p.tT[tk]=(global.__p.tT[tk]||0)+1;global.__p.tN++;if(r===OK)global.__p.tOK++;else{global.__p.tBad++;if(r===ERR_FULL)global.__p.eFull++;global.__p.tErr[r]=(global.__p.tErr[r]||0)+1}}return r}};",
].join("");

const INSTALL_ROLE = [
  "if(!global.__po.r){global.__po.r=1;var m=require('lab.worker');global.__m=m;global.__r=m.run;",
  "m.run=function(c){var p=global.__p;var bT=c.memory.task||null;var bG=c.memory.targetId||null;",
  "var u=c.store.getUsedCapacity();p.n++;if(u===0)p.empty++;",
  "if(u===0&&bT)p.emptyTask++;if(!bT)p.newTask++;if(u>0&&!bT)p.idleCargo++;",
  "global.__r.call(m,c);",
  "var aT=c.memory.task||null;var aG=c.memory.targetId||null;",
  "if(bT&&!aT&&u===0)p.cleared++;",
  "if(bT&&aT&&bG!==aG)p.tgtChange++;",
  "if(bT&&aT&&bG===aG&&u===0)p.sameReplan++;};",
  "var g=m.getRotatedConfigs;global.__g=g;",
  "m.getRotatedConfigs=function(r){global.__p.cfgN++;return g.call(m,r)};}",
].join("");

const SNAPSHOT = "Memory.__lwp=global.__p;Memory.__lwp.tEnd=Game.time;";
const RESTORE = [
  "if(global.__m){global.__m.run=global.__r;if(global.__g)global.__m.getRotatedConfigs=global.__g;}",
  "if(global.__po&&global.__po.f&&global.traveler)global.traveler.constructor.prototype.findTravelPath=global.__po.f;",
  "if(global.__po&&global.__po.t)Creep.prototype.travelTo=global.__po.t;",
  "if(global.__po&&global.__po.w)Creep.prototype.withdraw=global.__po.w;",
  "if(global.__po&&global.__po.x)Creep.prototype.transfer=global.__po.x;",
  "delete global.__po;Memory.__lwpdone=1;",
].join("");
const CLEAN = "delete Memory.__lwp;";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function consoleRun(expr) {
  const r = await api.console(expr, SHARD);
  if (!r || r.ok !== 1)
    throw new Error("console не принял команду: " + JSON.stringify(r));
  return r;
}

async function install() {
  await consoleRun(INSTALL_COUNTERS);
  await sleep(6000);
  await consoleRun(INSTALL_TRAVEL);
  await sleep(6000);
  await consoleRun(INSTALL_ACT);
  await sleep(6000);
  await consoleRun(INSTALL_ROLE);
  console.log("[install] зонд поставлен");
}

async function restore() {
  await consoleRun(RESTORE);
  await sleep(7000);
  await consoleRun(CLEAN);
  console.log("[restore] оригиналы восстановлены");
}

(async () => {
  if (MODE === "restore") return restore();
  await install();
  console.log(`[measure] окно ${DURATION} с …`);
  await sleep(DURATION * 1000);
  await consoleRun(SNAPSHOT);
  await sleep(7000);
  const data = (await api.memory.get("__lwp", SHARD)).data;
  console.log("=== ЗОНД ===");
  console.log(JSON.stringify(data, null, 1));
  await restore();
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
