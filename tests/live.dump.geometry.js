"use strict";
/**
 * Снимок геометрии (только чтение): террейн, дороги, источники и спавны
 * E35S37 / E35S38 / E36S37 → /tmp/geom.json.
 * Нужен, чтобы посчитать фактическую длину маршрута «спавн → рабочая цель»
 * (без произвольных чисел в порогах пре-спавна).
 *
 * Запуск: node tests/live.dump.geometry.js
 */
const fs = require("fs");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const ROOMS = ["E35S37", "E35S38", "E36S37"];

const api = new ScreepsAPI({ token: TOKEN });

const QUERY =
  "(function(){var out={};" +
  "['E35S37','E35S38','E36S37'].forEach(function(rn){var r=Game.rooms[rn];if(!r){out[rn]=null;return}" +
  "out[rn]={roads:(r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_ROAD}})).map(function(s){return s.pos.x+','+s.pos.y})," +
  "sources:(r.find(FIND_SOURCES)).map(function(s){return s.pos.x+','+s.pos.y})," +
  "spawns:(r.find(FIND_MY_SPAWNS)).map(function(s){return s.name+':'+s.pos.x+','+s.pos.y})," +
  "containers:(r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_CONTAINER}})).map(function(s){return s.pos.x+','+s.pos.y})};});" +
  "return JSON.stringify(out)})()";

(async () => {
  await api.socket.connect();
  await new Promise(r => setTimeout(r, 1500));
  let results = [];
  api.socket.subscribe("console", ev => {
    if (ev.data && ev.data.shard && ev.data.shard !== SHARD) return;
    const msgs = ev.data.messages || {};
    (msgs.results || []).forEach(m => { if (m) results.push(m); });
  });
  await api.console(QUERY, SHARD);
  await new Promise(r => setTimeout(r, 7000));

  const out = {};
  if (results.length) {
    Object.assign(out, JSON.parse(results[results.length - 1]));
  }
  for (const rn of ROOMS) {
    try {
      const t = await api.raw.game.roomTerrain(rn, 0, SHARD);
      out[rn] = out[rn] || {};
      out[rn].terrain = t.terrain || t;
    } catch (err) {
      console.log(`${rn}: террейн не получен: ${err.message}`);
    }
  }
  fs.writeFileSync("/tmp/geom.json", JSON.stringify(out));
  console.log("записано /tmp/geom.json:", Object.keys(out).join(", "));
  process.exit(0);
})().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
