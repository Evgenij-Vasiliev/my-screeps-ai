"use strict";
/**
 * Снимок состояния дальних ролей (только чтение): позиция, цель Traveler,
 * длина/застревание пути, targetRoom и закэшированные ID источника/контейнера/
 * площадки. Нужен, чтобы понимать, куда именно идёт крип и что он помнит
 * (docs/REMOTE-BORDER-PING-PONG.md).
 *
 * Запуск: node tests/live.dump.remote.js
 *   SAMPLES=3 node tests/live.dump.remote.js   # несколько снимков подряд
 */

const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const SAMPLES = Number(process.env.SAMPLES || 1);

const api = new ScreepsAPI({ token: TOKEN });

const QUERY =
  "(function(){var o=[];for(var n in Game.creeps){var c=Game.creeps[n];" +
  "if(c.memory.role!=='remoteMiner'&&c.memory.role!=='remoteHauler'&&c.memory.role!=='reserver')continue;" +
  "var t=c.memory._travel||{};o.push([n,c.pos.roomName+':'+c.pos.x+','+c.pos.y,c.memory.targetRoom,c.memory._lastRoom," +
  "(t.path||'').length+':'+(t.stuck||0),t.dest?(t.dest.x+','+t.dest.y+t.dest.roomName):'-'," +
  "c.memory.sourceId?'src':'—',c.memory.containerId?'cont':'—',c.memory.containerSiteId?'site':'—'," +
  "c.store[RESOURCE_ENERGY]+'/'+c.store.getCapacity()]);}return JSON.stringify(o)})()";

(async () => {
  await api.socket.connect();
  await new Promise(r => setTimeout(r, 1500));

  let result = null;
  api.socket.subscribe("console", ev => {
    if (ev.data && ev.data.shard && ev.data.shard !== SHARD) return;
    const msgs = ev.data.messages || {};
    (msgs.results || []).forEach(m => {
      if (m) result = m;
    });
  });

  for (let s = 0; s < SAMPLES; s++) {
    result = null;
    await api.console(QUERY, SHARD);
    await new Promise(r => setTimeout(r, 6000));
    if (!result) {
      console.log(`#${s} нет ответа`);
      continue;
    }
    console.log(`#${s}`);
    for (const r of JSON.parse(result)) {
      const [name, pos, target, last, path, dest, src, cont, site, store] = r;
      console.log(
        `  ${name.padEnd(26)} ${pos.padEnd(9)} target=${String(target).padEnd(7)} ` +
          `last=${String(last).padEnd(7)} path=${path.padEnd(6)} dest=${String(dest).padEnd(13)} ` +
          `${src} ${cont} ${site} store=${store}`,
      );
    }
  }
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exitCode = 1;
});
