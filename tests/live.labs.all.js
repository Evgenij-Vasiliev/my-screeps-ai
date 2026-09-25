"use strict";
/**
 * ЖИВОЙ КОНТРОЛЬ «ВСЕ ЛАБЫ» — ТОЛЬКО ЧТЕНИЕ (Memory.__labsAll — единственная
 * запись, как в остальных live-скриптах проекта).
 *
 * Зачем: после правки SPAWN_QUOTA.labWorker 1 → 2 нужно видеть ФАКТ, а не
 * намерение: сколько labWorker'ов реально держит каждая комната, сколько троек
 * варит (active) и сколько стоит на паузе, и что именно ждёт каждая паузная
 * тройка (реагент1/реагент2 в своих лабах).
 *
 * Запуск: node tests/live.labs.all.js [замеров] [пауза_мс]
 * По умолчанию 1 замер.
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const SAMPLES = Number(process.argv[2] || 1);
const PAUSE = Number(process.argv[3] || 30000);

const api = new ScreepsAPI({ token: TOKEN });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPR = [
  "var q=require('constants');",
  "var r={t:Game.time,quota:q.SPAWN_QUOTA.labWorker,rooms:{},lw:{}};",
  "['E35S37','E35S39','E36S38','E37S37','E37S38'].forEach(function(n){",
  "var m=Memory.rooms[n]||{};var a=0,p=0,wait=[];var cs=Game.creeps;var lwc=0,sp=0;",
  "for(var k in cs){if(cs[k].memory.role!=='labWorker')continue;if(cs[k].memory.homeRoom===n)lwc++;}",
  "for(var k in Game.spawns){var s=Game.spawns[k];if(s.room.name!==n||!s.spawning)continue;var nm=s.spawning.name;var mc=Memory.creeps[nm]||{};if(mc.role==='labWorker'&&mc.homeRoom===n)sp++;}",
  "['labs','labs2','labs3'].forEach(function(key){var cfg=m[key];if(!cfg)return;",
  "if(cfg.active)  {a++;return;} p++;",
  "var l1=Game.getObjectById(cfg.lab1),l2=Game.getObjectById(cfg.lab2);",
  "wait.push(key+':'+cfg.product+' '+cfg.reagent1+'='+(l1?l1.store[cfg.reagent1]||0:'?')+' '+cfg.reagent2+'='+(l2?l2.store[cfg.reagent2]||0:'?'));});",
  "r.rooms[n]={active:a,paused:p,wait:wait};r.lw[n]=[lwc,sp];});",
  "Memory.__labsAll=r;",
].join("");

(async () => {
  for (let i = 0; i < SAMPLES; i++) {
    const res = await api.console(EXPR, SHARD);
    if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
    await sleep(8000);
    const s = (await api.memory.get("__labsAll", SHARD)).data;
    const prof = (await api.memory.get("cpuStats.profile", SHARD)).data;
    // Роли (labWorker) — отдельное окно и opt-in (Memory.cpuMonitorRoles).
    const rolesWin = (await api.memory.get("cpuStats.roles", SHARD)).data;
    const roleBlocks = (rolesWin && rolesWin.roles) || {};
    let act = 0;
    let pau = 0;
    console.log(
      `\n── тик ${s.t} | SPAWN_QUOTA.labWorker на шарде = ${s.quota}`,
    );
    for (const n of Object.keys(s.rooms)) {
      const r = s.rooms[n];
      act += r.active;
      pau += r.paused;
      console.log(
        `  ${n}: labWorker ${s.lw[n][0]} жив${s.lw[n][1] ? " + спавнится" : ""} | варит ${r.active}, пауза ${r.paused}`,
      );
      for (const w of r.wait) console.log(`      ждёт ${w}`);
    }
    console.log(`  ИТОГО: варит ${act}, на паузе ${pau}`);
    if (roleBlocks.labWorker) {
      const b = roleBlocks;
      const s = rolesWin.samples;
      const avg = (k) => (b[k] ? (b[k].sum / s).toFixed(3) : "—");
      const sub = (prof && prof.blocks) || {};
      const subAvg = (k) => (sub[k] ? (sub[k].sum / prof.samples).toFixed(3) : "—");
      console.log(
        `  CPU: labWorker=${avg("labWorker")} labManager=${subAvg("labManager")} roomManager=${subAvg("roomManager")} roleSamples=${s} subSamples=${prof ? prof.samples : 0}`,
      );
    }
    if (i + 1 < SAMPLES) await sleep(PAUSE);
  }
  process.exit(0);
})().catch((e) => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
