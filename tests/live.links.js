"use strict";
/**
 * ЖИВОЙ ЗАМЕР ПО ЛИНКАМ И РОЛИ linkWorker — ТОЛЬКО ЧТЕНИЕ.
 * Нужен, чтобы считать тело linkWorker от факта, а не от догадки:
 *   LK1 — конфиг линков каждой комнаты: позиции, энергия, роль (storage/sender),
 *         расстояния «линк → storage» и «спавн → storage-линк», число отправителей;
 *   LK2 — измеренный CPU блоков: подсистемы (linkManager, roomManager,
 *         terminalNetwork) из Memory.cpuStats.profile.blocks, роли (linkWorker,
 *         miner) — из Memory.cpuStats.roles. Роли — opt-in: если
 *         Memory.cpuMonitorRoles не true, ролевых чисел в ответе не будет.
 *
 * Запуск: node tests/live.links.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });
const TAGS = ["LK1", "LK2"];

const MYROOMS = `var R=Object.keys(Game.rooms).filter(function(n){var q=Game.rooms[n];return q.controller&&q.controller.my;});`;

const CMDS = [
  `(function(){${MYROOMS}
var o={t:Game.time};
R.forEach(function(n){var q=Game.rooms[n],m=Memory.rooms[n]||{},c=m.links||{};
var S=q.find(FIND_MY_SPAWNS),st=q.storage;
var lk=q.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==='link';}});
o[n]={snd:(c.senders||[]).length,
lk:lk.map(function(L){return (c.storage===L.id?'ST':((c.senders||[]).indexOf(L.id)>=0?'SND':'?'))+'@'+L.pos.x+','+L.pos.y+'/'+L.store.energy+'/'+L.cooldown;}),
st:st?st.pos.x+','+st.pos.y:'-',sp:S.length?S[0].pos.x+','+S[0].pos.y:'-'};});
console.log('LK1'+JSON.stringify(o));})();`,

  `(function(){var p=(Memory.cpuStats&&Memory.cpuStats.profile)||{},b=p.blocks||{},r=(Memory.cpuStats&&Memory.cpuStats.roles)||{},rb=r.roles||{},o={samples:p.samples||0,roleSamples:r.samples||0,rolesOn:Memory.cpuMonitorRoles===true,avg:Memory.cpuStats?Memory.cpuStats.average:null};
['linkManager','roomManager','terminalNetwork'].forEach(function(k){
 if(b[k])o[k]=Math.round(b[k].sum/b[k].count*1000)/1000;});
['linkWorker','miner'].forEach(function(k){
 if(rb[k])o[k]=Math.round(rb[k].sum/r.samples*1000)/1000;});
console.log('LK2'+JSON.stringify(o));})();`,
];

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
      const s = String(raw).replace(/&#x22;/g, '"').replace(/&#x3E;/g, ">");
      for (const tag of TAGS) {
        if (s.indexOf(tag) === 0) lines[tag] = s.slice(tag.length);
      }
    }
  });
  for (const expr of CMDS) {
    const res = await api.console(expr, SHARD);
    if (!res || res.ok !== 1) {
      console.error("console error:", JSON.stringify(res).slice(0, 300));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3500));
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }
  for (const tag of TAGS) {
    console.log(
      tag + " = " + (tag in lines ? JSON.stringify(JSON.parse(lines[tag]), null, 1) : "НЕ ПОЛУЧЕНО"),
    );
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
