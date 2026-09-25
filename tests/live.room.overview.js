"use strict";
/**
 * Обзор комнаты (только чтение): крипы по ролям, заполненность спавнов и
 * расширений, непустые очереди задач. Пишет в Memory.__ov.
 *
 * Запуск: node tests/live.room.overview.js [room]
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const ROOM = process.argv[2] || "E35S39";

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXPR = [
  "var room=" + JSON.stringify(ROOM) + ";var r={tick:Game.time,room:room};",
  "var roles={};Object.values(Game.creeps).forEach(function(c){if(c.memory.homeRoom!==room)return;roles[c.memory.role]=(roles[c.memory.role]||0)+1;});r.roles=roles;",
  "var rm=Game.rooms[room];r.spawns=[];r.extTotal=0;r.extNotFull=0;r.extFree=0;",
  "if(rm){rm.find(FIND_MY_SPAWNS).forEach(function(s){r.spawns.push(s.name+' '+s.store[RESOURCE_ENERGY]+'/'+s.store.getCapacity(RESOURCE_ENERGY));});",
  "rm.find(FIND_MY_STRUCTURES).forEach(function(s){if(s.structureType!==STRUCTURE_EXTENSION)return;r.extTotal++;var f=s.store.getFreeCapacity(RESOURCE_ENERGY);r.extFree+=f;if(f>0)r.extNotFull++;});}",
  "var t=Memory.rooms[room].tasks;r.q={};Object.keys(t).forEach(function(k){if(t[k].length)r.q[k]=t[k].length;});",
  "Memory.__ov=r;",
].join("");

(async () => {
  const res = await api.console(EXPR, SHARD);
  if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
  await sleep(7000);
  const ov = (await api.memory.get("__ov", SHARD)).data;
  console.log(JSON.stringify(ov, null, 2));
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
