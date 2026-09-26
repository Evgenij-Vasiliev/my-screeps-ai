"use strict";
/**
 * ===================================================
 * LOG.TEST.JS — офлайн-проверка гейтов логов горячих путей
 * ===================================================
 * Задача 10 оценки 25.09.2026: console.log из горячих путей ролей убран или
 * переведён на «раз в сессию» / «раз в N тиков». Здесь проверяется сам гейт,
 * от которого зависит и экономия CPU, и отсутствие спама:
 *   1) warnOnce печатает ровно один раз на ключ, разные ключи независимы;
 *   2) warnThrottled подавляет повторы внутри интервала и печатает после него;
 *   3) ленивое сообщение НЕ строится, когда строка подавлена (ради этого
 *      message и принимается функцией);
 *   4) global reset (пропавший global._logLimiter) снова разрешает warnOnce —
 *      предупреждение не теряется навсегда;
 *   5) строка-сообщение работает наравне с функцией.
 *
 * Запуск: node tests/log.test.js
 */

global.Game = { time: 1000 };

const log = require("../log");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

/** Перехватывает console.log на время fn и возвращает массив строк. */
function capture(fn) {
  const seen = [];
  const orig = console.log;
  console.log = (...args) => {
    seen.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return seen;
}

function resetLimiter() {
  global._logLimiter = undefined;
}

// ── 1. warnOnce: один раз на ключ ────────────────────────────────────────
console.log("\n1. warnOnce: ровно одна строка на ключ");
{
  resetLimiter();
  const seen = capture(() => {
    log.warnOnce("a", "первый");
    log.warnOnce("a", "второй");
    log.warnOnce("b", "другой ключ");
  });
  check("два ключа — две строки", seen.length === 2, JSON.stringify(seen));
  check("печатается первое сообщение ключа", seen[0] === "первый", seen[0]);
  check("независимый ключ не подавлен", seen[1] === "другой ключ", seen[1]);
}

// ── 2. warnThrottled: интервал тиков ─────────────────────────────────────
console.log(`\n2. warnThrottled: не чаще раза в ${log.THROTTLE_INTERVAL} тиков`);
{
  resetLimiter();
  Game.time = 1000;
  const seen = capture(() => {
    log.warnThrottled("t", "t0");
    Game.time = 1050;
    log.warnThrottled("t", "t50");
    Game.time = 1099;
    log.warnThrottled("t", "t99");
    Game.time = 1100;
    log.warnThrottled("t", "t100");
  });
  check(
    "внутри интервала подавлено, на границе — нет",
    JSON.stringify(seen) === JSON.stringify(["t0", "t100"]),
    JSON.stringify(seen),
  );
  check(
    "интервал — положительное число",
    typeof log.THROTTLE_INTERVAL === "number" && log.THROTTLE_INTERVAL > 0,
    String(log.THROTTLE_INTERVAL),
  );
}

// ── 3. Ленивое сообщение не строится при подавлении ──────────────────────
console.log("\n3. Подавленный тик не строит строку (ленивое сообщение)");
{
  resetLimiter();
  Game.time = 2000;
  let built = 0;
  const seen = capture(() => {
    log.warnThrottled("lazy", () => {
      built++;
      return "строка";
    });
    log.warnThrottled("lazy", () => {
      built++;
      return "строка-2";
    });
  });
  check("функция вызвана один раз", built === 1, String(built));
  check("строка напечатана один раз", seen.length === 1, JSON.stringify(seen));

  // Тот же контракт для warnOnce.
  resetLimiter();
  let onceBuilt = 0;
  capture(() => {
    log.warnOnce("lazy-once", () => {
      onceBuilt++;
      return "x";
    });
    log.warnOnce("lazy-once", () => {
      onceBuilt++;
      return "y";
    });
  });
  check("warnOnce тоже не строит подавленное сообщение", onceBuilt === 1, String(onceBuilt));
}

// ── 4. global reset снимает «один раз» ───────────────────────────────────
console.log("\n4. global reset: warnOnce снова печатает");
{
  resetLimiter();
  const first = capture(() => log.warnOnce("r", "до сброса"));
  resetLimiter();
  const second = capture(() => log.warnOnce("r", "после сброса"));
  check("до сброса — строка есть", first.length === 1, JSON.stringify(first));
  check("после сброса — строка снова есть", second.length === 1, JSON.stringify(second));
}

// ── 5. Строка как сообщение ──────────────────────────────────────────────
console.log("\n5. warnThrottled принимает и строку, и функцию");
{
  resetLimiter();
  Game.time = 3000;
  const seen = capture(() => {
    log.warnThrottled("s", "просто строка", 10);
  });
  check("строка напечатана", seen[0] === "просто строка", seen[0]);
}

console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
