"use strict";
/**
 * Адресный замер бакета `labWorker` на живом шарде (метод из
 * docs/REMOTE-CPU-OPTIMIZATION.md, раздел 1): второго мониторинга не создаём,
 * ставим в живой VM обёртки-счётчики и копим их в `global`, по истечении окна
 * переносим снимок в `Memory.__lw` и вычитываем через API.
 *
 * Что измеряем:
 *  - `lab.worker.run` целиком: полное время, число вызовов, отдельно тики с
 *    задачей (`task` в памяти) и без задачи (idle);
 *  - `lab.worker.getRotatedConfigs`: цена перебора конфигов лаб (входит в idle);
 *  - `Creep.prototype.{travelTo,withdraw,transfer,pickup}` для роли `labWorker`:
 *    вклад транспорта и действий (входят в `run`);
 *  - разбивка по крипам (`by`).
 *
 * Игровая логика не меняется: обёртки только считают `Game.cpu.getUsed()`.
 * В конце — восстановление оригиналов и удаление временного ключа.
 *
 * Запуск:  DURATION=480 node tests/live.profile.labworker.js
 *          MODE=install|snapshot|restore node tests/live.profile.labworker.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const DURATION = Number(process.env.DURATION || 480);
const MODE = process.env.MODE || "all";

const api = new ScreepsAPI({ token: TOKEN });

// Обёртки Creep.prototype — отдельная консольная команда, чтобы каждая
// команда осталась короче лимита консоли (~1000 символов, см.
// docs/REMOTE-BORDER-PING-PONG.md, раздел 6).
const INSTALL_ACTIONS = [
  "global.__o=global.__o||{};",
  "['travelTo','withdraw','transfer','pickup'].forEach(function(k){",
  "if(global.__o[k])return;global.__o[k]=Creep.prototype[k];",
  "Creep.prototype[k]=function(){",
  "var t0=Game.cpu.getUsed();var x=global.__o[k].apply(this,arguments);",
  "var d=Game.cpu.getUsed()-t0;",
  "if(this.memory.role==='labWorker'){global.__lw[k]+=d;global.__lw[k+'N']++}",
  "return x}});",
].join("");

// Счётчик Game.getObjectById — только пока мы «внутри» lab.worker.run
// (флаг global.__lwIn), чтобы не мерить всю империю.
const INSTALL_GOID = [
  "if(!global.__o.g){global.__o.g=Game.getObjectById;",
  "Game.getObjectById=function(){var f=global.__lwIn;var t0=f?Game.cpu.getUsed():0;",
  "var x=global.__o.g.apply(Game,arguments);",
  "if(f){global.__lw.goid+=Game.cpu.getUsed()-t0;global.__lw.goidN++}return x}};",
].join("");

const INSTALL_ROLE = [
  "global.__lw={t:Game.time,n:0,tot:0,mx:0,slow:0,cfg:0,cfgN:0,tskT:0,tsk:0,idlT:0,idl:0,",
  "travelTo:0,travelToN:0,withdraw:0,withdrawN:0,transfer:0,transferN:0,pickup:0,pickupN:0,",
  "goid:0,goidN:0,by:{}};global.__lwIn=0;",
  "if(!global.__lwp){global.__lwp=1;",
  "var m=require('lab.worker');global.__m=m;global.__r=m.run;",
  "m.run=function(c){",
  "var t0=Game.cpu.getUsed();global.__lw.n++;var h=!!c.memory.task;",
  "global.__lwIn=1;global.__r.call(m,c);global.__lwIn=0;",
  "var d=Game.cpu.getUsed()-t0;global.__lw.tot+=d;",
  "if(d>global.__lw.mx)global.__lw.mx=d;if(d>1)global.__lw.slow++;",
  "if(h){global.__lw.tskT+=d;global.__lw.tsk++}else{global.__lw.idlT+=d;global.__lw.idl++}",
  "var b=global.__lw.by[c.name]||(global.__lw.by[c.name]={t:0,c:0});b.t+=d;b.c++};",
  "global.__g=m.getRotatedConfigs;var g=global.__g;",
  "m.getRotatedConfigs=function(r){global.__lw.cfgN++;var t0=Game.cpu.getUsed();",
  "var x=g.call(m,r);global.__lw.cfg+=Game.cpu.getUsed()-t0;return x};}",
].join("");

const SNAPSHOT = "Memory.__lw=global.__lw;Memory.__lw.tEnd=Game.time;";
const RESTORE = [
  "if(global.__m){global.__m.run=global.__r;if(global.__g)global.__m.getRotatedConfigs=global.__g;}",
  "['travelTo','withdraw','transfer','pickup'].forEach(function(k){",
  "if(global.__o&&global.__o[k])Creep.prototype[k]=global.__o[k]});",
  "if(global.__o&&global.__o.g)Game.getObjectById=global.__o.g;",
  "delete global.__o;global.__lwp=0;Memory.__lwDone=1;",
].join("");
const CLEAN = "delete Memory.__lw;";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function consoleRun(expr) {
  const r = await api.console(expr, SHARD);
  if (!r || r.ok !== 1) throw new Error("console не принял команду: " + JSON.stringify(r));
  return r;
}

async function readMemory(path) {
  const r = await api.memory.get(path, SHARD);
  return r.data;
}

async function install() {
  await consoleRun(INSTALL_ACTIONS);
  await sleep(6000);
  await consoleRun(INSTALL_GOID);
  await sleep(6000);
  await consoleRun(INSTALL_ROLE);
  await consoleRun("delete Memory.__lwDone;");
  console.log("[install] обёртки поставлены, счётчики сброшены");
}

async function snapshotAndRead() {
  await consoleRun(SNAPSHOT);
  await sleep(7000);
  const data = await readMemory("__lw");
  return data;
}

async function restore() {
  await consoleRun(RESTORE);
  await sleep(7000);
  const done = await readMemory("__lwDone");
  await consoleRun(CLEAN);
  console.log("[restore] оригиналы восстановлены, __lwDone =", JSON.stringify(done));
}

async function main() {
  if (MODE === "install") return install();
  if (MODE === "snapshot") {
    console.log(JSON.stringify(await snapshotAndRead(), null, 1));
    return;
  }
  if (MODE === "restore") return restore();

  await install();
  console.log(`[measure] окно ${DURATION} с …`);
  await sleep(DURATION * 1000);
  const data = await snapshotAndRead();
  console.log("=== СНИМОК ===");
  console.log(JSON.stringify(data, null, 1));
  await restore();
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error("ОШИБКА:", e.message);
    process.exit(1);
  });
