"use strict";
/**
 * ЖИВОЙ ЗАМЕР маршрутов (только чтение): сколько тиков идёт крип от спавна
 * домашней комнаты до рабочей цели в удалённой комнате. Считает САМ движок —
 * PathFinder.search с той же costMatrix, что строит traveler.js (дороги 1,
 * прочие структуры 255, стены 255).
 *
 * Нужен, чтобы пороги пре-спавна (constants.REMOTE_ROUTE_TICKS) стояли на
 * факте, а не на прикидке: клеток пути = тиков хода (усталость при штатных
 * телах снимается на ходу), плюс 1 тик на первый шаг до цели.
 * Замеры делаются по одному (длинный общий запрос упирается в лимит console).
 *
 * Запуск: node tests/live.measure.routes.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const GOALS = [
  { name: "E35S38 work(37,32)", room: "E35S38", x: 37, y: 32 },
  { name: "E36S37 work(21,11)", room: "E36S37", x: 21, y: 11 },
  { name: "E35S38 ctrl(19,39)", room: "E35S38", x: 19, y: 39 },
  { name: "E36S37 ctrl(19,40)", room: "E36S37", x: 19, y: 40 },
];

const matrix = `
  function buildMatrix(rn){
    var r=Game.rooms[rn]; if(!r) return false;
    var cm=new PathFinder.CostMatrix();
    var t=r.getTerrain();
    for(var x=0;x<50;x++)for(var y=0;y<50;y++){ if(t.get(x,y)===TERRAIN_MASK_WALL) cm.set(x,y,255); }
    var st=r.find(FIND_STRUCTURES);
    for(var k=0;k<st.length;k++){
      var s=st[k];
      if(s.structureType===STRUCTURE_ROAD || s.structureType===STRUCTURE_CONTAINER) cm.set(s.pos.x,s.pos.y,1);
      else if(s.structureType!==STRUCTURE_RAMPART) cm.set(s.pos.x,s.pos.y,255);
    }
    return cm;
  }`;

function queryFor(spawnName, goal) {
  return (
    "JSON.stringify((function(){" +
    matrix +
    'var sp=Game.spawns["' +
    spawnName +
    '"];' +
    "var res=PathFinder.search(sp.pos,{pos:new RoomPosition(" +
    goal.x +
    "," +
    goal.y +
    ',"' +
    goal.room +
    '"),range:1},{plainCost:2,swampCost:10,maxOps:20000,roomCallback:buildMatrix});' +
    'return {spawn:sp.name,goal:"' +
    goal.name +
    '",len:res.path.length,inc:res.incomplete,cost:Math.round(res.cost)};})())'
  );
}

(async () => {
  const spawns = process.env.SPAWNS
    ? process.env.SPAWNS.split(",")
    : ["Spawn2", "E35S37-2"];

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

  console.log("спавн | цель | клеток пути | +1 тик | incomplete");
  for (const spawnName of spawns) {
    for (const goal of GOALS) {
      results = [];
      await api.console(queryFor(spawnName, goal), SHARD);
      await new Promise(r => setTimeout(r, 5000));
      const row = results
        .map(r => {
          try {
            return JSON.parse(r);
          } catch {
            return null;
          }
        })
        .filter(o => o && typeof o.len === "number")
        .pop();
      if (!row) {
        console.log(`  ${spawnName} | ${goal.name} | нет ответа`);
        continue;
      }
      console.log(
        `  ${row.spawn} | ${row.goal} | ${row.len} | ${row.len + 1} | ${row.inc}`,
      );
    }
  }
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
