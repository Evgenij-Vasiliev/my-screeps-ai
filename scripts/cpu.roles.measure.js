"use strict";
/**
 * ===================================================
 * SCRIPTS/CPU.ROLES.MEASURE.JS — поролевой профиль крипов и генераторов
 * ===================================================
 * Отвечает на вопрос, который обычный замер подсистем НЕ закрывает: `average`
 * считается по всем тикам (4-5 CPU/тик), а `subsystems` без флагов содержит
 * только крупные подсистемы (labManager, terminalNetwork, taskManager, ...).
 * Крипы, генераторы задач и части spawnManager в него не попадают — это и есть
 * «непокрытый остаток». Здесь он измеряется штатными флагами профилирования:
 *
 *   Memory.cpuMonitorVerbose = true  — замер по каждому крипу (cpuMonitor.js:194,
 *                                      room/creeps.js:65-82). Имена ролей попадают
 *                                      в Memory.cpuStats.subsystems;
 *   Memory.cpuGenProfile     = true  — 11 генераторов задач под ключами "gen.*"
 *                                      (room/run.js:80-186);
 *   Memory.cpuSpawnProfile   = true  — части spawnManager: "spawn.countRoles",
 *                                      "spawn.find", "spawn.quotaLoop"
 *                                      (spawn.manager.js:168);
 *   Memory.keepTemp          = true  — уборка полей "__" выключена (empire.js:32),
 *                                      иначе временное поле замера будет удалено
 *                                      ботом между записью и чтением.
 *
 * ВАЖНО про знаменатель: `subsystems` — это CPU/тик за ЧИСЛО ПРОФИЛИРОВАННЫХ
 * тиков последнего окна (cpuMonitor.js:236-241), а `average` — среднее по окну
 * CPU.AVERAGE_WINDOW (100 тиков). Это РАЗНЫЕ окна, поэтому «остаток» ниже
 * считается как два независимых числа, а не как строгая разность.
 *
 * Гейт: подробный замер идёт только когда средний расход прошлого тика не выше
 * CPU.DETAIL_GATE_PCT (0.8) от лимита И bucket полон (CPU.FULL_BUCKET, 10000) —
 * cpuMonitor.js:110. При закрытом гейте в subsystems останется прошлый срез, и
 * скрипт об этом скажет.
 *
 * Read-only по отношению к боевому коду: пишет только четыре флага Memory и
 * временное поле Memory.__bench_cpu, все снимаются в finally и по SIGINT.
 * Код на шард не выгружается.
 *
 * Запуск:
 *   node scripts/cpu.roles.measure.js [shard3] [секунды] [пауза мс] [файл]
 *   node scripts/cpu.roles.measure.js shard3 300 20000 /tmp/cpu-roles.json
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const DURATION_S = +(process.argv[3] || 300);
const PAUSE_MS = +(process.argv[4] || 20000);
const OUT = process.argv[5] || "/tmp/cpu-roles-measure.json";
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Флаги профилирования: имя в Memory → зачем. */
const FLAGS = ["keepTemp", "cpuMonitorVerbose", "cpuGenProfile", "cpuSpawnProfile"];

/** Прежние значения флагов — чтобы вернуть ровно то, что было. */
let saved = null;
let cleaned = false;

/** Снять всё, что поставили: флаги возвращаются к прежним значениям. */
async function cleanup() {
  if (cleaned || !saved) return;
  cleaned = true;
  for (const name of FLAGS) {
    const before = saved[name];
    const cmd =
      before === undefined
        ? `delete Memory.${name}`
        : `Memory.${name} = ${JSON.stringify(before)}`;
    try {
      await api.console(cmd, SHARD);
    } catch (e) {
      console.log(`  снять ${name} не удалось: ${e.message}`);
    }
  }
  await sleep(800);
  console.log("Флаги профилирования возвращены в исходное состояние.");
}

/** @param {string} field @param {string} expression */
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
    await sleep(1500);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(1500);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);
  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

const CONTEXT_EXPR =
  `Game.cpu.limit+"|"+Game.cpu.tickLimit+"|"+Game.cpu.bucket+"|"+
   Object.keys(Game.rooms).length+"|"+Object.keys(Game.creeps).length+"|"+Game.shard.name`;

(async () => {
  console.log(`Шард ${SHARD}, окно ${DURATION_S} с, проба раз в ${PAUSE_MS} мс → ${OUT}`);
  console.log(`Токен: ${resolveTokenSource().source}\n`);

  // 1. Запомнить состояние флагов ДО правки и включить профиль.
  const current = {};
  for (const name of FLAGS) {
    const res = await api.memory.get(name, SHARD);
    current[name] = res && res.data;
    await sleep(250);
  }
  saved = current;
  console.log(
    "Флаги до замера: " +
      FLAGS.map(n => `${n}=${current[n] === undefined ? "нет" : current[n]}`).join(", "),
  );

  process.on("SIGINT", async () => {
    console.log("\nПрерывание — снимаю флаги...");
    await cleanup();
    process.exit(130);
  });

  // Флаги ставятся ДО первого обращения к консоли: временное поле __bench_cpu
  // живёт только пока Memory.keepTemp === true, иначе уборка Memory
  // (empire.js:32-39) удалит его между записью и чтением.
  for (const name of FLAGS) {
    await api.console(`Memory.${name} = true`, SHARD);
    await sleep(250);
  }

  const ctx = await evalInGame("cpu", CONTEXT_EXPR);
  const [limit, tickLimit, bucket0, rooms, creeps, shardName] = ctx.split("|");
  console.log(
    `Контекст: шард ${shardName}, лимит ${limit} (tickLimit ${tickLimit}), bucket ${bucket0}, ` +
      `комнат ${rooms}, крипов ${creeps}`,
  );
  console.log(
    `Профиль включён (гейт DETAIL_GATE_PCT = 0.8×лимита): жду тиков...\n`,
  );

  // 2. Пробы Memory.cpuStats до конца окна. Одинаковые окна отчёта (тот же
  // total+count) схлопываются: cpuStats пишется раз в REPORT_INTERVAL тиков.
  const samples = [];
  const seen = new Set();
  const started = Date.now();
  while ((Date.now() - started) / 1000 < DURATION_S) {
    const res = await api.memory.get("cpuStats", SHARD);
    const s = (res && res.data) || {};
    const key = `${s.total}|${s.count}`;
    const fresh = !seen.has(key) && s.total !== undefined;
    if (fresh) {
      seen.add(key);
      samples.push(s);
      const prof = s.subsystems || {};
      const top = Object.entries(prof)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}=${v.toFixed(3)}`)
        .join(" ");
      console.log(
        `  t=${s.count}тик avg=${s.average === undefined ? "?" : s.average.toFixed(2)} ` +
          `bkt=${s.bucket} крипов=${s.creeps} | ${top || "подробный замер не собирался"}`,
      );
    }
    await sleep(PAUSE_MS);
  }

  await cleanup();

  if (samples.length === 0) {
    console.log("\nНи одной пробы: подробный замер не собрался (гейт закрыт?).");
    process.exit(1);
  }

  // 3. Среднее по ключам за все РАЗНЫЕ окна отчёта.
  const keys = new Set();
  for (const s of samples) for (const k of Object.keys(s.subsystems || {})) keys.add(k);

  const rows = [];
  for (const k of keys) {
    let sum = 0;
    let n = 0;
    for (const s of samples) {
      const v = (s.subsystems || {})[k];
      if (typeof v === "number") {
        sum += v;
        n++;
      }
    }
    rows.push({ key: k, cpu: sum / n, windows: n });
  }
  rows.sort((a, b) => b.cpu - a.cpu);

  const totalSub = rows.reduce((s, r) => s + r.cpu, 0);
  const avgTick =
    samples.reduce((s, x) => s + (x.average || 0), 0) / samples.length;

  console.log(`\n=== Профиль по ключам (среднее за ${samples.length} окон отчёта)`);
  console.log("  CPU/тик    доля   ключ");
  for (const r of rows) {
    const share = totalSub > 0 ? ((r.cpu / totalSub) * 100).toFixed(1) + "%" : "—";
    console.log(`  ${r.cpu.toFixed(4).padStart(8)}  ${share.padStart(5)}   ${r.key}`);
  }
  console.log(`  ${totalSub.toFixed(4).padStart(8)}  100.0%   СУММА профилированных ключей`);
  console.log(
    `\navg тика по окну AVERAGE_WINDOW: ${avgTick.toFixed(3)} CPU/тик ` +
      `(непокрытый остаток ≈ ${(avgTick - totalSub).toFixed(3)} — окна разные, см. шапку)`,
  );

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { shard: SHARD, generatedAt: new Date().toISOString(), limit: +limit, samples, rows },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nСырые окна: ${OUT}`);
})().catch(async e => {
  console.error("ОШИБКА:", e.message);
  await cleanup();
  process.exit(1);
});
