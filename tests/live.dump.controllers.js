"use strict";
/**
 * Снимок контроллеров и линков удалённых комнат (только чтение) → /tmp/ctrl.json.
 * Нужен для расчёта фактической длины маршрута резервера (спавн → контроллер).
 *
 * Запуск: node tests/live.dump.controllers.js
 */
const fs = require("fs");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const QUERY =
  "(function(){var o={};['E35S38','E36S37','E35S37'].forEach(function(rn){var r=Game.rooms[rn];if(!r){o[rn]=null;return}" +
  "o[rn]={controller:r.controller?(r.controller.pos.x+','+r.controller.pos.y):null," +
  "links:(r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_LINK}})).map(function(s){return s.id+':'+s.pos.x+','+s.pos.y})," +
  "roads:(r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType===STRUCTURE_ROAD}})).length};});return JSON.stringify(o)})()";

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
  const out = results.length ? JSON.parse(results[results.length - 1]) : {};
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync("/tmp/ctrl.json", JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.error("ОШИБКА:", e.message); process.exit(1); });
