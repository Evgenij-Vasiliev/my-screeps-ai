"use strict";
/**
 * ЖИВАЯ ПРОВЕРКА: реальная цепочка replacement handoff на shard3.
 *
 * Ждём, пока у дальнего крипа откроется окно пре-спавна, и ловим всю цепочку:
 *   pre-spawn замены → замена получает тот же targetRoom → замена начинает
 *   движение ДО смерти предшественника → замена входит в удалённую комнату →
 *   предшественник умирает → источник продолжает работать.
 *
 * Подтверждение берётся из памяти уходящего (handoffTo) и из TTL: имя замены
 * вместе с тиком постановки (handoffAt) известны ДО появления крипа в
 * Game.creeps, поэтому факт handoff-а видно даже если сам момент спавна
 * мониторинг пропустил.
 *
 * Запуск: node tests/live.verify.handoff.js
 *   WATCH=30 INTERVAL=8000 node tests/live.verify.handoff.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const WATCH = Number(process.env.WATCH || 25);
const INTERVAL = Number(process.env.INTERVAL || 8000);

const api = new ScreepsAPI({ token: TOKEN });

const QUERY =
  "(function(){var o={tick:Game.time,creeps:{},spawns:[]};" +
  "for(var n in Game.creeps){var c=Game.creeps[n];var r=c.memory.role;" +
  "if(r!=='remoteMiner'&&r!=='remoteHauler'&&r!=='reserver')continue;o.creeps[n]={r:r," +
  "pos:c.pos.roomName+':'+c.pos.x+','+c.pos.y,ttl:c.ticksToLive===undefined?-1:c.ticksToLive," +
  "target:c.memory.targetRoom||null,from:c.memory.handoffFrom||null,to:c.memory.handoffTo||null," +
  "at:c.memory.handoffAt||null,dest:(c.memory._travel&&c.memory._travel.dest)?(c.memory._travel.dest.roomName+':'+c.memory._travel.dest.x+','+c.memory._travel.dest.y):null," +
  "path:(c.memory._travel&&c.memory._travel.path)?c.memory._travel.path.length:0," +
  "store:(c.store&&c.store.energy!==undefined)?c.store.energy:-1};}" +
  "for(var s in Game.spawns){var sp=Game.spawns[s];if(sp.spawning)o.spawns.push(sp.spawning.name+':'+sp.spawning.remainingTime);}" +
  "return JSON.stringify(o)})()";

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

  const history = [];
  const saw = new Map(); // имя → последняя запись
  let chain = 0;

  for (let s = 0; s < WATCH; s++) {
    results = [];
    await api.console(QUERY, SHARD);
    await new Promise(r => setTimeout(r, INTERVAL));

    const batch = results.slice();
    if (!batch.length) {
      console.log(`#${s}: нет ответа`);
      continue;
    }

    let d;
    try {
      d = JSON.parse(batch[batch.length - 1]);
    } catch {
      console.log(`#${s}: ответ не разобран`);
      continue;
    }

    const names = Object.keys(d.creeps);
    const gone = [...saw.keys()].filter(n => !names.includes(n));

    // 1. Появился ли крип, которого кто-то уже ждал как замену?
    for (const n of names) {
      const c = d.creeps[n];
      if (saw.has(n)) continue;
      saw.set(n, c);
      // Ищем уходящего, у которого handoffTo === n.
      const leaver = names
        .map(x => d.creeps[x])
        .find(x => x.to === n) || null;
      if (c.from) {
        const pred = d.creeps[c.from];
        chain++;
        history.push(
          `${d.tick}: ЗАМЕНА ${n} (ttl ${c.ttl}) появилась, handoffFrom=${c.from} ` +
            `предшественник жив: ${!!pred}` +
            (pred ? ` (ttl ${pred.ttl}, target ${pred.target})` : ""),
        );
        history.push(
          `${d.tick}:   комната замены = ${c.target || "ЕЩЁ НЕ НАЗНАЧЕНА"}, ` +
            `dest=${c.dest || "-"}`,
        );
      } else if (leaver) {
        chain++;
        history.push(
          `${d.tick}: ЗАМЕНА ${n} (ttl ${c.ttl}) появилась; уходящий ${""}` +
            `указывает на неё как на замену (handoffTo), target=${c.target || "-"}`,
        );
      }
    }

    // 2. Замена получила комнату наследования при живом предшественнике.
    for (const n of names) {
      const c = d.creeps[n];
      const prev = saw.get(n) || {};
      if (c.from && !prev.target && c.target) {
        const pred = d.creeps[c.from];
        history.push(
          `${d.tick}: ${n} ПОЛУЧИЛА КОМНАТУ ${c.target} (предшественник ` +
            `${c.from} ${pred ? "ЖИВ, ttl " + pred.ttl : "умер"})`,
        );
      }
      if (c.from && !prev.dest && c.dest) {
        history.push(`${d.tick}: ${n} НАЧАЛА ДВИЖЕНИЕ dest=${c.dest}`);
      }
      if (c.from && prev.path > 0 && c.path === 0 && c.dest) {
        // путь кончился — считаем, что дошла
        history.push(`${d.tick}: ${n} ДОШЛА (path=0) в ${c.pos}`);
      }
      saw.set(n, c);
    }

    // 3. Предшественник умер — что стало с заменой?
    for (const n of gone) {
      const rec = saw.get(n);
      const heir = names.map(x => d.creeps[x]).find(x => x.from === n) || null;
      history.push(
        `${d.tick}: ${n} ИСЧЕЗ (был ttl ${rec.ttl}, target ${rec.target})` +
          (heir
            ? ` → его замена ${""}${findName(d.creeps, heir)} target=${heir.target}, dest=${heir.dest}`
            : " → замены нет"),
      );
      saw.delete(n);
    }

    const remote = names
      .map(n => d.creeps[n])
      .filter(c => c.r !== "reserver");
    const home = remote.filter(c => c.target && c.pos.split(":")[0] === "E35S37");
    console.log(
      `#${s} tick=${d.tick} дальних=${remote.length} в пути из дома=${home.length}` +
        (d.spawns.length ? ` спавнится: ${d.spawns.join(", ")}` : "") +
        ` | связок увидено: ${chain}`,
    );
  }

  console.log("\n════════ ЦЕПОЧКИ REPLACEMENT ════════");
  for (const line of history) console.log("  " + line);
  console.log(`\nВсего связок: ${chain}`);
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exitCode = 1;
});

function findName(creeps, obj) {
  for (const n in creeps) if (creeps[n] === obj) return n;
  return "?";
}
