"use strict";
/**
 * Живая диагностика (только чтение): состояние дальних ролей, их связки
 * replacement (handoffFrom/handoffTo), TTL и текущий путь Traveler.
 *
 * Запуск: node tests/live.prespawn.probe.js
 *   SAMPLES=5 node tests/live.prespawn.probe.js   # несколько снимков подряд
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const SAMPLES = Number(process.env.SAMPLES || 1);
const api = new ScreepsAPI({ token: TOKEN });

const QUERY =
  "(function(){var t=function(c){var p=c.memory._travel||{};return p.dest?(p.dest.x+','+p.dest.y+p.dest.roomName+':'+((p.path||'').length)):'-'};" +
  "return JSON.stringify({tick:Game.time," +
  "creeps:Object.values(Game.creeps).filter(function(c){return /remote|reserv/.test(c.memory.role)}).map(function(c){return [c.name.slice(0,24),c.memory.role,c.pos.roomName+':'+c.pos.x+','+c.pos.y,c.ticksToLive,c.memory.targetRoom,c.memory.handoffFrom||null,c.memory.handoffTo||null,t(c)]})," +
  "spawns:Object.values(Game.spawns).map(function(s){return [s.name,s.room.name,s.spawning?(s.spawning.name+' left='+s.spawning.remainingTime):'-',s.room.energyAvailable]})})})()";

(async () => {
  await api.socket.connect();
  await new Promise(r => setTimeout(r, 1500));

  let results = [];
  api.socket.subscribe("console", ev => {
    if (ev.data && ev.data.shard && ev.data.shard !== SHARD) return;
    const msgs = ev.data.messages || {};
    (msgs.results || []).forEach(m => {
      if (m) results.push(m);
    });
  });

  for (let s = 0; s < SAMPLES; s++) {
    results = [];
    await api.console(QUERY, SHARD);
    await new Promise(r => setTimeout(r, 6000));
    if (!results.length) {
      console.log(`#${s}: нет ответа`);
      continue;
    }
    const d = JSON.parse(results[results.length - 1]);
    console.log(`\n#${s} tick=${d.tick}`);
    console.log("  spawns:");
    for (const sp of d.spawns) console.log("    " + sp.join("  "));
    console.log("  creeps:");
    for (const c of d.creeps) console.log("    " + c.join("  "));
  }
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exitCode = 1;
});
