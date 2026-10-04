"use strict";
/**
 * ===================================================
 * SCRIPTS/EXECUTOR.RESOLVE.MEASURE.JS — замер цены резолвов целей (Шаг 3)
 * ===================================================
 * Read-only замер перед правкой «Шаг 3: ленивый резолв целей в исполнителях».
 *
 * ЧТО МЕРИТСЯ (и почему именно так):
 *   1) цена Game.getObjectById(id) на живом шарде — прогрев + 500 вызовов в
 *      одном тике, через Game.cpu.getUsed() (0.000244 CPU за вызов, поэтому
 *      цена считается пачкой, а не одним вызовом);
 *   2) состояние, из которого считается ЧИСЛО вызовов исполнителей:
 *      крипы по комнатам (Memory.creeps.homeRoom), квоты спавна и глубина
 *      очередей задач.
 *
 * ЧТО ЭТИМ ЗАМЕРОМ НЕЛЬЗЯ ПОЛУЧИТЬ (проверено, а не предположено):
 *   число фактических вызовов Game.getObjectById за тик. Попытка обернуть
 *   Game.getObjectById счётчиком из консоли не работает: консольная команда и
 *   код бота исполняются в разных JS-контекстах — обёртка видна в консоли
 *   (`typeof Game.getObjectById.name === ""`), но ни одного вызова из кода
 *   бота не получает (`Memory.__d2` не появляется за 20 c; подробности в
 *   docs/CPU-BASELINE.md, раздел про ограничения консоли).
 *
 * Код бота не меняется, игровых интентов нет. Временные поля: Memory.__rm*.
 *
 * Запуск:
 *   node scripts/executor.resolve.measure.js            # shard3
 *   node scripts/executor.resolve.measure.js shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");
// Квоты — из того же модуля, что читает бот: зашитое число уже один раз
// отстало от квоты (была 2, стала 1), и верхняя граница считалась по старой.
const { SPAWN_QUOTA } = require("../constants");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Выполняет выражение в консоли шарда, результат читает из Memory.__bench_* (как scripts/baseline.js). */
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
  await sleep(600);

  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

async function main() {
  const { source } = resolveTokenSource();
  console.log(`Шаг 3: замер цены резолвов, шард ${SHARD} (токен из: ${source})`);

  // Уборка __* в empire.js иначе удалит поля между командой и чтением.
  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  try {
    // Выражения держатся короче 1000 символов: длинная команда молча теряется.
    const cost1 = JSON.parse(
      await evalInGame(
        "rmA",
        `(()=>{const u=()=>Game.cpu.getUsed();
        const r=Object.values(Game.rooms).find(x=>x.controller&&x.controller.my);
        const ids=[r.storage&&r.storage.id,r.terminal&&r.terminal.id,r.controller.id].filter(Boolean);
        const id=String(ids[0]);
        for(const i of ids)Game.getObjectById(i);
        const t0=u();for(let i=0;i<500;i++)Game.getObjectById(id);const warm=u()-t0;
        const t1=u();for(let i=0;i<500;i++)Game.getObjectById(id);const warm2=u()-t1;
        return JSON.stringify({room:r.name,id:id,warm:+(warm/500).toFixed(6),warm2:+(warm2/500).toFixed(6)});})()`,
      ),
    );
    const cost2 = JSON.parse(
      await evalInGame(
        "rmB",
        `(()=>{const u=()=>Game.cpu.getUsed();
        const miss="0123456789abcdef01234567";
        const t0=u();for(let i=0;i<500;i++)Game.getObjectById(miss);const missing=u()-t0;
        const t1=u();for(let i=0;i<500;i++){if(!global.__rmC||global.__rmC.tick!==Game.time)global.__rmC={tick:Game.time,byId:{}};}
        const guard=u()-t1;
        const t2=u();for(let i=0;i<500;i++){global.__rmC.byId.miss===undefined?0:0;}
        const hit=u()-t2;
        return JSON.stringify({missing:+(missing/500).toFixed(6),cacheGuard:+(guard/500).toFixed(6),cacheRead:+(hit/500).toFixed(6)});})()`,
      ),
    );
    const c = Object.assign({}, cost1, cost2);
    console.log("1. cost:", JSON.stringify(c));

    const state = await evalInGame(
      "rmState",
      `(() => { const byRoom = {}, roles = {};
        for (const n in Memory.creeps) { const m = Memory.creeps[n];
          const r = m.homeRoom || "?"; byRoom[r] = (byRoom[r] || 0) + 1;
          roles[m.role] = (roles[m.role] || 0) + 1; }
        const q = {}; const R = Memory.rooms || {};
        for (const n in R) { const t = R[n].tasks || {}; let total = 0, reserved = 0;
          for (const k in t) { const arr = t[k] || []; total += arr.length;
            for (const x of arr) if (x && x.reservedBy) reserved++; }
          q[n] = total + "/" + reserved; }
        return JSON.stringify({ t: Game.time, creeps: Object.keys(Game.creeps).length,
          rooms: Object.keys(Game.rooms).length, byRoom, roles, queues: q,
          avg: Memory.cpuStats && Memory.cpuStats.average, cnt: Memory.cpuStats && Memory.cpuStats.count }); })()`,
    );
    console.log("2. state:", state);
    const s = JSON.parse(state);

    const cpuPerTick = 0.000244; // Game.cpu.getUsed() — замер docs/cpu-baseline.json
    console.log("\n— Цена одного Game.getObjectById (прогретый id):", c.warm, "CPU");
    console.log("— Цена повторного вызова того же id в том же тике:", c.warm2, "CPU");
    console.log("— Цена вызова по несуществующему id:", c.missing, "CPU");
    console.log("— Стоимость проверки кэша-объекта (tick+byId) на вызов:", c.cacheGuard, "CPU");
    console.log(
      `— Крипов ${s.creeps} в ${s.rooms} комнатах, средний CPU/тик ${s.avg && s.avg.toFixed(3)} (окно ${s.cnt})`,
    );
    console.log("— Роли:", JSON.stringify(s.roles));
    console.log("— Очереди задач (всего/зарезервировано) по комнатам:", JSON.stringify(s.queues));
    const workersPerRoom = SPAWN_QUOTA.worker;
    const rooms = Object.keys(s.queues).length;
    console.log(
      `— Верхняя граница вызовов исполнителей за тик: ${workersPerRoom} воркер на комнату ` +
        `(SPAWN_QUOTA.worker, constants/spawn.js:30) × ${rooms} комнат(ы) × 2 резолва = ` +
        `не более ${workersPerRoom * rooms * 2} вызовов; при ленивом source — вдвое меньше у полных крипов`,
    );

    const out = {
      measuredAt: new Date().toISOString(),
      shard: SHARD,
      gameTime: s.t,
      costPerCall: c,
      state: s,
      cpuGetUsedEach: cpuPerTick,
    };
    const fs = require("fs");
    const path = require("path");
    const outFile = path.join(__dirname, "..", "docs", "resolve-measure.json");
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
    console.log(`\nОтчёт сохранён: ${outFile}`);
  } finally {
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(500);
    await api.console(
      "delete Memory.__bench_rmCost; delete Memory.__bench_rmState;",
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
