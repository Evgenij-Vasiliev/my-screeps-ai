"use strict";
/**
 * ===================================================
 * SCRIPTS/PROFILING.MEASURE.JS — цена профилирования (Шаг 7)
 * ===================================================
 * Read-only замер ПЕРЕД правкой «профилирование по требованию».
 * Ничего не выгружает на шард и не меняет боевой код: только консольные
 * выражения, результат — во временном поле Memory.__bench_*, боевой
 * Memory не засоряется (все поля удаляются в конце).
 *
 * ЧТО МЕРИТСЯ И ЗАЧЕМ:
 *   Вопрос шага: сколько CPU/тик стоит сам монитор (`cpuMonitor.trackRole`)
 *   и сколько сэкономит гейт «подробный профиль только при полном bucket».
 *   Ответ нельзя получить чтением кода: `Game.cpu.getUsed()` — хост-функция
 *   движка, её цена зависит от машины шарда (docs/CPU-BASELINE.md:44 даёт
 *   0.000244 CPU за вызов — замер 500 вызовов, scripts/baseline.js:126-134).
 *
 *   1) общее состояние: Game.time, лимит, bucket, комнаты, крипы,
 *      Memory.cpuStats (average/creeps) — без этого замер не к чему привязать;
 *   2) P1 — базовая цена пустого цикла (пол цикла измерения);
 *   3) P2 — цикл с пустым вызовом функции (вторая половина);
 *   4) P3 — цикл, воспроизводящий накладные trackRole без хост-вызова:
 *      чтение Game.cpu.bucket, запись в объект, вызов колбэка;
 *   5) P4 — цена ОДНОГО Game.cpu.getUsed() (приём 500 вызовов, как в baseline.js);
 *   6) P5 — цена ОДНОГО вызова trackRole с пустым колбэком;
 *   7) P6 — сколько вызовов trackRole делает бот за тик (пересчёт по
 *      Memory.cpuStats.subsystems и живой переписи комнат).
 *
 *   Цена trackRole = P5 - P1. Разложение («сколько из этого хост-вызов,
 *   сколько JS») = (P4 - P1) * 2 + (P3 - P1).
 *
 * ОГРАНИЧЕНИЯ (проверено ранее, docs/CPU-BASELINE.md:126-134):
 *   - консольная команда длиннее ~1000 символов молча теряется;
 *   - ответ выражения читается из Memory, а не из ответа консоли;
 *   - `Game.cpu.getUsed` нельзя отрывать от объекта — только стрелка.
 *
 * Безопасность: консольные выражения только читают; единственная запись —
 * временные поля `Memory.__*` (уборка идёт в finally). Код бота, Memory
 * боевых полей и игровые объекты не меняются.
 *
 * Запуск:
 *   node scripts/profiling.measure.js          # shard3 по умолчанию
 *   node scripts/profiling.measure.js shard3
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
 * Ошибка выражения не теряется: она возвращается строкой "ERR: <текст>".
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

function fail(msg) {
  console.log(`  ОШИБКА: ${msg}`);
  process.exitCode = 1;
}

/** Один числовой замер с разбором "ERR: ..." и приведением к float. */
async function num(field, expression) {
  const raw = await evalInGame(field, expression);
  if (raw.startsWith("ERR:")) {
    fail(`${field}: ${raw}`);
    return null;
  }
  const n = +raw;
  if (!Number.isFinite(n)) {
    fail(`${field}: не число — ${raw}`);
    return null;
  }
  return n;
}

function line(name, value, unit) {
  console.log(`  ${name.padEnd(46)} ${String(value).padStart(12)} ${unit}`);
}

(async () => {
  const tokenSource = resolveTokenSource().source;
  console.log(`Токен: ${tokenSource}`);
  console.log(`Шард: ${SHARD}\n`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  try {
    /* ── 1. Состояние шарда ───────────────────────────────────────────── */
    console.log("1. Состояние шарда");
    const raw = await evalInGame(
      "general",
      `JSON.stringify({ t: Game.time, lim: Game.cpu.limit, bkt: Game.cpu.bucket,
        creeps: Object.keys(Game.creeps).length,
        rooms: Object.keys(Game.rooms).filter(n => Game.rooms[n].controller && Game.rooms[n].controller.my).length,
        avg: Memory.cpuStats && Memory.cpuStats.average,
        cnt: Memory.cpuStats && Memory.cpuStats.count,
        subs: Memory.cpuStats && Object.keys(Memory.cpuStats.subsystems || {}).length,
        subNames: Memory.cpuStats && Object.keys(Memory.cpuStats.subsystems || {}).join("|"),
        verbose: Memory.cpuMonitorVerbose === true })`,
    );
    if (raw.startsWith("ERR:")) {
      fail(raw);
    } else {
      const d = JSON.parse(raw);
      line("Game.time", d.t, "");
      line("Game.cpu.limit", d.lim, "CPU");
      line("Game.cpu.bucket", d.bkt, "CPU");
      line("свои комнаты", d.rooms, "шт");
      line("крипы", d.creeps, "шт");
      line("Memory.cpuStats.average", d.avg === undefined ? "(нет)" : d.avg, "CPU/тик");
      line("Memory.cpuStats.count", d.cnt === undefined ? "(нет)" : d.cnt, "тиков");
      line("подсистем в subsystems", d.subs, "шт");
      line("имена подсистем", d.subNames || "(пусто)", "");
      line("Memory.cpuMonitorVerbose", d.verbose, "");
      console.log("");
      global.__state = d;
    }

    /* ── 2. Цена хост-функции и накладных trackRole ───────────────────── */
    const N = 2000;

    console.log(`2. Разложение цены trackRole (по ${N} итераций)`);

    const p1 = await num(
      "p1",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), f = () => {};` +
        ` for (let i = 0; i < ${N}; i++) { f(); }` +
        ` return (u() - t0).toFixed(4); })()`,
    );
    if (p1 !== null) line(`P1: пустой цикл + вызов f() x${N}`, p1, "CPU");

    const p2 = await num(
      "p2",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), f = () => {};` +
        ` for (let i = 0; i < ${N}; i++) { f(); f(); }` +
        ` return (u() - t0).toFixed(4); })()`,
    );
    if (p2 !== null) line(`P2: то же + второй вызов f() x${N}`, p2, "CPU");

    const p3 = await num(
      "p3",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), o = {};` +
        ` for (let i = 0; i < ${N}; i++) { Game.cpu.bucket; o.k = (o.k || 0) + 1; }` +
        ` return (u() - t0).toFixed(4); })()`,
    );
    if (p3 !== null) line(`P3: bucket + запись в объект x${N}`, p3, "CPU");

    const p4 = await num(
      "p4",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), f = () => {};` +
        ` for (let i = 0; i < ${N}; i++) { f(); u(); }` +
        ` return (u() - t0).toFixed(4); })()`,
    );
    if (p4 !== null) line(`P4: цикл + f() + getUsed() x${N}`, p4, "CPU");

    const p5 = await num(
      "p5",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), f = () => {};` +
        ` for (let i = 0; i < ${N}; i++) { require("cpuMonitor").trackRole("__probe", f); }` +
        ` return (u() - t0).toFixed(4); })()`,
    );
    if (p5 !== null) line(`P5: цикл + trackRole("__probe", f) x${N}`, p5, "CPU");

    if (p1 !== null && p2 !== null && p3 !== null && p4 !== null && p5 !== null) {
      const perCall = (p2 - p1) / N;
      const perUsed = (p4 - p2) / N;
      const perBucketWrite = (p3 - p1) / N;
      const perTrack = (p5 - p1) / N;
      const jsPart = 2 * perBucketWrite + perCall;

      console.log("");
      line("цена одного Game.cpu.getUsed()", perUsed.toFixed(6), "CPU");
      line("цена пустого вызова f()", perCall.toFixed(6), "CPU");
      line("цена bucket + записи в объект", perBucketWrite.toFixed(6), "CPU");
      line("ожидаемая JS-часть trackRole", jsPart.toFixed(6), "CPU");
      line("цена ОДНОГО trackRole (замер)", perTrack.toFixed(6), "CPU");
      line(
        "против суммы JS-части",
        `${(perTrack / jsPart).toFixed(2)}x`,
        "",
      );
      global.__perTrack = perTrack;
      global.__perUsed = perUsed;
      global.__jsPart = jsPart;
    }

    /* ── 3. Сверка: один и тот же код с замером и без ─────────────────── */
    console.log("\n3. Сверка аддитивности: одинаковый код под trackRole и вне него");
    const p6 = await num(
      "p6",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), f = () => { let s = 0;` +
        ` for (let j = 0; j < 1000; j++) { s += j; } return s; };` +
        ` for (let i = 0; i < ${N}; i++) { f(); } return (u() - t0).toFixed(4); })()`,
    );
    if (p6 !== null) line(`P6: работа (цикл 1000) + f() x${N}`, p6, "CPU");

    const p7 = await num(
      "p7",
      `(() => { const u = () => Game.cpu.getUsed(), t0 = u(), f = () => { let s = 0;` +
        ` for (let j = 0; j < 1000; j++) { s += j; } return s; };` +
        ` for (let i = 0; i < ${N}; i++) { require("cpuMonitor").trackRole("x", f); }` +
        ` return (u() - t0).toFixed(4); })()`,
    );
    if (p7 !== null) line(`P7: та же работа внутри trackRole x${N}`, p7, "CPU");

    if (p6 !== null && p7 !== null) {
      line("накладные trackRole поверх работы", ((p7 - p6) / N).toFixed(6), "CPU");
    }

    /* ── 4. Сколько вызовов trackRole делает бот за тик ───────────────── */
    console.log("\n4. Число вызовов trackRole за тик (по коду)");
    const st = global.__state;
    if (st && st.subs > 0) {
      const names = String(st.subNames).split("|").filter(Boolean);
      const sysNames = names.filter(n => n !== "__probe");
      line("подсистем в одном тике", sysNames.length, "шт");
      console.log(`    ${sysNames.join(", ")}`);
      line("комнат", st.rooms, "шт");
      console.log(
        `    вызовов trackRole за тик ≈ ${sysNames.length} x ${st.rooms} комнат (без verbose-крипов)`,
      );
    } else {
      console.log(
        "    subsystems пуст или __probe ещё не дошёл до отчёта — считать нечего",
      );
    }

    /* ── 5. Что осталось в Memory ─────────────────────────────────────── */
    console.log("\n5. Проверка уборки");
    const leftovers = await evalInGame(
      "leftovers",
      `Object.keys(Memory).filter(k => k.charCodeAt(0) === 95).join(",")`,
    );
    console.log(`  временные поля в Memory: ${leftovers || "(нет)"}`);
  } catch (e) {
    fail(`${e && e.message ? e.message : e}`);
  } finally {
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(600);
    await api.console(
      `delete Memory.__bench_p1; delete Memory.__bench_p2; delete Memory.__bench_p3;` +
        ` delete Memory.__bench_p4; delete Memory.__bench_p5; delete Memory.__bench_general;` +
        ` delete Memory.__bench_leftovers`,
      SHARD,
    );
    await sleep(600);
    console.log("\nУборка выполнена: Memory.keepTemp и __bench_* удалены.");
  }

  if (process.exitCode === 1) {
    console.log("\nИтог: замер НЕ полный — см. ОШИБКА выше.");
  } else {
    console.log("\nИтог: замер полный.");
  }
})();
