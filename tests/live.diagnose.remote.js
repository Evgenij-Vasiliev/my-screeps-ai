"use strict";
/**
 * Живая диагностика (только чтение): почему крипы дальней добычи не
 * переходят границу комнат. Ничего в игре не меняем — только Memory.get и
 * console с JSON.stringify.
 *
 * Запуск: node tests/live.diagnose.remote.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";

const api = new ScreepsAPI({ token: TOKEN });

async function main() {
  const empire = await api.memory.get("empire");
  console.log("Memory.empire =", JSON.stringify(empire));
  console.log("Memory.attackAlert =", JSON.stringify(await api.memory.get("attackAlert")));
  console.log("Memory.rallyOverride =", JSON.stringify(await api.memory.get("rallyOverride")));

  const queries = {
    creeps: `JSON.stringify(Object.values(Game.creeps).filter(c=>/remote|reserv/.test(c.memory.role)).map(c=>{var t=c.memory._travel||{};return [c.name.slice(0,20),c.pos.x+','+c.pos.y,c.room.name,'ttl'+c.ticksToLive,c.memory.targetRoom,c.memory._lastRoom,(t.path||'').length+':'+(t.stuck||0)+':'+(t.noPathTick||'-'),t.dest?t.dest.x+','+t.dest.y+t.dest.roomName:'-',c.memory.working?'W':'H',c.store.energy+'/'+c.store.getCapacity()];}))`,
    ctrl: `JSON.stringify(['E35S37','E35S38','E36S37'].map(rn=>{var r=Game.rooms[rn];if(!r)return rn+' невидно';var c=r.controller;return rn+(c?':'+!!c.my+':'+(c.owner?c.owner.username:'neutral')+':'+(c.reservation?c.reservation.username+'/'+c.reservation.ticksToEnd:'none'):':нет'));}))`,
    hostile: `JSON.stringify(Memory.empire||'нет Memory.empire')`,
  };

  await api.socket.connect();
  await new Promise(r => setTimeout(r, 1000));
  let last = [];
  api.socket.subscribe("console", ev => {
    const msgs = ev.data.messages || {};
    (msgs.results || []).forEach(m => console.log("RESULT>", m));
    (msgs.log || []).forEach(m => {
      if (m.startsWith("[") || m.startsWith("{")) last.push(m);
      else console.log("CONSOLE>", m);
    });
  });

  const SAMPLES = Number(process.env.SAMPLES || 12);
  for (let s = 0; s < SAMPLES; s++) {
    last = [];
    await api.console(queries.creeps, SHARD);
    await new Promise(r => setTimeout(r, 5000));
    const batch = last.slice();
    if (!batch.length) {
      console.log(`#${s}: нет ответа (тик пропущен)`);
      continue;
    }
    const rows = JSON.parse(batch[0]);
    console.log(`\n#${s} tick-sample:`);
    for (const r of rows) {
      const [name, pos, room, ttl, target, lastRoom, p, dest, w, store] = r;
      const [x, y] = pos.split(",").map(Number);
      const onBorder = x === 0 || x === 49 || y === 0 || y === 49;
      console.log(
        `   ${name.padEnd(22)} ${room} ${pos.padEnd(6)}${onBorder ? " ГРАНИЦА" : "        "} ` +
          `ttl=${ttl} target=${target} last=${lastRoom} path=${p} dest=${dest} ${w} store=${store}`,
      );
    }
  }
  process.exit(0);
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exitCode = 1;
});
