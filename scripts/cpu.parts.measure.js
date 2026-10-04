"use strict";
/**
 * ===================================================
 * SCRIPTS/CPU.PARTS.MEASURE.JS — цена НЕразмеченных частей тика
 * ===================================================
 * Зачем: `Memory.cpuStats.subsystems` знает только подсистемы, обёрнутые в
 * `cpuMonitor.trackRole` (room.manager.js: towers, linkManager, spawnManager,
 * taskManager, factoryManager, powerSpawnManager; empire.js: marketManager,
 * taskCompact) и роли крипов в подробном режиме. Сборка состояний комнат
 * (`room/run.js:219` → `room/state.js:143` → `room/state.js:39`) не обёрнута
 * ничем, а разница «всего расхода минус сумма подсистем» на shard3 01.10.2026
 * давала ≈1.8-2.5 CPU/тик — то есть эта часть была самой крупной и невидимой.
 *
 * Что мерит: реплику отдельных шагов тика в консоли шарда, каждую — K раз
 * внутри одного выражения, с делением на K (разброс одиночных замеров на живом
 * шарде больше эффекта, см. docs/CPU-BASELINE.md, раздел 14.5).
 *
 * ВАЖНО про кэш движка: `Room.find` кэшируется на тик (engine
 * src/game/rooms.js:584-657, `register.findCache`), поэтому повторные вызовы
 * одной и той же функции внутри тика дешевле первого. Все замеры ниже помечены
 * как «цена при прогретом кэше тика» — это заниженная, но одинаковая для всех
 * шагов мерка; сравнивать шаги между собой по ней можно, переносить в боевой
 * расход — нельзя.
 *
 * Read-only: пишет только `Memory.keepTemp` и `Memory.__bench_*`, снимает их в
 * finally. Игровых интентов нет: `Game.getObjectById`, `room.find`, `Game.cpu.*`.
 *
 * Запуск:
 *   node scripts/cpu.parts.measure.js [shard3] [K] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const K = +(process.argv[3] || 20);
const OUT = process.argv[4] || "/tmp/cpu-parts.json";
const PAUSE_MS = 2500;
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evalInGame(field, expression) {
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
    await sleep(PAUSE_MS);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(PAUSE_MS);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(500);
  if (value === undefined || value === null) throw new Error(`пустой ответ для ${key}`);
  return String(value);
}

/** Обёртка: K повторов одного выражения, результат — CPU на один проход. */
function rep(body) {
  return (
    `(()=>{const u=()=>Game.cpu.getUsed();let t=0;` +
    `for(let i=0;i<${K};i++){const t0=u();${body};t+=u()-t0;}` +
    `return (t/${K}).toFixed(5);})()`
  );
}

async function section(title, fn) {
  console.log(`\n=== ${title}`);
  try {
    const out = await fn();
    if (out !== undefined) console.log(out);
    return out;
  } catch (e) {
    console.log(`  ОШИБКА: ${e.message}`);
    return undefined;
  }
}

(async () => {
  const { source } = resolveTokenSource();
  console.log(`Замер НЕразмеченных частей тика, шард ${SHARD}, K=${K} (токен из: ${source})`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1200);

  const report = { capturedAt: new Date().toISOString(), shard: SHARD, K, steps: {} };

  const take = async (name, expression) => {
    const v = await section(
      name,
      async () => {
        const raw = await evalInGame(name.replace(/[^a-z0-9]/gi, ""), expression);
        if (raw.startsWith("ERR:")) throw new Error(raw);
        report.steps[name] = +raw;
        return `  ${raw} CPU за проход`;
      },
    );
    return v;
  };

  await section("0. Контекст", async () => {
    const raw = await evalInGame(
      "ctx",
      `JSON.stringify({t:Game.time,lim:Game.cpu.limit,bkt:Game.cpu.bucket,` +
        `cr:Object.keys(Game.creeps).length,` +
        `avg:Memory.cpuStats&&+Memory.cpuStats.average.toFixed(4),` +
        `cnt:Memory.cpuStats&&Memory.cpuStats.count})`,
    );
    if (raw.startsWith("ERR:")) throw new Error(raw);
    report.context = JSON.parse(raw);
    return JSON.stringify(report.context);
  });

  // ── 1. Сборка состояний комнат целиком (главная неразмеченная статья) ──
  await take(
    "buildAllRoomStates",
    rep(`require("room.manager").buildAllRoomStates()`),
  );

  // ── 2. Из чего она состоит: getOwnedRooms, проход по крипам, кэш структур ──
  await take("getOwnedRooms", rep(`require("room.manager").getOwnedRooms()`));
  await take(
    "creepPass",
    rep(
      `(()=>{let n=0;for(const k in Game.creeps){const c=Game.creeps[k];` +
        `if(c&&c.memory.homeRoom)n++;}return n;})()`,
    ),
  );
  await take(
    "scannerCache",
    rep(`require("scanner").getStructureCache(Game.rooms[Object.keys(Game.rooms)[0]])`),
  );
  await take(
    "getSitesByRoom",
    rep(`require("scanner").getSitesByRoom()`),
  );

  // ── 3. Резолв групп структур комнаты: столько Game.getObjectById, сколько
  //      id в кэше (spawns+towers+links+labs+extensions+sources+storage...). ──
  await take(
    "resolveGroups",
    rep(
      `(()=>{const rm=require("room.manager");const r=rm.getOwnedRooms()[0];` +
        `const c=require("scanner").getStructureCache(r);` +
        `const g=[c.spawnIds,c.towerIds,c.linkIds,c.labIds,c.extensionIds,c.sourceIds];` +
        `let n=0;for(const a of g)if(a)for(const id of a){if(Game.getObjectById(id))n++;}return n;})()`,
    ),
  );

  // ── 4. Уборка памяти и временных полей (empire.js:17-42) ──
  await take(
    "memCleanup",
    rep(
      `(()=>{let n=0;for(const k in Memory.creeps){if(!Game.creeps[k])n++;}return n;})()`,
    ),
  );
  await take(
    "tempPurge",
    rep(
      `(()=>{let n=0;for(const k in Memory){if(k.charCodeAt(0)===95&&k.charCodeAt(1)===95)n++;}return n;})()`,
    ),
  );

  // ── 5. Размеры, чтобы понимать, что именно обходится ──
  await section("5. Размеры", async () => {
    const raw = await evalInGame(
      "sizes",
      `(()=>{const r=require("room.manager").getOwnedRooms()[0];` +
        `const c=require("scanner").getStructureCache(r);` +
        `const s={};for(const k in c){const v=c[k];s[k]=Array.isArray(v)?v.length:(typeof v);}` +
        `s.roomName=r.name;s.sites=Object.keys(require("scanner").getSitesByRoom()).length;` +
        `return JSON.stringify(s);})()`,
    );
    if (raw.startsWith("ERR:")) throw new Error(raw);
    report.sizes = JSON.parse(raw);
    return JSON.stringify(report.sizes, null, 1);
  });

  await section("Очистка", async () => {
    await api.console("delete Memory.keepTemp", SHARD);
    await api.console("delete Memory.__bench_ctx", SHARD);
    return "keepTemp снят";
  });

  fs.writeFileSync(OUT, JSON.stringify(report, null, 1), "utf8");
  console.log(`\nсырые данные: ${OUT}`);
  process.exit(0);
})().catch(e => {
  console.error("КРИТИЧЕСКАЯ ОШИБКА:", e && e.message ? e.message : e);
  process.exit(1);
});
