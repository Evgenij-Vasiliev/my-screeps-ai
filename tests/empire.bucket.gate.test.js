"use strict";
/**
 * ===================================================
 * EMPIRE.BUCKET.GATE.TEST.JS — гейт по Game.cpu.bucket
 * ===================================================
 * Проблема (пункт 10 аудита, задача 5 дорожной карты): Game.cpu.bucket
 * читался только для логирования (cpuMonitor.js), а CPU.BUCKET_CRITICAL
 * ни на что не влиял. При истощении bucket не отключалось ничего, и скрипт
 * мог упереться в CPU-лимит движка на необязательных подсистемах.
 *
 * Правка: в empire.js при Game.cpu.bucket < CPU.BUCKET_CRITICAL
 * пропускаются observerManager, terminalNetwork и marketManager. Ядро
 * (roomManager, defenseManager, remoteManager) и очистка памяти работают
 * всегда.
 *
 * Проверяем:
 *   1) bucket ниже порога: не запущены observer/terminalNetwork/market,
 *      а ядро, очистка памяти и startTick/endTick отработали;
 *   2) на неотчётном тике пропуск не логируется, на типе отчёта
 *      (Game.time % CPU.REPORT_INTERVAL === 0) — одна строка в консоли;
 *   3) bucket ровно на пороге (BUCKET_CRITICAL) — гейт НЕ срабатывает
 *      (условие строгое: `<`, а не `<=`);
 *   4) bucket выше порога: запущены все семь подсистем, логов нет.
 *
 * Менеджеры подменяются заглушками через require.cache ДО require("../empire"),
 * поэтому реальные модули не загружаются и тест не зависит от их кода.
 *
 * Запуск: node tests/empire.bucket.gate.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const { CPU } = require("../constants");

// ── Разрешение bare-require в стиле Screeps ──────────────────────────────
const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Заглушки движка ──────────────────────────────────────────────────────
const logged = [];
const origLog = console.log;
console.log = (...args) => {
  logged.push(args.join(" "));
};

global.Memory = { creeps: { dead: {}, alive: {} } };
global.Game = {
  time: 101,
  creeps: { alive: {} },
  cpu: { bucket: 10000 },
};

/** Счётчики вызовов заглушек подсистем. */
const calls = {
  observerManager: 0,
  roomManager: 0,
  marketManager: 0,
  terminalNetwork: 0,
  defenseManager: 0,
  remoteManager: 0,
  startTick: 0,
  endTick: 0,
};

/** Подменяет модуль заглушкой до его реальной загрузки. */
function stub(name, exports) {
  const file = path.join(ROOT, name + ".js");
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const counter = (name) => () => {
  calls[name]++;
};

stub("observer.manager", { run: counter("observerManager") });
stub("room.manager", { run: counter("roomManager") });
stub("market.manager", { run: counter("marketManager") });
stub("terminalNetwork", { run: counter("terminalNetwork") });
stub("defense.manager", { run: counter("defenseManager") });
stub("remote.manager", { run: counter("remoteManager") });
stub("cpuMonitor", {
  startTick: counter("startTick"),
  endTick: counter("endTick"),
  trackRole: (name, fn) => fn(),
});

const empire = require("../empire");

// ── Мини-фреймворк ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    origLog(`  PASS  ${label}`);
  } else {
    failed++;
    origLog(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

/** Сбрасывает счётчики, память и консоль перед тиком. */
function resetTick(time, bucket) {
  Game.time = time;
  Game.cpu.bucket = bucket;
  global.Memory = { creeps: { dead: {}, alive: {} } };
  for (const key of Object.keys(calls)) calls[key] = 0;
  logged.length = 0;
}

const CORE = ["roomManager", "defenseManager", "remoteManager"];
const OPTIONAL = ["observerManager", "terminalNetwork", "marketManager"];

/** Ядро и служебный каркас тика обязаны работать при любом bucket. */
function checkCoreRan(label) {
  for (const name of CORE) {
    check(`${label}: запущен ${name}`, calls[name] === 1, String(calls[name]));
  }
  check(`${label}: startTick вызван`, calls.startTick === 1);
  check(`${label}: endTick вызван`, calls.endTick === 1);
  check(
    `${label}: память умерших крипов очищена`,
    Memory.creeps.dead === undefined && Memory.creeps.alive !== undefined,
  );
}

// ── 1. bucket ниже порога: необязательные подсистемы пропущены ───────────
origLog("\n1) bucket < CPU.BUCKET_CRITICAL — гейт срабатывает");
resetTick(101, CPU.BUCKET_CRITICAL - 1);
empire.run();
for (const name of OPTIONAL) {
  check(`пропущен ${name}`, calls[name] === 0, String(calls[name]));
}
checkCoreRan("низкий bucket");
check(
  "на неотчётном тике пропуск не логируется",
  logged.length === 0,
  JSON.stringify(logged),
);

// ── 2. Пропуск объявляется на типе отчёта ────────────────────────────────
origLog("\n2) тик отчёта — одна строка о пропуске");
resetTick(CPU.REPORT_INTERVAL * 5, CPU.BUCKET_CRITICAL - 1);
empire.run();
check(
  "ровно одна строка в консоли",
  logged.length === 1,
  JSON.stringify(logged),
);
check(
  "в строке есть порог и имена подсистем",
  logged.length === 1 &&
    logged[0].includes(String(CPU.BUCKET_CRITICAL)) &&
    logged[0].includes("observerManager") &&
    logged[0].includes("terminalNetwork") &&
    logged[0].includes("marketManager"),
  JSON.stringify(logged),
);

// ── 3. Ровно порог: условие строгое (`<`), гейт молчит ───────────────────
origLog("\n3) bucket === CPU.BUCKET_CRITICAL — гейт не срабатывает");
resetTick(101, CPU.BUCKET_CRITICAL);
empire.run();
for (const name of OPTIONAL) {
  check(`запущен ${name}`, calls[name] === 1, String(calls[name]));
}
checkCoreRan("пороговый bucket");

// ── 4. bucket выше порога: работают все подсистемы ───────────────────────
origLog("\n4) bucket > CPU.BUCKET_CRITICAL — полный прогон");
resetTick(CPU.REPORT_INTERVAL * 3, CPU.BUCKET_CRITICAL + 5000);
empire.run();
for (const name of [...CORE, ...OPTIONAL]) {
  check(`запущен ${name}`, calls[name] === 1, String(calls[name]));
}
checkCoreRan("высокий bucket");
check("логов нет", logged.length === 0, JSON.stringify(logged));

console.log = origLog;

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
