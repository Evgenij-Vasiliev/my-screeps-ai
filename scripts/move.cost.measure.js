"use strict";
/**
 * ===================================================
 * SCRIPTS/MOVE.COST.MEASURE.JS — цена moveTo и частота пересчёта пути (Шаг 4)
 * ===================================================
 * Read-only замер. Отвечает на два вопроса, от которых зависит эффект шага 4:
 *   1) сколько CPU стоит вызов creep.moveTo при живом кэше пути и при
 *      принудительном поиске пути (reusePath: 0) — у крипа, который реально
 *      едет далеко, а не стоит рядом с целью;
 *   2) какая доля крипов платит за поиск пути каждый тик: столько, сколько
 *      крипов без кэша `_move`, плюс оценка по числу «новых» кэшей за N тиков.
 *
 * Замеры разнесены по тикам: в одном тике — один замер, чтобы не выйти за
 * лимит 20 CPU (бот занимает ~5-7).
 *
 * Отдельно: `creep.moveTo` меняет `creep.memory._move` по своим правилам, а
 * замер с `reusePath: 0` заставляет движок искать путь заново в этом же тике.
 * Крип при этом едет туда же, куда ехал бы и так (к цели своей роли), поэтому
 * картина мира не меняется; кэш восстанавливается ботом в следующем тике.
 *
 * Запуск:
 *   node scripts/move.cost.measure.js            # shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;
const TICK_MS = 12000;
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function evalInGame(field, expression, pause = PAUSE_MS) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`выражение ${field}: ${command.length} > ${CONSOLE_LIMIT} символов`);
  }

  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(pause);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(pause);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);
  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

/** Крип, который едет: дальше всех от своего storage (значит, путь реально нужен). */
const PRELUDE =
  "const R=Object.values(Game.rooms).find(r=>r.controller&&r.controller.my&&r.storage);" +
  "const st=R.storage;let c=null,D=0;" +
  "for(const x of Object.values(Game.creeps)){if(x.room.name!==R.name)continue;" +
  "const d=x.pos.getRangeTo(st);if(d>D){D=d;c=x;}}";

async function main() {
  const { source } = resolveTokenSource();
  console.log(`Шаг 4: цена moveTo, шард ${SHARD} (токен из: ${source})`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  const out = {};
  try {
    const head = JSON.parse(
      await evalInGame(
        "mvHead",
        `(()=>{${PRELUDE}return JSON.stringify({room:R.name,creep:c&&c.name,role:c&&c.memory.role,` +
          `range:D,bucket:Game.cpu.bucket,t:Game.time});})()`,
      ),
    );
    console.log("контекст:", JSON.stringify(head));

    // 1. Цена moveTo с живым кэшем пути.
    const r1 = JSON.parse(
      await evalInGame(
        "mv1",
        `(()=>{${PRELUDE}if(!c)return JSON.stringify({err:"нет крипа"});const u=()=>Game.cpu.getUsed();` +
          `const had=!!(c.memory._move&&c.memory._move.path);` +
          `const t=u();const rc=c.moveTo(st,{reusePath:20});const cost=u()-t;` +
          `const after=!!(c.memory._move&&c.memory._move.path);` +
          `return JSON.stringify({had,after,rc,cost:+cost.toFixed(4),range:D});})()`,
      ),
      TICK_MS,
    );
    console.log("1. moveTo с кэшем:", JSON.stringify(r1));
    out.withCache = r1;

    // 2. Цена moveTo с принудительным поиском пути (reusePath: 0).
    const r2 = JSON.parse(
      await evalInGame(
        "mv2",
        `(()=>{${PRELUDE}if(!c)return JSON.stringify({err:"нет крипа"});const u=()=>Game.cpu.getUsed();` +
          `const t=u();const rc=c.moveTo(st,{reusePath:0});const cost=u()-t;` +
          `const after=!!(c.memory._move&&c.memory._move.path);` +
          `return JSON.stringify({after,rc,cost:+cost.toFixed(4),range:D});})()`,
      ),
      TICK_MS,
    );
    console.log("2. moveTo с поиском пути:", JSON.stringify(r2));
    out.freshSearch = r2;

    // 3. Кто платит за поиск: крипы без кэша _move + возраст кэшей.
    const r3 = JSON.parse(
      await evalInGame(
        "mv3",
        `(()=>{const now=Game.time;let n=0,noCache=0,ages=[];` +
          `for(const k in Memory.creeps){n++;const m=Memory.creeps[k]._move;` +
          `if(!m||!m.path){noCache++;}else{ages.push(now-m.time);}}` +
          `ages.sort((a,b)=>a-b);` +
          `return JSON.stringify({creeps:n,noCache,ageMin:ages[0],ageMed:ages[(ages.length/2)|0],` +
          `ageMax:ages[ages.length-1],nAges:ages.length});})()`,
      ),
      TICK_MS,
    );
    console.log("3. кэши путей:", JSON.stringify(r3));
    out.cacheState = r3;

    // 4. Оценка частоты поиска: сколько кэшей создано за 10 тиков (по time в _move).
    const r4 = JSON.parse(
      await evalInGame(
        "mv4",
        `(()=>{const now=Game.time;let fresh=0,stale=0;` +
          `for(const k in Memory.creeps){const m=Memory.creeps[k]._move;if(!m||!m.path)continue;` +
          `if(now-m.time<=10)fresh++;else stale++;}return JSON.stringify({now,fresh,stale});})()`,
      ),
      TICK_MS,
    );
    console.log("4. кэши моложе 10 тиков:", JSON.stringify(r4));
    out.freshRate = r4;

    const report = {
      measuredAt: new Date().toISOString(),
      shard: SHARD,
      context: head,
      ...out,
    };
    const fs = require("fs");
    const path = require("path");
    const outFile = path.join(__dirname, "..", "docs", "move-cost-measure.json");
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nОтчёт сохранён: ${outFile}`);
  } finally {
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(500);
    await api.console(
      "delete Memory.__bench_mvHead; delete Memory.__bench_mv1; delete Memory.__bench_mv2;" +
        " delete Memory.__bench_mv3; delete Memory.__bench_mv4;",
      SHARD,
    );
    await sleep(500);
    console.log("временные поля удалены");
  }
  process.exit(0);
}

main().catch(e => {
  console.log("КРИТИЧЕСКАЯ ОШИБКА:", e.message);
  process.exit(1);
});
