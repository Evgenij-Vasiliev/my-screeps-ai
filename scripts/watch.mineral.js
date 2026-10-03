"use strict";
/**
 * ===================================================
 * SCRIPTS/WATCH.MINERAL.JS — ловит факт добычи минерала
 * ===================================================
 * READ-ONLY: только `GET /api/game/room-objects`, ничего не пишет ни в
 * Memory, ни на шард.
 *
 * Зачем отдельно от measure.mineral.js: одиночный снимок НЕ доказывает добычу.
 * Доказательство — изменение состояния между снимками:
 *   - `mineralAmount` падает (шаг 5 единиц за успешный harvest);
 *   - `extractor.cooldown` ненулевой (движок ставит 5 после удачной добычи,
 *     EXTRACTOR_COOLDOWN, engine/src/processor/intents/creeps/harvest.js);
 *   - крип-майнер стоит НА клетке минерала (иначе harvest = ERR_NOT_IN_RANGE).
 *
 * Важно: крип в момент спавна (`spawning: true`) висит на клетке СПАВНА и
 * `ticksToLive` у него нет — это не «не доехал», а «ещё не родился»
 * (needTime = 45 = 15 частей × CREEP_SPAWN_TIME 3). Признак рождения —
 * `ticksToLive` появился и `spawning` пропал.
 *
 * Запуск:
 *   node scripts/watch.mineral.js [shard3] [число снимков] [пауза мс]
 * По умолчанию: 10 снимков с паузой 20000 мс (около 3 минут наблюдения).
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SAMPLES = +(process.argv[3] || 10);
const PAUSE_MS = +(process.argv[4] || 20000);

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const me = await api.userID();
  const mem = await api.memory.get("rooms", SHARD);
  const rooms = Object.keys((mem && mem.data) || {});

  console.log(
    `Наблюдение за добычей минерала: shard=${SHARD}, снимков=${SAMPLES}, ` +
      `пауза=${PAUSE_MS} мс`,
  );

  /** @type {Object<string, {type:string, amount:number, cd:number, onTile:boolean, born:boolean}>} */
  let prev = null;
  let sawHarvest = false;

  for (let i = 1; i <= SAMPLES; i++) {
    const snap = {};

    for (const room of rooms) {
      let objs = [];
      try {
        const res = await api.raw.game.roomObjects(room, SHARD);
        objs = (res && res.objects) || [];
      } catch (e) {
        continue;
      }

      const ctrl = objs.find(o => o.type === "controller");
      if (!ctrl || ctrl.user !== me) continue;

      const mineral = objs.find(o => o.type === "mineral");
      const extractor = objs.find(o => o.type === "extractor");
      const miner = objs.find(
        o => o.type === "creep" && /^mineralMiner/.test(o.name || ""),
      );

      // Признак рождения: у рождённого крипа есть ticksToLive и нет spawning.
      const born = !!(miner && miner.ticksToLive !== undefined && !miner.spawning);
      const onTile = !!(
        miner && extractor && miner.x === extractor.x && miner.y === extractor.y
      );

      snap[room] = {
        type: mineral ? mineral.mineralType : null,
        amount: mineral ? mineral.mineralAmount : null,
        cd: extractor ? extractor.cooldown : null,
        onTile,
        born,
        store: miner && miner.store ? JSON.stringify(miner.store) : "-",
      };
      await sleep(500);
    }

    const parts = [];
    for (const room of Object.keys(snap)) {
      const s = snap[room];
      const p = prev && prev[room];
      let mark = "";
      if (p) {
        if (s.amount !== p.amount) {
          mark += ` <<< AMOUNT ${p.amount} -> ${s.amount} (добыча!)`;
          if (s.amount < p.amount) sawHarvest = true;
        }
        if (s.cd !== p.cd) mark += ` [cooldown ${p.cd} -> ${s.cd}]`;
      }
      parts.push(
        `${room} ${s.type}=${s.amount} cd=${s.cd} ` +
          `${s.born ? "рождён" : "спавнится"}${s.onTile ? ", на клетке минерала" : ""}${mark}`,
      );
    }

    console.log(`\n#${i} t=${new Date().toISOString().slice(11, 19)}`);
    for (const p of parts) console.log("   " + p);

    prev = snap;
    if (i < SAMPLES) await sleep(PAUSE_MS);
  }

  console.log(
    sawHarvest
      ? "\nИТОГ: падение mineralAmount зафиксировано — ДОБЫЧА ИДЁТ."
      : "\nИТОГ: падения mineralAmount не зафиксировано. Возможные причины: " +
          "крипы ещё спавнятся, добыча идёт реже окна наблюдения (одна добыча " +
          "на цикл экстрактора ~6 тиков = 5 единиц), либо harvest не срабатывает.",
  );
})().catch(e => {
  console.error("ОШИБКА:", e && e.message ? e.message : e);
  process.exit(1);
});
