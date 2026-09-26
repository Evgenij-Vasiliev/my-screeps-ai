"use strict";
/**
 * ЖИВОЙ ЗАМЕР БАЛАНСА ЭНЕРГИИ ИМПЕРИИ — ТОЛЬКО ЧТЕНИЕ.
 *
 * Вопрос, на который отвечает скрипт: почему склады не наполняются выше 165–176k
 * (и, значит, терминал не получает энергию). Гейт подвоза ПОНИЖЕН до резерва
 * склада 150000 (TERMINAL_SUPPLY.FILL_STORAGE_MULTIPLIER, 25.09.2026) — прежние
 * 195000 делали цель терминала 100000 недостижимой.
 * Гипотеза владельца: «расход превышает доход, фабрика забирает весь доход».
 *
 * Метод: два снимка с интервалом ~150 тиков и разница по статьям.
 *   - storage/terminal/factory/spawns/towers/links/labs/powerSpawn — деньги в системе;
 *   - недобитые хиты структур (mh) — РАБОТА РЕМОНТА: 100 хитов ≈ 1 энергии, то есть
 *     уменьшение mh за интервал = энергия, ушедшая в ремонт;
 *   - progress контроллера — энергия, ушедшая в апгрейд (1 энергия ≈ 1 прогресс);
 *   - battery в фабрике — производство: 50 battery = 600 энергии;
 *   - число крипов и энергия в рюкзаках — расход на спавн и переноску.
 *
 * Ничего не пишет ни в Memory, ни в игру: команды только читают и печатают JSON,
 * результат забирается по websocket-подписке 'console' (как в остальных live-скриптах).
 *
 * Запуск: node tests/live.energy.balance.js [секунды_между_снимками]
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const GAP_SEC = Number(process.argv[2] || 170);
const api = new ScreepsAPI({ token: TOKEN });

const MYROOMS = `var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});`;

const TAGS = ["EA_ROOM", "EA_DMG", "EA_SRC"];

const CMDS = [
  // Энергия по структурам комнаты + производство фабрики
  `(function(){${MYROOMS}
function e(o){return o?(o.store.energy||0):0;}
function sum(a){var s=0;for(var i=0;i<a.length;i++)s+=e(a[i]);return s;}
function find(q,t){return q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType===t;}});}
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n];
var f=q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==='factory';}})[0];
o[n]={st:e(q.storage),te:e(q.terminal),fe:f?(f.store.energy||0):null,
fb:f?(f.store.battery||0):null,
cd:f?f.cooldown:null,
ea:q.energyAvailable,
tw:sum(find(q,'tower')),lk:sum(find(q,'link')),
lb:sum(find(q,'lab')),ps:sum(find(q,'powerSpawn')),
cs:q.find(FIND_MY_CONSTRUCTION_SITES).length};});
console.log('EA_ROOM'+JSON.stringify(o));})();`,

  // Ремонт (недобитые хиты), апгрейд (progress), крипы
  `(function(){${MYROOMS}
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n];
var S=q.find(FIND_STRUCTURES),d=0,mh=0,rd=0,wl=0;
for(var i=0;i<S.length;i++){var s=S[i];if(s.hits<s.hitsMax){var m=s.hitsMax-s.hits;d++;mh+=m;
if(s.structureType===STRUCTURE_ROAD)rd+=m;
else if(s.structureType===STRUCTURE_RAMPART||s.structureType===STRUCTURE_WALL)wl+=m;}}
var c=q.find(FIND_MY_CREEPS),ce=0;
for(var j=0;j<c.length;j++)ce+=c[j].store.energy||0;
var sp=q.find(FIND_MY_SPAWNS),sg=null;
for(var k=0;k<sp.length;k++)if(sp[k].spawning)sg={n:sp[k].spawning.name,left:sp[k].spawning.remainingTime};
o[n]={d:d,mh:mh,road:rd,wall:wl,ctrl:q.controller.ticksToDowngrade,
prog:q.controller.progress,nc:c.length,ce:ce,sg:sg};});
console.log('EA_DMG'+JSON.stringify(o));})();`,

  // Источники (доход), счётчики задач и CPU
  `(function(){${MYROOMS}
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n];
o[n]=q.find(FIND_SOURCES).map(function(s){return s.energy+'/'+(s.ticksToRegeneration||'-');});});
var p=Memory.cpuStats||{};
o.ev=Memory.__taskEvents||null;o.cpu=p.average||null;o.bucket=Game.cpu.bucket;
console.log('EA_SRC'+JSON.stringify(o));})();`,
];

function collect(lines, event) {
  let payload;
  try {
    payload = typeof event === "string" ? JSON.parse(event) : event;
  } catch (err) {
    void err; // не JSON — не наша строка
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
}

async function snapshot(label) {
  const lines = {};
  const handler = (event) => collect(lines, event);
  api.socket.subscribe("console", handler);
  try {
    for (const expr of CMDS) {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const res = await api.console(expr, SHARD);
        ok = !!(res && res.ok === 1);
        if (!ok) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!ok) throw new Error(`${label}: console не принял команду`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    await new Promise((r) => setTimeout(r, 4000));
  } finally {
    try {
      api.socket.unsubscribe("console", handler);
    } catch (err) {
      void err;
    }
  }
  const missing = TAGS.filter((t) => !(t in lines));
  if (missing.length) throw new Error(`${label}: нет секций ${missing.join(",")}`);
  const out = { t: null };
  for (const tag of TAGS) out[tag] = JSON.parse(lines[tag]);
  out.t = out.EA_ROOM.t;
  return out;
}

function delta(a, b) {
  const rooms = Object.keys(b.EA_ROOM).filter((k) => k !== "t");
  const res = {};
  for (const n of rooms) {
    const A = a.EA_ROOM[n] || {};
    const B = b.EA_ROOM[n] || {};
    const DA = a.EA_DMG[n] || {};
    const DB = b.EA_DMG[n] || {};
    res[n] = {
      "Δstorage": (B.st || 0) - (A.st || 0),
      "Δterminal": (B.te || 0) - (A.te || 0),
      "Δfactory_energy": (B.fe || 0) - (A.fe || 0),
      "Δbattery": (B.fb || 0) - (A.fb || 0),
      "энергия_в_battery": ((B.fb || 0) - (A.fb || 0)) * 12,
      "Δспавны/расширения": (B.ea || 0) - (A.ea || 0),
      "Δбашни": (B.tw || 0) - (A.tw || 0),
      "Δлинки": (B.lk || 0) - (A.lk || 0),
      "Δлабы": (B.lb || 0) - (A.lb || 0),
      "ΔpowerSpawn": (B.ps || 0) - (A.ps || 0),
      "ремонт_хитов": (DA.mh || 0) - (DB.mh || 0),
      "ремонт_энергии≈": Math.round(((DA.mh || 0) - (DB.mh || 0)) / 100),
      "из_них_дороги_хитов": (DA.road || 0) - (DB.road || 0),
      "повреждённых_структур": `${DA.d}→${DB.d}`,
      "апгрейд_прогресс": (DB.prog || 0) - (DA.prog || 0),
      "крипов": `${DA.nc}→${DB.nc}`,
      "энергия_в_рюкзаках": (DB.ce || 0) - (DA.ce || 0),
      "ticksToDowngrade": `${DA.ctrl}→${DB.ctrl}`,
      источники: b.EA_SRC[n],
    };
  }
  const sum = (key) =>
    rooms.reduce((s, n) => s + (res[n][key] || 0), 0);
  res["ИТОГО_империя"] = {
    ticks: (b.t || 0) - (a.t || 0),
    "Δstorage": sum("Δstorage"),
    "Δterminal": sum("Δterminal"),
    "энергия_в_battery": sum("энергия_в_battery"),
    "ремонт_энергии≈": sum("ремонт_энергии≈"),
    "апгрейд_прогресс": sum("апгрейд_прогресс"),
    "Δбашни": sum("Δбашни"),
    "Δлабы": sum("Δлабы"),
    "Δспавны/расширения": sum("Δспавны/расширения"),
  };
  return res;
}

(async () => {
  await api.socket.connect();
  const first = await snapshot("снимок-1");
  console.log(`снимок-1: tick ${first.t}`);
  await new Promise((r) => setTimeout(r, GAP_SEC * 1000));
  const second = await snapshot("снимок-2");
  console.log(`снимок-2: tick ${second.t}`);
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }
  console.log("\n=== СНИМОК 1 ===");
  console.log(JSON.stringify(first, null, 1));
  console.log("\n=== СНИМОК 2 ===");
  console.log(JSON.stringify(second, null, 1));
  console.log("\n=== РАЗНИЦА (второй минус первый) ===");
  console.log(JSON.stringify(delta(first, second), null, 1));
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
