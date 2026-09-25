"use strict";
/**
 * Замер стоимости инструментации и «подозрительных» участков на живом шарде
 * (только чтение игры; единственная мутация — временные ключи Memory._bpx и
 * временные патчи-счётчики, которые снимаются шагом CLEANUP).
 *
 * Что меряет:
 *  1) сколько раз за тик вызывается cpuMonitor.trackRole (2 × Game.cpu.getUsed
 *     на каждый вызов) и во сколько это обходится CPU;
 *  2) сколько раз за тик меняются очереди Task System (addTask/reserve/
 *     release/complete) — каждая такая операция сбрасывала пер-тиковый кеш
 *     ВСЕЙ комнаты (11 категорий), а не одной очереди;
 *  3) микро-стоимость: Game.cpu.getUsed() ×2, Game.getObjectById,
 *     Object.values(Game.constructionSites), обход Game.rooms,
 *     TerminalNetwork.collectRoomStates/collectLabRequests/resourceInLabs,
 *     labWorker.getConfigs;
 *  4) размер Memory (churn от записи Memory.cpuStats/terminalExports каждый тик).
 *
 * Ограничения сервера (как в live.roomstate.bench.js): консольная команда
 * длиннее ~1000 символов молча не исполняется, результат выражения не
 * возвращается — поэтому сниппеты короткие, а замеры кладутся в Memory._bpx.
 * Memory API отдаёт Memory на конец тика, поэтому каждый сниппет помечает свой
 * результат маркером `k` и тиком, и читатель ждёт именно его.
 *
 * Запуск: node tests/live.cpu.instrument.js [shard]
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.argv[2] || process.env.SHARD || "shard3";
const KEY = "_bpx";
const CONSOLE_LIMIT = 1000;

// Счётчики вызовов: cpuMonitor.trackRole и мутаторы очередей Task System.
const SNIPPET_INSTALL = `(function(){try{var tm=require("task.manager"),cm=require("cpuMonitor"),B=global._bps=global._bps||{};if(!B.orig){B.orig=cm.trackRole.bind(cm);B.n=0;B.prev=0;B.t=0;B.all=0;B.t0=Game.time;cm.trackRole=function(r,c){if(B.t!==Game.time){B.t=Game.time;B.prev=B.n;B.n=0;}B.n++;B.all++;return B.orig(r,c);};}if(!B.mut){B.mut=1;B.n2={};B.o2={};["addTask","reserveTask","releaseTask","releaseTaskById","completeTask","removeTask"].forEach(function(k){B.n2[k]=0;(function(k){var o=tm[k];B.o2[k]=o;tm[k]=function(){B.n2[k]++;return o.apply(tm,arguments);};})(k);});}Memory.${KEY}=JSON.stringify({k:"inst",tick:Game.time});}catch(e){Memory.${KEY}="err:"+e;}return "ok";})()`;

// Счётчики за прошедшие тики + состав империи.
const SNIPPET_READ = `(function(){try{var B=global._bps||{},o={k:"read",tick:Game.time,mutFlag:B.mut||0,ticks:B.t0?Game.time-B.t0:0,calls:B.all||0,fr:B.prev||0,mut:B.n2||{},creeps:0,rooms:0,sites:0,own:0,term:0,roles:{},exp:[]};for(var n in Game.creeps){o.creeps++;var r=Game.creeps[n].memory.role;o.roles[r]=(o.roles[r]||0)+1;}for(var k in Game.rooms){o.rooms++;var R=Game.rooms[k];try{if(R.controller&&R.controller.my){o.own++;if(R.terminal)o.term++;}}catch(e){}}o.sites=Object.keys(Game.constructionSites).length;var mr=Memory.rooms||{};for(var q in mr){var x=mr[q].terminalExports;if(x)o.exp.push(q+":"+Object.keys(x).length);}Memory.${KEY}=JSON.stringify(o);}catch(e){Memory.${KEY}="err:"+e;}return "ok";})()`;

// Микро-замеры: getUsed() ×2, getObjectById, Object.values(Game.constructionSites).
const SNIPPET_MICRO_A = `(function(){try{var o={k:"microA",tick:Game.time};var a=Game.cpu.getUsed();for(var i=0;i<2000;i++){Game.cpu.getUsed();Game.cpu.getUsed();}o.pairUs=+((Game.cpu.getUsed()-a)/2000*1000).toFixed(4);var ids=[];for(var n in Game.rooms){var R=Game.rooms[n];try{if(R.controller&&R.controller.my&&R.storage)ids.push(R.storage.id);}catch(e){}}var b=Game.cpu.getUsed();for(var j=0;j<1000;j++){Game.getObjectById(ids[j%ids.length]);}o.gidUs=+((Game.cpu.getUsed()-b)/1000*1000).toFixed(4);var c=Game.cpu.getUsed();for(var k=0;k<200;k++){Object.values(Game.constructionSites);}o.sitesUs=+((Game.cpu.getUsed()-c)/200*1000).toFixed(4);o.ids=ids.length;Memory.${KEY}=JSON.stringify(o);}catch(e){Memory.${KEY}="err:"+e;}return "ok";})()`;

// Микро-замеры: обход Game.rooms, collectRoomStates, размер Memory.
const SNIPPET_MICRO_B = `(function(){try{var o={k:"microB",tick:Game.time};var d=Game.cpu.getUsed();for(var q=0;q<100;q++){for(var m in Game.rooms){var R2=Game.rooms[m];try{if(R2.controller&&R2.controller.my){var t=R2.terminal;}}catch(e){}}}o.roomsUs=+((Game.cpu.getUsed()-d)/100*1000).toFixed(4);var e=Game.cpu.getUsed();for(var w=0;w<50;w++){require("terminalNetwork").collectRoomStates();}o.crsUs=+((Game.cpu.getUsed()-e)/50*1000).toFixed(4);o.mem=(JSON.stringify(Memory)||"").length;Memory.${KEY}=JSON.stringify(o);}catch(e){Memory.${KEY}="err:"+e;}return "ok";})()`;

// Стоимость терминальной логики: сбор комнат, заявки лаб, типы ресурсов.
const SNIPPET_LABS_A = `(function(){try{var tn=require("terminalNetwork"),own=[],o={k:"labsA",tick:Game.time};for(var n in Game.rooms){var R=Game.rooms[n];try{if(R.controller&&R.controller.my&&R.terminal)own.push(R);}catch(e){}}o.rooms=own.length;var st=tn.collectRoomStates();o.states=st.length;var a=Game.cpu.getUsed();for(var i=0;i<20;i++){tn.collectRoomStates();}o.crsUs=+((Game.cpu.getUsed()-a)/20*1000).toFixed(4);var b=Game.cpu.getUsed();for(var j=0;j<20;j++){tn.collectLabRequests(st);}o.clrUs=+((Game.cpu.getUsed()-b)/20*1000).toFixed(4);var c=Game.cpu.getUsed();for(var k=0;k<20;k++){tn.collectResourceTypes(st);}o.crtUs=+((Game.cpu.getUsed()-c)/20*1000).toFixed(4);Memory.${KEY}=JSON.stringify(o);}catch(e){Memory.${KEY}="err:"+e;}return "ok";})()`;

// Стоимость терминальной логики: availableToGive, resourceInLabs, getConfigs.
const SNIPPET_LABS_B = `(function(){try{var tn=require("terminalNetwork"),lw=require("lab.worker"),own=[],o={k:"labsB",tick:Game.time};for(var n in Game.rooms){var R=Game.rooms[n];try{if(R.controller&&R.controller.my&&R.terminal)own.push(R);}catch(e){}}var st=tn.collectRoomStates();var d=Game.cpu.getUsed();for(var q=0;q<20;q++){for(var m=0;m<st.length;m++){tn.availableToGive(st[m],"U");tn.availableToGive(st[m],"K");}}o.atgUs=st.length?+((Game.cpu.getUsed()-d)/20/st.length*1000).toFixed(4):0;var e=Game.cpu.getUsed();for(var r=0;r<20;r++){for(var t=0;t<own.length;t++){tn.resourceInLabs(own[t],"U");}}o.rilUs=own.length?+((Game.cpu.getUsed()-e)/20/own.length*1000).toFixed(4):0;var f=Game.cpu.getUsed();for(var u=0;u<200;u++){for(var v=0;v<own.length;v++){lw.getConfigs(own[v]);}}o.cfgUs=own.length?+((Game.cpu.getUsed()-f)/200/own.length*1000).toFixed(4):0;Memory.${KEY}=JSON.stringify(o);}catch(e){Memory.${KEY}="err:"+e;}return "ok";})()`;

// Снятие патчей и уборка временных ключей.
const SNIPPET_CLEANUP = `(function(){try{var B=global._bps,cm=require("cpuMonitor"),tm=require("task.manager");if(B&&B.orig)cm.trackRole=B.orig;if(B&&B.o2){for(var k in B.o2){if(B.o2[k])tm[k]=B.o2[k];}}delete global._bps;Memory.${KEY}=JSON.stringify({k:"clean",tick:Game.time});return "ok";}catch(e){Memory.${KEY}="e";return "ok";}})()`;

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let lastTick = 0;

/**
 * Отправляет сниппет и ждёт в Memory именно его результат: маркер `k` отличает
 * замер от предыдущего сниппета, а `tick` — от такого же замера прошлого запуска.
 * @param {string} snippet
 * @param {string} marker
 * @param {number} tries
 */
async function post(snippet, marker, tries) {
  if (snippet.length > CONSOLE_LIMIT) {
    throw new Error(
      `сниппет ${snippet.length} > ${CONSOLE_LIMIT} символов будет отброшен`,
    );
  }
  await api.console(snippet, SHARD);
  for (let i = 0; i < tries; i++) {
    await sleep(1000);
    const m = await api.memory.get(KEY, SHARD).catch(() => null);
    const raw = m && m.data;
    if (!raw) continue;
    let o;
    try {
      o = JSON.parse(String(raw));
    } catch {
      continue; // не JSON (например, строка "cleaned") — ждём дальше
    }
    if (o.k !== marker) continue;
    if (!(o.tick > lastTick)) continue;
    lastTick = o.tick;
    return o;
  }
  throw new Error(`консоль не вернула замер ${marker}`);
}

async function run() {
  await post(SNIPPET_INSTALL, "inst", 20);
  await sleep(20000); // накапливаем счётчики за десяток-другой тиков

  const counts = await post(SNIPPET_READ, "read", 20);
  const microA = await post(SNIPPET_MICRO_A, "microA", 20);
  const microB = await post(SNIPPET_MICRO_B, "microB", 20);
  const labsA = await post(SNIPPET_LABS_A, "labsA", 20);
  const labsB = await post(SNIPPET_LABS_B, "labsB", 20);

  await post(SNIPPET_CLEANUP, "clean", 20);
  await api.console(`delete Memory.${KEY}; "cleanup"`, SHARD);

  console.log(`\n=== instrument bench | ${SHARD} ===`);
  console.log("счётчики:", JSON.stringify(counts));
  console.log("микро A:", JSON.stringify(microA));
  console.log("микро B:", JSON.stringify(microB));
  console.log("terminal A:", JSON.stringify(labsA));
  console.log("terminal B:", JSON.stringify(labsB));

  const ticks = Math.max(1, (counts && counts.ticks) || 1);
  const callsPerTick = ((counts && counts.calls) || 0) / ticks;
  const pairUs = microA && microA.pairUs ? microA.pairUs : 0;
  console.log(
    `\nWARN trackRole: ${callsPerTick.toFixed(1)} вызовов/тик × ` +
      `${pairUs.toFixed(3)} мкс (пара getUsed) = ` +
      `${((callsPerTick * pairUs) / 1000).toFixed(4)} CPU/тик`,
  );
  const mut = (counts && counts.mut) || {};
  const mutPerTick = Object.keys(mut).reduce((s, k) => s + mut[k], 0) / ticks;
  console.log(
    `WARN мутации очередей Task System: ${mutPerTick.toFixed(2)}/тик ` +
      `(каждая сбрасывала пер-тиковый кеш всей комнаты) :: ${JSON.stringify(mut)}`,
  );
  console.log(
    `\nMARK instrument: trackRoleCalls=${callsPerTick.toFixed(1)} ` +
      `pairUs=${pairUs} mem=${microB && microB.mem} mutPerTick=${mutPerTick.toFixed(2)} ` +
      `crsUs=${labsA && labsA.crsUs} clrUs=${labsA && labsA.clrUs} ` +
      `rilUs=${labsB && labsB.rilUs} gidUs=${microA && microA.gidUs}`,
  );
  process.exit(0);
}

module.exports = {
  SNIPPET_INSTALL,
  SNIPPET_READ,
  SNIPPET_MICRO_A,
  SNIPPET_MICRO_B,
  SNIPPET_LABS_A,
  SNIPPET_LABS_B,
  SNIPPET_CLEANUP,
  TOKEN,
  SHARD,
  KEY,
};

if (require.main === module) {
  run().catch(e => {
    console.error("ОШИБКА:", e.message);
    process.exit(1);
  });
}
