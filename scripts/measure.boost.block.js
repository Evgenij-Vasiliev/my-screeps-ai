"use strict";
/**
 * ===================================================
 * SCRIPTS/MEASURE.BOOST.BLOCK.JS — read-only замер состояния шарда
 * под порт блока лаб/бустов и терминальной сети.
 * ===================================================
 * Зачем: перед переносом блока бустов из ветки origin/Новая-Империя нужны
 * ФАКТЫ по живому шарду, а не цифры из комментариев чужой ветки (AGENTS.md:6-8:
 * поведение бота проверяется замером, а не выводом из чтения кода).
 *
 * Что измеряется:
 *   1. комнаты: RCL, энергия терминала и склада, занятость, кулдаун терминала,
 *      число лабораторий в комнате;
 *   2. лаборатории: id и содержимое каждой (нужно для X-реакций и буст-лаб);
 *   3. склады терминалов и storage по ресурсам (что вообще есть в империи);
 *   4. состояние Memory: объём, ключи Memory.rooms[*] (остались ли конфиги лаб
 *      от прежних версий кода), cpuStats, GCL, кредиты;
 *   5. состав крипов по ролям (кто есть сейчас).
 *
 * Безопасность: боевой код не меняется. Каждое выражение — отдельная
 * консольная команда, результат кладётся во временное поле Memory.__bench_*
 * и читается через API, после чего поле удаляется. Никаких set/spawn/suicide.
 *
 * Ограничение шарда: консольная команда длиннее ~1024 символов МОЛЧА
 * отбрасывается (проверено, см. scripts/baseline.js:16-19) — здесь длинные
 * выражения разбиты на короткие, предел проверяется до отправки.
 *
 * Запуск:
 *   node scripts/measure.boost.block.js            # shard3 по умолчанию
 *   node scripts/measure.boost.block.js shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;
/** Предел длины консольной команды, проверенный на живом шарде. */
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Выполняет выражение в консоли шарда и возвращает строку с результатом.
 * @param {string} field имя временного поля в Memory (без префикса)
 * @param {string} expression выражение, возвращающее строку
 * @returns {Promise<string>}
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

  // DRY=1 — офлайн-прогон без обращений к шарду: печатает длину каждой
  // консольной команды и не отправляет её. Нужен потому, что слишком длинное
  // выражение шард отбрасывает МОЛЧА (scripts/baseline.js:16-19).
  if (process.env.DRY === "1") {
    console.log(`  [dry] ${field}: command ${command.length} символов`);
    throw new Error(`dry-run ${field}`);
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

/** Печатает результат шага; ошибка шага не прерывает остальные шаги. */
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

/* ── 1. Комнаты, терминалы, склады, число лаб ─────────────────────────── */
async function probeRooms() {
  const raw = await evalInGame(
    "bb_rooms",
    `JSON.stringify(Object.keys(Game.rooms).filter(n=>Game.rooms[n].controller&&Game.rooms[n].controller.my).map(n=>{` +
      `var r=Game.rooms[n],t=r.terminal,s=r.storage;` +
      `var L=r.find(FIND_MY_STRUCTURES,{filter:{structureType:STRUCTURE_LAB}}).length;` +
      `return [n,r.controller.level,` +
      `t?t.store[RESOURCE_ENERGY]||0:-1,t?t.store.getUsedCapacity():-1,t?t.cooldown:-1,` +
      `s?s.store[RESOURCE_ENERGY]||0:-1,s?s.store.getUsedCapacity():-1,L];}))`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  const rows = JSON.parse(raw);
  console.log(
    "name         rcl  termE   termUsed  cd   storE    storUsed  labs",
  );
  for (const r of rows) {
    console.log(
      `${r[0]}  ${r[1]}  ${String(r[2]).padStart(6)}  ${String(r[3]).padStart(8)}  ` +
        `${String(r[4]).padStart(3)}  ${String(r[5]).padStart(6)}  ${String(r[6]).padStart(8)}  ${r[7]}`,
    );
  }
  return rows;
}

/* ── 2. Лаборатории: id и содержимое ─────────────────────────────────── */
async function probeLabs() {
  const raw = await evalInGame(
    "bb_labs",
    `JSON.stringify(Object.keys(Game.rooms).filter(n=>Game.rooms[n].controller&&Game.rooms[n].controller.my).map(n=>{` +
      `var r=Game.rooms[n];` +
      `var L=r.find(FIND_MY_STRUCTURES,{filter:{structureType:STRUCTURE_LAB}});` +
      `return [n,L.map(l=>[l.id,l.store.getUsedCapacity(),` +
      `Object.keys(l.store).filter(k=>l.store[k]>0).map(k=>k+"="+l.store[k]).join("+")])];}))`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  const rows = JSON.parse(raw);
  for (const [roomName, labs] of rows) {
    if (!labs.length) continue;
    console.log(`${roomName}: лабораторий ${labs.length}`);
    for (const [id, used, store] of labs) {
      console.log(`  ${id} used=${used} ${store || "(пусто)"}`);
    }
  }
  if (rows.every(r => r[1].length === 0)) console.log("  лабораторий нет ни в одной комнате");
  return rows;
}

/* ── 3. Содержимое терминалов по ресурсам ────────────────────────────── */
async function probeTerminals() {
  const raw = await evalInGame(
    "bb_term",
    `JSON.stringify(Object.keys(Game.rooms).filter(n=>Game.rooms[n].terminal&&Game.rooms[n].terminal.my).map(n=>{` +
      `var t=Game.rooms[n].terminal;` +
      `return [n,Object.keys(t.store).filter(k=>t.store[k]>0).map(k=>k+"="+t.store[k]).join(" ")];}))`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  const rows = JSON.parse(raw);
  if (!rows.length) console.log("  терминалов нет");
  for (const [roomName, store] of rows) {
    console.log(`${roomName}: ${store || "(пусто)"}`);
  }
  return rows;
}

/* ── 4. Содержимое складов по ресурсам ───────────────────────────────── */
async function probeStorages() {
  const raw = await evalInGame(
    "bb_stor",
    `JSON.stringify(Object.keys(Game.rooms).filter(n=>Game.rooms[n].storage).map(n=>{` +
      `var s=Game.rooms[n].storage;` +
      `return [n,Object.keys(s.store).filter(k=>s.store[k]>0).map(k=>k+"="+s.store[k]).join(" ")];}))`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  const rows = JSON.parse(raw);
  if (!rows.length) console.log("  складов нет");
  for (const [roomName, store] of rows) {
    console.log(`${roomName}: ${store || "(пусто)"}`);
  }
  return rows;
}

/* ── 5. Memory: объём, ключи комнат, cpu, GCL ────────────────────────── */
async function probeMemory() {
  const raw = await evalInGame(
    "bb_mem",
    `JSON.stringify({shard:Game.shard.name,t:Game.time,gcl:Game.gcl.level,` +
      `credits:Game.market.credits,memBytes:(RawMemory.get()||"").length,` +
      `cpuAvg:Memory.cpuStats&&Memory.cpuStats.average,bucket:Game.cpu.bucket,limit:Game.cpu.limit,` +
      `rooms:Object.keys(Memory.rooms||{}).map(n=>[n,Object.keys(Memory.rooms[n]||{}).join("|")])})`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  const d = JSON.parse(raw);
  d.memKb = +(d.memBytes / 1024).toFixed(1);
  delete d.memBytes;
  console.log(JSON.stringify(d, null, 2));
  return d;
}

/* ── 6. Крипы по ролям ───────────────────────────────────────────────── */
async function probeCreeps() {
  const raw = await evalInGame(
    "bb_creeps",
    `JSON.stringify(Object.keys(Game.creeps).reduce((a,n)=>{var r=Game.creeps[n].memory.role||"?";` +
      `a[r]=(a[r]||0)+1;return a;},{}))`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  console.log(raw);
  return raw;
}

async function probeLabCoords() {
  const raw = await evalInGame(
    "bb_lcoords",
    `JSON.stringify(Object.keys(Game.rooms).filter(n=>Game.rooms[n].controller&&Game.rooms[n].controller.my).map(n=>{` +
      `var L=Game.rooms[n].find(FIND_MY_STRUCTURES,{filter:{structureType:STRUCTURE_LAB}});` +
      `return [n,L.map(l=>l.pos.x+","+l.pos.y+"="+l.id).join(" ")];}))`,
  );
  if (raw.startsWith("ERR:")) throw new Error(raw);
  const rows = JSON.parse(raw);
  for (const [roomName, coords] of rows) console.log(`${roomName}: ${coords}`);
  return rows;
}

async function main() {
  const source = resolveTokenSource();
  const ONLY = process.argv[3] ? Number(process.argv[3]) : 0;
  const want = n => !ONLY || ONLY === n;
  console.log(
    `[measure.boost.block] shard=${SHARD} token=${source.source} limit=${CONSOLE_LIMIT}` +
      (ONLY ? ` only=${ONLY}` : ""),
  );

  if (want(1)) await section("1. Комнаты, терминалы, склады, лаборатории", probeRooms);
  if (want(2)) await section("2. Лаборатории: id и содержимое", probeLabs);
  if (want(3)) await section("3. Терминалы по ресурсам", probeTerminals);
  if (want(4)) await section("4. Склады по ресурсам", probeStorages);
  if (want(5)) await section("5. Memory, CPU, GCL", probeMemory);
  if (want(6)) await section("6. Крипы по ролям", probeCreeps);
  if (want(7)) await section("7. Координаты лабораторий (сверка LAB_BINDING)", probeLabCoords);

  console.log("\n[measure.boost.block] готово (боевой код не менялся)");
}

main().catch(e => {
  console.error("[measure.boost.block] фатальная ошибка:", e.message);
  process.exit(1);
});
