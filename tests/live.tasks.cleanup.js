"use strict";
/**
 * ОЧИСТКА ОЧЕРЕДЕЙ ЗАДАЧ НА ЖИВОМ ШАРДЕ — ЭТО СКРИПТ-ЗАПИСЬ.
 * (остальные live-скрипты проекта только читают; этот по прямому указанию
 * владельца пишет Memory.rooms[*].tasks)
 *
 * Что убирает и почему:
 *   1. repairStructures на ДОРОГИ — правило C2: дороги ремонтируют башни,
 *      воркеры их больше не берут (task.generators.js/executors.js). Задачи,
 *      созданные до правки, сами не исчезают: очередь Memory чистится только по
 *      DONE/SKIP, то есть воркер должен сначала взять задачу. Воркер на верхних
 *      приоритетах до ремонта не доходит, поэтому задачи висят мусором.
 *   2. Мёртвые задачи ремонта (цель уже не существует) — та же логика.
 *   3. fillFactoryEnergy / collectFactoryBattery — фабричный контур выключен
 *      флагами TASK_CONFIG (временно, по решению владельца).
 *
 * НЕ трогает задачи с живой не-дорожной целью: они рабочие.
 *
 * Запуск: node tests/live.tasks.cleanup.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const CMD = `(function(){
var o={t:Game.time,rooms:{}};
var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});
R.forEach(function(n){
 var m=Memory.rooms[n]; if(!m||!m.tasks) return;
 var rem={road:0,dead:0,factory:0,kept:0};
 ['fillFactoryEnergy','collectFactoryBattery'].forEach(function(k){
   var q=m.tasks[k]||[]; if(q.length){rem.factory+=q.length; m.tasks[k]=[];}
 });
 var rq=m.tasks.repairStructures||[];
 if(rq.length){
  var keep=[];
  rq.forEach(function(t){
    var s=Game.getObjectById(t.targetId);
    if(!s){rem.dead++;return;}
    if(s.structureType===STRUCTURE_ROAD){rem.road++;return;}
    keep.push(t);rem.kept++;
  });
  m.tasks.repairStructures=keep;
 }
 o.rooms[n]=rem;
});
console.log('CLN'+JSON.stringify(o));})();`;

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
      if (line.indexOf("CLN") === 0) lines.CLN = line.slice(3);
    }
  });
  const res = await api.console(CMD, SHARD);
  if (!res || res.ok !== 1) {
    console.error("console error:", JSON.stringify(res).slice(0, 300));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 4000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }
  if (!lines.CLN) {
    console.error("нет ответа CLN — очистка НЕ подтверждена");
    process.exit(2);
  }
  console.log(JSON.stringify(JSON.parse(lines.CLN), null, 1));
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
