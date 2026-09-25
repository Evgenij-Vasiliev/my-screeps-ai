"use strict";
/**
 * Диагностика конкретного воркера (только чтение): память/рюкзак/позиция,
 * очередь задач комнаты, store storage/terminal/spawns.
 * Пишет результат в Memory.__diag и читает его обратно.
 *
 * Запуск: node tests/live.diag.worker.js [creepName] [room]
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const NAME = process.argv[2] || "worker_E35S39_83061472";
const ROOM = process.argv[3] || "E35S39";

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXPR = [
  "var name=" + JSON.stringify(NAME) + ",room=" + JSON.stringify(ROOM) + ";",
  "var c=Game.creeps[name];var r={tick:Game.time,name:name,creep:null};",
  "if(c){r.creep={mem:c.memory,store:JSON.stringify(c.store),free:JSON.stringify(c.store.getFreeCapacity()),x:c.pos.x,y:c.pos.y,spawning:!!c.spawning,ticksToLive:c.ticksToLive};}",
  "var m=Memory.rooms[room]||{};r.tasks=m.tasks||null;",
  "var rm=Game.rooms[room];",
  "if(rm){r.storage=rm.storage?JSON.stringify(rm.storage.store):null;",
  "r.terminal=rm.terminal?JSON.stringify(rm.terminal.store):null;",
  "r.spawns=[];rm.find(FIND_MY_SPAWNS).forEach(function(s){r.spawns.push(s.name+' '+s.store[RESOURCE_ENERGY]+'/'+s.store.getCapacity(RESOURCE_ENERGY));});",
  "} else { r.noVision=true; }",
  "Memory.__diag=r;",
].join("");

(async () => {
  const res = await api.console(EXPR, SHARD);
  if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
  await sleep(7000);
  const diag = (await api.memory.get("__diag", SHARD)).data;
  console.log(JSON.stringify(diag, null, 2));
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
