"use strict";
/**
 * ЖИВАЯ ПРОВЕРКА PowerSpawn на shard3 (только чтение, игру не меняет).
 *
 * Проверяет, что подсистема реально работает:
 *   1) Game.gpl.progress растёт — значит processPower() вызывается;
 *   2) сырьё PowerSpawn (power/энергия) расходуется, а не копится;
 *   3) в Memory.cpuStats.profile.blocks есть бакет powerSpawnManager, и видно
 *      его CPU (признак, что менеджер действительно исполняется).
 *
 * Запуск: node tests/live.verify.powerspawn.js
 *   SAMPLES=20 INTERVAL=6000 node tests/live.verify.powerspawn.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const SAMPLES = Number(process.env.SAMPLES || 12);
const INTERVAL = Number(process.env.INTERVAL || 6000);

const api = new ScreepsAPI({ token: TOKEN });

const QUERY =
  "JSON.stringify((function(){var o={tick:Game.time,gpl:Game.gpl?Game.gpl.progress:null," +
  "level:Game.gpl?Game.gpl.level:null,ps:{}};" +
  "for(var rn in Game.rooms){var r=Game.rooms[rn];" +
  "if(!r.controller||!r.controller.my)continue;" +
  "var s=r.find(FIND_MY_STRUCTURES,{filter:function(x){return x.structureType===STRUCTURE_POWER_SPAWN}})[0];" +
  "if(!s)continue;o.ps[rn]={power:s.store[RESOURCE_POWER],energy:s.store[RESOURCE_ENERGY]};}" +
  "var p=Memory.cpuStats&&Memory.cpuStats.profile;" +
  "o.samples=p?p.samples:null;o.startTick=p?p.startTick:null;" +
  "o.psBlock=p&&p.blocks?p.blocks.powerSpawnManager||null:null;" +
  "o.blocks=p&&p.blocks?Object.keys(p.blocks).length:0;" +
  "return o;})())";

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

  let first = null;
  let last = null;
  const roomPower = {};
  let psBlock = null;

  for (let s = 0; s < SAMPLES; s++) {
    results = [];
    await api.console(QUERY, SHARD);
    await new Promise(r => setTimeout(r, INTERVAL));

    const d = results
      .map(r => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      })
      .filter(o => o && typeof o.tick === "number" && o.ps)[0];

    if (!d) {
      console.log(`#${s}: нет ответа`);
      continue;
    }
    if (!first) first = d;
    last = d;
    if (d.psBlock) psBlock = d.psBlock;

    for (const room of Object.keys(d.ps)) {
      if (!roomPower[room]) roomPower[room] = { first: d.ps[room], last: d.ps[room] };
      else roomPower[room].last = d.ps[room];
    }

    console.log(
      `#${s} tick=${d.tick} GPL level=${d.level} progress=${d.gpl} | ` +
        Object.keys(d.ps)
          .map(rn => `${rn} ${d.ps[rn].power}/${d.ps[rn].energy}`)
          .join(" | ") +
        ` | профиль: samples=${d.samples} блоков=${d.blocks}` +
        (d.psBlock ? " powerSpawnManager=ЕСТЬ" : ""),
    );
  }

  console.log("\n════════ ИТОГ ════════");
  if (first && last) {
    console.log(
      `GPL progress: ${first.gpl} → ${last.gpl} (+${last.gpl - first.gpl} за ${last.tick - first.tick} тиков)`,
    );
    console.log("расход сырья PowerSpawn за то же время:");
    for (const room of Object.keys(roomPower)) {
      const a = roomPower[room].first;
      const b = roomPower[room].last;
      console.log(
        `  ${room}: power ${a.power} → ${b.power} (${b.power - a.power >= 0 ? "+" : ""}${b.power - a.power}), ` +
          `энергия ${a.energy} → ${b.energy} (${b.energy - a.energy >= 0 ? "+" : ""}${b.energy - a.energy})`,
      );
    }
  }
  console.log(
    `CPU profile: бакет powerSpawnManager ` +
      (psBlock
        ? `ЕСТЬ (sum=${psBlock.sum}, count=${psBlock.count}, max=${psBlock.max})`
        : "пока нет — окно профиля ещё не сменилось"),
  );

  const grew = first && last && last.gpl > first.gpl;
  const consumed = Object.keys(roomPower).some(
    room =>
      roomPower[room].last.power < roomPower[room].first.power ||
      roomPower[room].last.energy < roomPower[room].first.energy,
  );
  console.log(
    `\nprocessPower() реально работает: ${grew ? "ДА" : "НЕТ"} ` +
      `(GPL растёт: ${grew}, сырьё расходуется: ${consumed})`,
  );
  console.log(
    `powerSpawnManager в CPU profile: ${psBlock ? "ДА" : "НЕТ"}`,
  );
  process.exit(grew && psBlock ? 0 : 1);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
