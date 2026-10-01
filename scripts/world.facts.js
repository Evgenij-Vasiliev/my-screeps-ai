"use strict";
/**
 * ===================================================
 * SCRIPTS/WORLD.FACTS.JS — что именно есть в комнатах империи
 * ===================================================
 * Read-only замер через ОФИЦИАЛЬНЫЙ game API (`GET /api/game/room-objects`),
 * а не через консоль шарда: консольная команда исполняется в том же изоляте,
 * что и тик бота, и её CPU попадает в Game.cpu.getUsed()
 * (https://github.com/screeps/driver/blob/master/lib/runtime/runtime.js,
 * `usedTime = wall + intents`), то есть искажает измеряемый расход.
 *
 * Зачем нужен: числа башен/линков/спавнов/структур не заданы в коде бота —
 * они «зависят от мира» (scripts/deploy.modules.js:43 — на шард уезжает
 * только код корня). Без этих чисел нельзя посчитать интент-налог:
 * интент стоит 0.2 CPU (driver runtime.js:60), поэтому 16 башен × repair =
 * 3.2 CPU в том тике, когда они бьют.
 *
 * Запуск:
 *   node scripts/world.facts.js [shard3]
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const me = await api.userID();
  const mem = await api.memory.get("rooms", SHARD);
  const roomMem = (mem && mem.data) || {};
  const owned = Object.keys(roomMem);

  const total = {};
  let linksenders = 0;
  let ownedRooms = 0;
  for (const room of owned) {
    const res = await api.raw.game.roomObjects(room, SHARD);
    const objs = (res && res.objects) || [];
    const ctrl = objs.find(o => o.type === "controller");
    const counts = {};
    for (const o of objs) counts[o.type] = (counts[o.type] || 0) + 1;
    const cfg = roomMem[room].links;
    // В room-objects владелец контроллера — поле user (id), а не my.
    const isOwned = !!(ctrl && ctrl.user === me);
    if (isOwned && cfg && Array.isArray(cfg.senders)) {
      linksenders += cfg.senders.length;
    }

    console.log(
      `\n=== ${room} === ${isOwned ? "СВОЯ" : "разведана (не своя)"}, объектов ${objs.length}, ` +
        `RCL ${ctrl ? ctrl.level : "?"}, ` +
        `hostile creeps ${objs.filter(o => o.type === "creep" && ctrl && o.user !== ctrl.user).length}`,
    );
    console.log(
      "  " +
        Object.keys(counts)
          .sort((a, b) => counts[b] - counts[a])
          .map(t => `${t}:${counts[t]}`)
          .join("  "),
    );
    console.log(
      `  wallThreshold=${roomMem[room].wallThreshold} underAttack=${roomMem[room].underAttack}`,
    );
    if (isOwned) {
      ownedRooms++;
      for (const t in counts) total[t] = (total[t] || 0) + counts[t];
    }
    await sleep(1200);
  }

  console.log(`\n=== ИТОГО по ${ownedRooms} СВОИМ комнатам (разведанные не считаны) ===`);
  for (const t of Object.keys(total).sort((a, b) => total[b] - total[a])) {
    console.log(`  ${t}: ${total[t]}`);
  }
  console.log(
    `\nлинков-отправителей в конфигах Memory.rooms[*].links.senders: ${linksenders}` +
      ` → до ${linksenders} интентов transferEnergy (${(linksenders * 0.2).toFixed(1)} CPU) в тик,` +
      ` если все они сработают (linkManager.js:32).`,
  );
})().catch(e => {
  console.error("ОШИБКА:", e && e.message ? e.message : e);
  process.exit(1);
});
