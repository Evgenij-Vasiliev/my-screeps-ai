"use strict";
/**
 * ЖИВАЯ ПРОВЕРКА (только чтение, ничего в игре не меняет): состояние системы
 * replacement handoff на shard3 в одном снимке.
 *
 * Показывает по каждому дальнему крипу TTL, targetRoom, связку замены
 * (handoffFrom/handoffTo), цель Traveler и остаток пути, а также проверяет:
 *  - крип в окне пре-спавна обязан иметь замену (handoffTo) либо она ставится
 *    этим же тиком (спавн занят);
 *  - замена обязана иметь тот же targetRoom, что её предшественник;
 *  - в удалённой комнате не больше одного «работающего» крипа роли плюс
 *    подтверждённая пара замены.
 *
 * Запуск: node tests/live.verify.prespawn.logic.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

// Пороги из constants.js на момент деплоя (локально их проверяет
// tests/remote.handoff.test.js, раздел 9: спавн + дорога + запас).
const THRESHOLDS = { remoteMiner: 146, remoteHauler: 212, reserver: 116 };

const QUERY =
  "(function(){var o={tick:Game.time,creeps:{},spawns:[]};" +
  "for(var n in Game.creeps){var c=Game.creeps[n];var r=c.memory.role;" +
  "if(r!=='remoteMiner'&&r!=='remoteHauler'&&r!=='reserver')continue;" +
  "var t=c.memory._travel||{};" +
  "o.creeps[n]={role:r,pos:c.pos.roomName+':'+c.pos.x+','+c.pos.y," +
  "ttl:c.ticksToLive===undefined?-1:c.ticksToLive,target:c.memory.targetRoom||null," +
  "from:c.memory.handoffFrom||null,to:c.memory.handoffTo||null,at:c.memory.handoffAt||null," +
  "dest:t.dest?(t.dest.roomName+':'+t.dest.x+','+t.dest.y):null,path:(t.path||'').length};}" +
  "for(var s in Game.spawns){var sp=Game.spawns[s];if(sp.spawning)o.spawns.push(sp.spawning.name+' (осталось '+sp.spawning.remainingTime+')');}" +
  "return JSON.stringify(o);})()";

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
  await api.console(QUERY, SHARD);
  await new Promise(r => setTimeout(r, 7000));
  if (!results.length) {
    console.log("нет ответа");
    process.exit(1);
  }
  const d = JSON.parse(results[results.length - 1]);
  const names = Object.keys(d.creeps);

  console.log(`tick ${d.tick}, дальних крипов: ${names.length}`);
  console.log(`спавнится: ${d.spawns.join(", ") || "никто"}`);
  console.log("shapes_old:", JSON.stringify(Object.entries(d.creeps).slice(0,1)));
  console.log("roles:", JSON.stringify(names.map(n => d.creeps[n].role)));

  let problems = 0;
  const spawnBusy = d.spawns.length > 0;

  for (const role of Object.keys(THRESHOLDS)) {
    const list = names
      .map(name => Object.assign({ name: name }, d.creeps[name]))
      .filter(c => (c.role || c.r) === role);
    console.log(`\n${role} (порог ${THRESHOLDS[role]}):`);
    if (list.length === 0) console.log("  нет крипов роли");

    for (const c of list) {
      const spawning = c.ttl === -1;
      const inWindow = !spawning && c.ttl <= THRESHOLDS[role];
      console.log(
        `  ${c.name.padEnd(28)} ${c.pos.padEnd(14)} ttl=${String(spawning ? "спавн" : c.ttl).padEnd(6)}` +
          ` target=${String(c.target).padEnd(7)} from=${String(c.from).padEnd(28)}` +
          ` to=${String(c.to).padEnd(28)} dest=${String(c.dest).padEnd(16)}` +
          `путь=${String(c.path).padEnd(3)}` +
          (inWindow ? " ← В ОКНЕ" : "") +
          (spawning ? " ← замена" : ""),
      );

      if (inWindow && !c.to && !spawnBusy) {
        console.log("     ⚠ в окне пре-спавна, но замены нет и спавн свободен");
        problems++;
      }

      // Замена обязана унаследовать комнату уходящего.
      if (c.from) {
        const pred = d.creeps[c.from];
        if (!pred) {
          console.log(
            `     ⚠ предшественник ${c.from} уже мёртв (связка снимется)`,
          );
        } else if (pred.target !== c.target) {
          console.log(
            `     ⚠ targetRoom замены (${c.target}) ≠ комнаты уходящего (${pred.target})`,
          );
          problems++;
        } else {
          console.log(
            `     ✓ наследует ${c.target} у ${c.from} (уходящий жив, ttl ${pred.ttl})`,
          );
        }
      }
    }
  }

  // Инвариант комнат: на комнату — один работающий крип роли плюс пара замены.
  console.log("\nинвариант «одна комната — одна роль»:");
  for (const role of Object.keys(THRESHOLDS)) {
    const byRoom = {};
    for (const name of names) {
      const c = d.creeps[name];
      const cr = c.role || c.r;
      if (cr !== role || !c.target) continue;
      (byRoom[c.target] = byRoom[c.target] || []).push(c);
    }
    for (const room of Object.keys(byRoom)) {
      const list = byRoom[room];
      const paired = list.filter(c => c.from || c.to).length;
      const ok = list.length <= 1 + (paired > 0 ? 1 : 0);
      console.log(
        `  ${role} ${room}: ${list.length} крип(ов)` +
          (paired ? `, из них в связке замены ${paired}` : "") +
          (ok ? " ✓" : " ⚠ больше, чем «один работающий + пара замены»"),
      );
      if (!ok) problems++;
    }
  }

  console.log(`\nзамечаний: ${problems}`);
  process.exit(problems === 0 ? 0 : 1);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
