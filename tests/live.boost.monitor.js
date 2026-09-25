"use strict";
/**
 * ЖИВОЙ МОНИТОР БУСТОВ — ТОЛЬКО ЧТЕНИЕ (ни Memory, ни игру не меняет).
 *
 * Зачем. После деплоя фиксов boost.manager нужно видеть ФАКТ выдачи бустов, а не
 * только метку: скрипт несколько раз за прогон снимает по каждой owned-комнате
 * число крипов с бустнутыми частями (считается по creep.body[].boost — свойства
 * creep.boosts в движке нет), состояние буст-лабы и запас XKH2O в терминале,
 * число незавершённых процедур, Memory.__boostMetric и CPU-блок boostManager.
 *
 * Что считать успехом (живой дефект, который здесь и проверяется):
 *   - "bp" (бустнутые части) РАСТЁТ, а не стоит на месте;
 *   - лаба/терминал РАСХОДУЮТ XKH2O (значит ресурс доехал и был выдан);
 *   - "pend" не залипает на MAX_BUSY_TICKS и не сопровождается "boost abandoned";
 *   - cpuBoost остаётся в пределах прежних ~0.5 мс/тик, а не растёт.
 *
 * Запуск: node tests/live.boost.monitor.js [число_замеров] [пауза_мс]
 * Токен: SCREEPS_TOKEN или встроенный (как в остальных live-тестах проекта).
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const SAMPLES = Number(process.argv[2] || 11);
const PAUSE = Number(process.argv[3] || 27000);

const api = new ScreepsAPI({ token: TOKEN });

const CMD = `(function(){var o={t:Game.time,r:{},pend:0};
for(var rn in Game.rooms){var q=Game.rooms[rn];if(!q.controller||!q.controller.my)continue;
var cs=q.find(FIND_MY_CREEPS);var bc=0,bp=0,who=[];
for(var i=0;i<cs.length;i++){var c=cs[i],b=0;for(var j=0;j<c.body.length;j++){if(c.body[j].boost)b++;}
if(c.memory.boostLab||c.memory.boostTask||c.memory.boostSince)o.pend++;
if(b>0){bc++;bp+=b;who.push(c.memory.role+":"+b);}}
var m=Memory.rooms[rn]||{};var L=m.boostLab?Game.getObjectById(m.boostLab):null;
o.r[rn]={bc:bc,bp:bp,who:who.join(" "),
lab:L?(L.mineralType||"-")+":"+(L.mineralType?(L.store[L.mineralType]||0):0):"none",
term:q.terminal?(q.terminal.store.XKH2O||0):0};}
o.met=Memory.__boostMetric||null;
var p=Memory.cpuStats&&Memory.cpuStats.profile;
if(p&&p.blocks&&p.blocks.boostManager)o.cpu=Math.round(p.blocks.boostManager.sum/p.blocks.boostManager.count*1000)/1000;
o.avg=Memory.cpuStats?Memory.cpuStats.average:null;
console.log("PR"+JSON.stringify(o));})();`;

async function probe() {
  return new Promise(async resolve => {
    const lines = [];
    try {
      await api.socket.connect();
      api.socket.subscribe("console", event => {
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
          // Консоль шарда отдаёт кириллицу HTML-сущностями (метки метрики вида
          // "бусты выданы") — декодируем, иначе вывод нечитаем.
          const line = String(raw)
            .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) =>
              String.fromCharCode(parseInt(hex, 16)),
            )
            .replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(Number(dec)));
          if (line.indexOf("PR") === 0) lines.push(line.slice(2));
        }
      });
      await api.console(CMD, SHARD);
      await new Promise(r => setTimeout(r, 3000));
      try {
        api.socket.disconnect();
      } catch (err) {
        void err; // сокет мог уже закрыться
      }
    } catch (err) {
      console.log("ОШИБКА:", err.message);
    }
    resolve(lines[0] || null);
  });
}

(async () => {
  for (let i = 0; i < SAMPLES; i++) {
    const line = await probe();
    if (line) {
      const d = JSON.parse(line);
      const parts = [];
      for (const room in d.r) {
        const v = d.r[room];
        parts.push(
          room +
            " boost=" + v.bc + "(" + v.bp + "p " + v.who + ")" +
            " lab=" + v.lab + " term=" + v.term,
        );
      }
      console.log(
        "t=" + d.t +
          " cpuBoost=" + d.cpu +
          " avg=" + (d.avg ? Math.round(d.avg * 100) / 100 : "?") +
          " pend=" + d.pend,
      );
      console.log("   " + parts.join(" | "));
      console.log("   metric=" + JSON.stringify(d.met));
    } else {
      console.log("нет данных (повтор на следующем замере)");
    }
    if (i < SAMPLES - 1) await new Promise(r => setTimeout(r, PAUSE));
  }
})().catch(e => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
