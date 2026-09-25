"use strict";
/**
 * Живое состояние блока лабораторий (только чтение): уровни реагентов/продукта
 * в тройках выбранных комнат + рюкзаки и задачи крипов labWorker + средний CPU
 * бакета `labWorker` из окна профиля. Нужен для функционального контроля после
 * правки lab.worker.js (docs/LAB-WORKER-CPU-OPTIMIZATION.md).
 *
 * Запуск: node tests/live.labworker.state.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const EXPR = [
  "var r={};",
  "r.rooms={};",
  "['E35S37','E35S39','E36S38','E37S37','E37S38'].forEach(function(n){",
  "var m=Memory.rooms[n]||{};var list=[];",
  "['labs','labs2','labs3'].forEach(function(k){var cfg=m[k];if(!cfg)return;",
  "var l1=Game.getObjectById(cfg.lab1),l2=Game.getObjectById(cfg.lab2),rx=Game.getObjectById(cfg.reactor);",
  "list.push(k+': '+cfg.reagent1+'='+(l1?l1.store[cfg.reagent1]||0:'?')+' '+cfg.reagent2+'='+(l2?l2.store[cfg.reagent2]||0:'?')+' '+cfg.product+'='+(rx?rx.store[cfg.product]||0:'?'));});",
  "r.rooms[n]=list;});",
  "r.creeps=Object.values(Game.creeps).filter(function(c){return c.memory.role==='labWorker'})",
  ".map(function(c){return {room:c.memory.homeRoom,store:JSON.stringify(c.store),task:c.memory.task,amt:c.memory.amount,x:c.pos.x,y:c.pos.y}});",
  "Memory.__lwState=r;",
].join("");

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const res = await api.console(EXPR, SHARD);
  if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
  await sleep(8000);
  const state = (await api.memory.get("__lwState", SHARD)).data;
  const profile = (await api.memory.get("cpuStats.profile", SHARD)).data;
  // Роли (labWorker/miner/worker) — отдельное окно и opt-in
  // (Memory.cpuMonitorRoles): подсистемы в profile.blocks, роли в roles.roles.
  const rolesWindow = (await api.memory.get("cpuStats.roles", SHARD)).data;

  const lines = [];
  for (const room of Object.keys(state.rooms)) {
    lines.push(`${room}:`);
    for (const l of state.rooms[room]) lines.push(`  ${l}`);
  }
  console.log("Лабы (реагент1/реагент2/продукт):\n" + lines.join("\n"));

  console.log("\nlabWorker:");
  for (const c of state.creeps) {
    console.log(
      `  ${c.room} ${c.x},${c.y} store=${c.store} task=${c.task} amt=${c.amt}`,
    );
  }

  const blocks = (profile && profile.blocks) || {};
  const roles = (rolesWindow && rolesWindow.roles) || {};
  const roleSamples = rolesWindow ? rolesWindow.samples : 0;
  if (roles.labWorker) {
    const s = roleSamples;
    const rAvg = k => (roles[k] ? (roles[k].sum / s).toFixed(4) : "—");
    console.log(
      `\nПрофиль ролей: startTick=${rolesWindow.startTick} samples=${s}\n` +
        `  labWorker=${rAvg("labWorker")} max=${roles.labWorker.max.toFixed(3)} | ` +
        `miner=${rAvg("miner")} | worker=${rAvg("worker")}`,
    );
  } else {
    console.log(
      "\nПрофиль ролей: нет данных — окно пустое или ролевой замер выключен " +
        "(Memory.cpuMonitorRoles = true, чтобы включить)",
    );
  }
  if (profile && profile.blocks) {
    const s = profile.samples;
    const avg = k => (blocks[k] ? (blocks[k].sum / s).toFixed(4) : "—");
    console.log(
      `\nПрофиль подсистем: startTick=${profile.startTick} samples=${s}\n` +
        `  roomManager=${avg("roomManager")} | labManager=${avg("labManager")}`,
    );
  } else {
    console.log("\nПрофиль подсистем: окно пустое (после сброса)");
  }
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
