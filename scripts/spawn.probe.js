"use strict";
/**
 * ===================================================
 * SCRIPTS/SPAWN.PROBE.JS — read-only замер spawnManager
 * ===================================================
 * Отвечает на вопрос «сколько CPU стоит spawnManager и из чего он состоит».
 *
 * Что меряется:
 *  1. STATE (несколько проб с паузой) — состояние, от которого зависит, идёт
 *     ли комната по ДОРОГОМУ пути (свободный спавн + нерáбранная квота):
 *     свободные спавны, энергия комнаты, крипы комнаты, недобор по квотам.
 *     Доля проб с недобором = доля тиков, когда вызывается creep.factory.
 *  2. Стоимость отдельных частей spawnManager.run (µCPU за вызов):
 *     c1 — countRoles на списке крипов комнаты (spawn.manager.js:30);
 *     c2 — скелет раннего пути: find свободного спавна + обход SPAWN_QUOTA
 *          (spawn.manager.js:61-75), чистый JS, без обращений к Game;
 *     c3 — проход takenSpots по Game.creeps (creep.factory.js:71-87);
 *     c4 — JS фабрики без интента: имя + prepareBody(miner) + memory
 *          (creep.factory.js:220,152,234).
 *  3. Memory.cpuStats — что уже известно о spawnManager из самого бота
 *     (subsystems.spawnManager, average, creeps, count).
 *
 * Чего здесь НЕТ: спавна. Ни один замер не вызывает spawnManager.run с
 * настоящим roomState — иначе пошёл бы интент spawnCreep. Поле создания
 * крипа (0.2 CPU за интент + JS движка) не меряется этим скриптом.
 *
 * Read-only: пишет только Memory.keepTemp и Memory.__bench_*, оба снимаются
 * в finally (проверка остатков — scripts/memory.audit.js).
 *
 * Запуск:
 *   node scripts/spawn.probe.js [shard3] [число проб STATE] [пауза мс] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const SAMPLES = +(process.argv[3] || 15);
const PAUSE_MS = +(process.argv[4] || 4000);
const OUT = process.argv[5] || "/tmp/spawn-probe.json";
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Выполняет выражение в консоли шарда и возвращает строку результата.
 * Тот же приём, что в scripts/baseline.js:50-81: результат пишется в
 * Memory.__bench_*, читается через API, поле удаляется.
 */
async function evalInGame(field, expression) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;

  if (command.length > CONSOLE_LIMIT) {
    throw new Error(
      `выражение ${field} длиной ${command.length} > ${CONSOLE_LIMIT} символов`,
    );
  }

  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(PAUSE_MS);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(PAUSE_MS);
  }

  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);

  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

/**
 * Снимок состояния: по каждой СВОЕЙ комнате — свободные спавны, энергия,
 * число крипов её квоты и недобор по ролям из SPAWN_QUOTA.
 *
 * Группировка крипов повторяет room.manager.buildAllRoomStates:711-730
 * (homeRoom главнее текущей комнаты), но БЕЗ buildRoomState — чтобы не
 * трогать кэш сканера и не искажать тем самым замер.
 */
const STATE_EXPR =
  `(()=>{const C=require("constants"),sm=require("spawn.manager"),R={};` +
  `for(const n in Game.rooms){const r=Game.rooms[n];if(r.controller&&r.controller.my)R[n]={c:[],s:[]};}` +
  `for(const n in Game.creeps){const c=Game.creeps[n];const h=c.memory.homeRoom||(c.room&&c.room.name);if(R[h])R[h].c.push(c);}` +
  `for(const n in Game.spawns){const s=Game.spawns[n];const rn=s.room&&s.room.name;if(s.my&&R[rn])R[rn].s.push(s);}` +
  `const o=[];for(const n in R){const x=R[n],cnt=sm.countRoles(x.c);let fr=0;` +
  `for(let i=0;i<x.s.length;i++)if(!x.s[i].spawning)fr++;const g=[];` +
  `for(const k in C.SPAWN_QUOTA){const q=C.SPAWN_QUOTA[k];if(q&&(cnt[k]||0)<q)g.push(k+"="+(cnt[k]||0)+"/"+q);}` +
  `const rm=Game.rooms[n];o.push({n:n,fr:fr,sp:x.s.length,en:rm.energyAvailable,ec:rm.energyCapacityAvailable,` +
  `cr:x.c.length,g:g});}return JSON.stringify({t:Game.time,b:Game.cpu.bucket,lim:Game.cpu.limit,a:o})})()`;

/** µCPU за один вызов: внутренние повторы гасят цену самого getUsed. */
function costExpr(repeats, body) {
  return (
    `(()=>{const u=()=>Game.cpu.getUsed(),t=u();for(let i=0;i<${repeats};i++){${body}}` +
    `return ((u()-t)/${repeats}*1000).toFixed(4)})()`
  );
}

/**
 * c1: countRoles на настоящем списке крипов одной комнаты.
 * buildRoomState не зовём — берём крипы по homeRoom, как это делает run.
 */
const C1_EXPR =
  `(()=>{const sm=require("spawn.manager"),cs=[];` +
  `for(const n in Game.creeps){const c=Game.creeps[n];const h=c.memory.homeRoom||(c.room&&c.room.name);` +
  `if(Game.rooms[h]&&Game.rooms[h].controller&&Game.rooms[h].controller.my)cs.push(c);}` +
  `const u=()=>Game.cpu.getUsed(),t=u();for(let i=0;i<200;i++)sm.countRoles(cs);` +
  `return ((u()-t)/200*1000).toFixed(4)+" n="+cs.length})()`;

/** c2: ранний путь spawnManager.run без работы с Game (чистый JS). */
const C2_EXPR = costExpr(
  500,
  `const C=require("constants");const fake=[{spawning:false},{spawning:true}];` +
    `const cnt={miner:2,worker:2,linkWorker:1,mineralMiner:1};` +
    `fake.find(s=>!s.spawning);` +
    `for(const role in C.SPAWN_QUOTA){const q=C.SPAWN_QUOTA[role];if(!q)continue;if((cnt[role]||0)>=q)continue;}`,
);

/** c3: проход takenSpots (creep.factory.js:74-86) по настоящему Game.creeps. */
const C3_EXPR =
  `(()=>{const u=()=>Game.cpu.getUsed(),t=u();let hit=0;for(let i=0;i<50;i++){` +
  `for(const n in Game.creeps){const c=Game.creeps[n],m=c&&c.memory,sp=m&&m.spot;` +
  `if(!m||m.role!=="miner"||!sp)continue;hit++;}}` +
  `return ((u()-t)/50*1000).toFixed(4)+" hits="+hit})()`;

/** c4: JS фабрики без интента — имя, тело майнера (50 частей), memory. */
const C4_EXPR = costExpr(
  200,
  `const C=require("constants");const b=[];const B=C.CREEP_BODIES.miner;` +
    `for(let j=0;j<B.tough;j++)b.push(TOUGH);for(let j=0;j<B.work;j++)b.push(WORK);` +
    `for(let j=0;j<B.carry;j++)b.push(CARRY);for(let j=0;j<B.move;j++)b.push(MOVE);` +
    `const nm="miner_E35S37_"+Game.time;` +
    `Object.assign({role:"miner",homeRoom:"E35S37"},{spot:{x:1,y:2}});`,
);

/**
 * Проверка длины команд ДО отправки: команда длиннее ~1000 символов
 * отбрасывается шардом молча, ответ всё равно «ok» (docs/CPU-BASELINE.md:128-130).
 */
function preflight() {
  const all = {
    STATE: STATE_EXPR,
    MIN: MIN_EXPR,
    C1: C1_EXPR,
    C2: C2_EXPR,
    C3: C3_EXPR,
    C4: C4_EXPR,
    C5: C5_EXPR,
  };
  for (const name of Object.keys(all)) {
    const len = all[name].length + 60; // обёртка try/catch + имя поля
    if (len > CONSOLE_LIMIT) {
      throw new Error(`${name}: команда ~${len} > ${CONSOLE_LIMIT} символов`);
    }
    console.log(`  ${name}: ~${len} символов команды`);
  }
}

/**
 * Состояние минерала так, как его видит spawn.manager.js:83-87: есть ли
 * экстрактор и хватает ли amount до MINERAL_MIN_AMOUNT_TO_SPAWN. Если проверка
 * НЕ проходит — креп-фабрика для mineralMiner не вызывается вовсе.
 */
const MIN_EXPR =
  `(()=>{const mm=require("mineral.manager"),C=require("constants"),o=[];` +
  `for(const n in Game.rooms){const r=Game.rooms[n];if(!r.controller||!r.controller.my)continue;` +
  `const m=mm.buildMineralState(r);o.push(n+" amt="+(m?m.amount:"null")+" ext="+(m&&m.extractorId?1:0)+` +
  `" порог="+C.MINERAL_MIN_AMOUNT_TO_SPAWN);}return o.join(" | ")})()`;

/**
 * c5: ПОЛНЫЙ spawnManager.run на настоящих roomState, но с закрытыми квотами —
 * в creeps добавляются фиктивные крипы по всем ролям с квотой > 0
 * (linkWorker 1, miner 2, worker 2, mineralMiner 1 — constants.js:66-76).
 * Тогда цикл по квотам не доходит до creep.factory и интентов НЕ возникает:
 * замеряется «путь без спавна» — find + countRoles + обход квот с проверками.
 * Роли с квотой 0 (harvester, towerSupplier, repairer, builder, upgrader)
 * отсекаются первой же проверкой `if (!quota) continue`.
 */
const C5_EXPR =
  `(()=>{const rm=require("room.manager"),sm=require("spawn.manager"),sts=[];` +
  `for(const n in Game.rooms){const r=Game.rooms[n];if(r.controller&&r.controller.my)sts.push(rm.buildRoomState(r));}` +
  `const F=[{memory:{role:"linkWorker"},ticksToLive:1500},{memory:{role:"miner"},ticksToLive:1500},` +
  `{memory:{role:"miner"},ticksToLive:1500},{memory:{role:"worker"},ticksToLive:1500},` +
  `{memory:{role:"worker"},ticksToLive:1500},{memory:{role:"mineralMiner"},ticksToLive:1500}];` +
  `for(const st of sts)st.creeps=st.creeps.concat(F);` +
  `const u=()=>Game.cpu.getUsed(),t=u();for(let i=0;i<100;i++)for(const st of sts)sm.run(st);` +
  `return ((u()-t)/100*1000).toFixed(4)+" rooms="+sts.length})()`;

(async () => {
  preflight();
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(
    `Шард ${SHARD}: ${SAMPLES} проб состояния, пауза ${PAUSE_MS} мс → ${OUT}\n`,
  );

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  const rows = [];
  const costs = {};
  let stats = null;
  try {
    for (let i = 0; i < SAMPLES; i++) {
      try {
        const d = JSON.parse(await evalInGame("sp_state", STATE_EXPR));
        rows.push(d);
        const rooms = d.a || [];
        const want = rooms.filter(r => r.g.length > 0 && r.fr > 0);
        console.log(
          `  ${String(i + 1).padStart(3)}  t=${d.t} bkt=${d.b} комнат=${rooms.length} ` +
            `дорогой путь: ${want.length}` +
            (want.length
              ? " → " + want.map(r => `${r.n}(en=${r.en}/${r.ec},${r.g.join(",")})`).join(" ")
              : ""),
        );
      } catch (e) {
        console.log(`  проба ${i + 1}: ошибка — ${e && e.message ? e.message : e}`);
      }
    }

    const probes = [
      ["c1.countRoles_на_комнату", C1_EXPR],
      ["c2.ранний_путь_find+квоты", C2_EXPR],
      ["c3.takenSpots_проход", C3_EXPR],
      ["c4.фабрика_JS_без_интента", C4_EXPR],
      ["c5.полный_run_с_закрытыми_квотами", C5_EXPR],
    ];
    for (const [name, expr] of probes) {
      try {
        costs[name] = await evalInGame("sp_" + name.split(".")[0], expr);
        console.log(`\n${name}: ${costs[name]} µCPU за вызов`);
      } catch (e) {
        costs[name] = "ERR: " + (e && e.message ? e.message : e);
        console.log(`\n${name}: ошибка — ${costs[name]}`);
      }
    }

    // Идёт ли комната в creep.factory для mineralMiner: проверка минерала
    // стоит ДО вызова фабрики (spawn.manager.js:83-87).
    try {
      costs["min.состояние_минерала"] = await evalInGame("sp_min", MIN_EXPR);
      console.log(`\nминерал: ${costs["min.состояние_минерала"]}`);
    } catch (e) {
      costs["min.состояние_минерала"] = "ERR: " + (e && e.message ? e.message : e);
      console.log(`\nминерал: ошибка — ${costs["min.состояние_минерала"]}`);
    }

    // Что бот уже знает про spawnManager: subsystems последнего отчёта.
    try {
      const raw = await evalInGame(
        "sp_stats",
        `JSON.stringify(Object.assign({},Memory.cpuStats,{heap:(()=>{const g=global.__cpuMonitor||{},` +
          `rs=g.roleStats||{},m={};for(const k in rs)m[k]=+rs[k].max.toFixed(4);return m})()}))`,
      );
      stats = JSON.parse(raw);
    } catch (e) {
      console.log(`\nMemory.cpuStats: ошибка — ${e && e.message ? e.message : e}`);
    }
  } finally {
    for (const f of [
      "sp_state",
      "sp_c1",
      "sp_c2",
      "sp_c3",
      "sp_c4",
      "sp_c5",
      "sp_min",
      "sp_stats",
    ]) {
      await api.console(`delete Memory.__bench_${f}`, SHARD);
      await sleep(300);
    }
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(400);
    fs.writeFileSync(
      OUT,
      JSON.stringify({ shard: SHARD, samples: rows.length, rows, costs, stats }, null, 1),
    );
  }

  /* ── Итог ─────────────────────────────────────────────────────────── */
  const total = rows.length;
  if (total > 0) {
    const withGap = rows.filter(r => (r.a || []).some(x => x.g.length > 0)).length;
    const withFreeSpawnAndGap = rows.filter(r =>
      (r.a || []).some(x => x.g.length > 0 && x.fr > 0),
    ).length;
    const freeSpawn = rows.filter(r => (r.a || []).some(x => x.fr > 0)).length;
    console.log(
      `\n=== STATE (${total} проб) ===\n` +
        `  есть недобор по квоте:          ${withGap}/${total} проб\n` +
        `  есть свободный спавн:           ${freeSpawn}/${total} проб\n` +
        `  свободный спавн + недобор:      ${withFreeSpawnAndGap}/${total} проб ` +
        `(в эти тики вызывается creep.factory)`,
    );

    // По комнатам: энергия против цены тел, которые комната пытается создать.
    const byRoom = {};
    for (const r of rows) {
      for (const x of r.a || []) {
        const s = (byRoom[x.n] = byRoom[x.n] || {
          n: x.n,
          samples: 0,
          gap: 0,
          free: 0,
          cr: 0,
          en: 0,
          ec: 0,
          gaps: {},
        });
        s.samples++;
        if (x.g.length) s.gap++;
        if (x.fr > 0) s.free++;
        s.cr += x.cr;
        s.en += x.en;
        s.ec += x.ec;
        for (const g of x.g) {
          const k = g.split("=")[0];
          s.gaps[k] = (s.gaps[k] || 0) + 1;
        }
      }
    }
    console.log(
      "\n  комната       проб  недобор  своб.спавн  крипов(ср)  энергия(ср)  ёмкость(ср)  чего не хватает",
    );
    for (const n of Object.keys(byRoom)) {
      const s = byRoom[n];
      const gaps = Object.keys(s.gaps)
        .map(k => `${k}×${s.gaps[k]}`)
        .join(",");
      console.log(
        `  ${s.n.padEnd(12)} ${String(s.samples).padStart(4)} ` +
          `${String(s.gap).padStart(7)} ${String(s.free).padStart(11)} ` +
          `${(s.cr / s.samples).toFixed(1).padStart(11)} ` +
          `${Math.round(s.en / s.samples)
            .toString()
            .padStart(11)} ` +
          `${Math.round(s.ec / s.samples)
            .toString()
            .padStart(11)}  ${gaps || "-"}`,
      );
    }
  }

  console.log("\n=== Стоимость частей spawnManager (µCPU за вызов) ===");
  for (const k of Object.keys(costs)) console.log(`  ${k.padEnd(30)} ${costs[k]}`);

  if (stats) {
    console.log("\n=== Memory.cpuStats бота ===");
    console.log(
      `  average=${stats.average} CPU/тик, count=${stats.count}, creeps=${stats.creeps}, bucket=${stats.bucket}`,
    );
    const subs = stats.subsystems || {};
    const keys = Object.keys(subs).sort((a, b) => subs[b] - subs[a]);
    for (const k of keys) console.log(`  ${k.padEnd(20)} ${subs[k]}`);
    if (stats.heap && stats.heap.spawnManager !== undefined) {
      console.log(
        `\n  heap roleStats.spawnManager.max (окно отчёта) = ${stats.heap.spawnManager} CPU`,
      );
    }
  }

  console.log(`\nсырые данные: ${OUT}`);
})().catch(e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});
