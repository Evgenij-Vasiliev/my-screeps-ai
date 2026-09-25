"use strict";
/**
 * Замер CPU построения roomState на живом шарде (только чтение игры).
 *
 * buildRoomState не пишет в Memory и не создаёт интентов — его безопасно
 * вызывать из консоли и мерить Game.cpu.getUsed() вокруг вызова. Это
 * единственный способ получить реальный «до/после» по roomState, не дожидаясь
 * 1500 тиков окна cpuMonitor (значение Memory.cpuStats.profile печатается
 * дополнительно как контрольная точка).
 *
 * Ограничения сервера, из-за которых инструмент устроен именно так:
 *  1) консольная команда длиннее ~1000 символов молча не исполняется —
 *     поэтому замер разбит на два коротких сниппета;
 *  2) результат выражения не возвращается в HTTP-ответе /api/user/console
 *     (там только метаданные операции) — результаты складываются во временные
 *     ключи Memory и читаются через Memory API; ключи удаляются в конце;
 *  3) в консоли Game.rooms содержит комнаты, известные по интелидженсу
 *     (без обзора), и Object.values(Game.rooms) на них падает,
 *     поэтому список своих комнат собирается через for..in с try/catch.
 *     Это артефакт консоли: в основном цикле в Game.rooms только видимые
 *     комнаты, и roomManager.getOwnedRooms() работает без ошибок.
 *
 * Запуск: node tests/live.roomstate.bench.js [shard]
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.argv[2] || process.env.SHARD || "shard3";
const KEY1 = "_rsBench";
const KEY2 = "_rsBenchParts";
const CONSOLE_LIMIT = 1000;

// Свои комнаты и размеры групп структур из scanner-кэша + стоимость
// buildRoomState по каждой комнате (каждая меряется после прогрева).
const SNIPPET_MAIN = `(function(){try{
var rm=require("room.manager"),sc=require("scanner"),rs=[],o={};
for(var n in Game.rooms){var R=Game.rooms[n];try{if(R.controller&&R.controller.my)rs.push(R)}catch(e){}}
var cs=[];for(var j=0;j<rs.length;j++)cs.push(sc.getStructureCache(rs[j]));
o.t=Game.time;o.n=rs.length;o.r=[];var s=0;
for(var i=0;i<rs.length;i++){var C=cs[i];
rm.buildRoomState(rs[i],[]);
var x=Game.cpu.getUsed();rm.buildRoomState(rs[i],[]);var d=+(Game.cpu.getUsed()-x).toFixed(4);s+=d;
o.r.push([rs[i].name,d,C.spawnIds.length,C.towerIds.length,C.linkIds.length,C.labIds.length,
C.extensionIds.length,C.roadIds.length,C.wallIds.length,C.rampartIds.length,C.sourceIds.length]);}
o.S=+s.toFixed(4);Memory.${KEY1}=JSON.stringify(o);
}catch(e){Memory.${KEY1}=JSON.stringify({err:String(e&&e.stack||e)});}return "ok";})()`;

// Стоимость частей вне buildRoomState: группировка крипов, mineral-состояние,
// сбор списка комнат, обращения к scanner-кэшу.
const SNIPPET_PARTS = `(function(){try{
var rm=require("room.manager"),sc=require("scanner"),mm=require("mineral.manager"),rs=[],o={};
for(var n in Game.rooms){var R=Game.rooms[n];try{if(R.controller&&R.controller.my)rs.push(R)}catch(e){}}
o.t=Game.time;
var a=Game.cpu.getUsed();var c=0;for(var k in Game.creeps){var C=Game.creeps[k];
var h=C.memory.homeRoom;var u=C.room.name;if(h||u)c++;}
o.G=+(Game.cpu.getUsed()-a).toFixed(4);o.gn=c;
var b=Game.cpu.getUsed();for(var i=0;i<rs.length;i++)mm.buildMineralState(rs[i]);
o.M=+(Game.cpu.getUsed()-b).toFixed(4);
var d=Game.cpu.getUsed();var o2=[];for(var q in Game.rooms){var R2=Game.rooms[q];
try{if(R2.controller&&R2.controller.my)o2.push(R2)}catch(e){}}
o.O=+(Game.cpu.getUsed()-d).toFixed(4);
var e=Game.cpu.getUsed();for(var w=0;w<rs.length;w++)sc.getStructureCache(rs[w]);
o.C=+(Game.cpu.getUsed()-e).toFixed(4);Memory.${KEY2}=JSON.stringify(o);
}catch(e){Memory.${KEY2}=JSON.stringify({err:String(e&&e.stack||e)});}return "ok";})()`;

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { SNIPPET_MAIN, SNIPPET_PARTS, TOKEN, SHARD, KEY1, KEY2 };

if (require.main === module) run();

async function post(snippet, key, tries) {
  if (snippet.length > CONSOLE_LIMIT) {
    throw new Error(
      `сниппет ${key} длиной ${snippet.length} > ${CONSOLE_LIMIT} символов будет отброшен сервером`,
    );
  }
  await api.console(`delete Memory.${key}; "reset"`, SHARD);
  await api.console(snippet, SHARD);
  for (let i = 0; i < tries; i++) {
    await sleep(1000);
    const m = await api.memory.get(key, SHARD).catch(() => null);
    if (m && m.data) {
      await api.console(`delete Memory.${key}; "cleanup"`, SHARD);
      return m.data;
    }
  }
  throw new Error(`консоль не вернула замер ${key}`);
}

async function run() {
  const main = JSON.parse(await post(SNIPPET_MAIN, KEY1, 25));
  if (main.err) throw new Error("ошибка в консоли: " + main.err);
  const parts = JSON.parse(await post(SNIPPET_PARTS, KEY2, 25));
  if (parts.err) throw new Error("ошибка в консоли: " + parts.err);

  const st = await api.memory.get("cpuStats.profile", SHARD).catch(() => null);
  const blocks = (st && st.data && st.data.blocks) || {};
  const samples = (st && st.data && st.data.samples) || 0;
  const avg = k => (blocks[k] && samples ? blocks[k].sum / samples : NaN);

  console.log(`\n=== roomState bench | ${SHARD} | tick ${main.t} ===`);
  console.log(`сумма buildRoomState по ${main.n} комнатам: ${main.S} CPU`);
  console.log(
    `части: группа крипов ${parts.G} (${parts.gn}) | mineral ${parts.M} | сбор комнат ${parts.O} | scanner ${parts.C}`,
  );
  console.log("\nкомната        cpu    spawn tower link lab  ext roads wall ramp src");
  for (const r of main.r) {
    console.log(
      `${r[0].padEnd(10)} ${String(r[1]).padStart(7)} ` +
        r.slice(2).map(v => String(v).padStart(5)).join(" "),
    );
  }
  if (samples) {
    console.log(
      `\nживой профиль (${samples} замеров): roomState ${avg("roomState").toFixed(4)} | ` +
        `roomManager ${avg("roomManager").toFixed(4)} | taskManager ${avg("taskManager").toFixed(4)}`,
    );
  } else {
    console.log("\nживой профиль: нет данных о cpuStats.profile");
  }
  console.log(
    `\nMARK roomState bench: perRoomSum=${main.S} live=${samples ? avg("roomState").toFixed(4) : "n/a"} samples=${samples}`,
  );
  process.exit(0);
}
