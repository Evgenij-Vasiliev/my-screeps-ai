#!/usr/bin/env node
"use strict";
/**
 * ===================================================
 * RUN-ALL.JS — раннер офлайн-тестов
 * ===================================================
 * Запускает все tests/*.test.js каждый в отдельном процессе
 * (`node tests/<file>.test.js`) и сводит результат в один отчёт.
 *
 * Почему отдельные процессы, а не require() в один:
 *   тесты переопределяют глобалы Game/Memory/console, читают и патчат
 *   модули бота и вызывают process.exit — в общем процессе они бы
 *   протекали друг в друга и роняли весь прогон на первом же exit.
 *
 * Код возврата: 0 — все тесты прошли, 1 — есть падения/таймауты,
 * 2 — не найдено ни одного теста.
 *
 * Использование:
 *   node tests/run-all.js                 # все тесты
 *   node tests/run-all.js lab market      # только файлы, чьё имя содержит
 *                                         # "lab" ИЛИ "market"
 *   node tests/run-all.js -v              # печатать вывод и успешных тестов
 *   node tests/run-all.js --timeout=60000 # таймаут на тест, мс (по умолч. 120000)
 *   node tests/run-all.js --list          # только показать, что будет запущено
 *   node tests/run-all.js --json          # в stdout только JSON-сводка (для скриптов)
 *   node tests/run-all.js --summary-file=/tmp/summary.json
 *
 * Полный прогон без фильтров дополнительно пишет JSON-сводку в
 * tests/.last-run.json — из неё scripts/sync-test-counts.js берёт числа для
 * README/SESSION_HANDOFF. Отфильтрованный прогон сводку НЕ трогает: иначе
 * числа в доках сузились бы до подмножества тестов.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TESTS_DIR = __dirname;
const ROOT = path.join(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 120000;
const TEST_SUFFIX = ".test.js";
/** Хвост вывода упавшего теста, который печатается в отчёте. */
const FAILURE_TAIL_LINES = 40;
/**
 * Куда полный прогон пишет машиночитаемую сводку. Путь знает и
 * scripts/sync-test-counts.js — держать эти две строки согласованными.
 */
const DEFAULT_SUMMARY_FILE = path.join(TESTS_DIR, ".last-run.json");

// ── Разбор аргументов ────────────────────────────────────────────────────
const filters = [];
let verbose = false;
let listOnly = false;
let jsonOnly = false;
let summaryFile = DEFAULT_SUMMARY_FILE;
let timeoutMs = DEFAULT_TIMEOUT_MS;

for (const arg of process.argv.slice(2)) {
  if (arg === "-v" || arg === "--verbose") verbose = true;
  else if (arg === "--list") listOnly = true;
  else if (arg === "--json") jsonOnly = true;
  else if (arg.startsWith("--summary-file=")) {
    summaryFile = path.resolve(ROOT, arg.slice("--summary-file=".length));
  } else if (arg === "-h" || arg === "--help") {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0] + "*/");
    process.exit(0);
  } else if (arg.startsWith("--timeout=")) {
    const parsed = Number(arg.slice("--timeout=".length));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(`Некорректный --timeout: ${arg}`);
      process.exit(2);
    }
    timeoutMs = parsed;
  } else if (arg.startsWith("-")) {
    console.error(`Неизвестный флаг: ${arg} (см. --help)`);
    process.exit(2);
  } else {
    filters.push(arg);
  }
}

// ── Поиск тестов ─────────────────────────────────────────────────────────
const allTests = fs
  .readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith(TEST_SUFFIX))
  .sort();

const selected =
  filters.length === 0
    ? allTests
    : allTests.filter((name) => filters.some((f) => name.includes(f)));

if (allTests.length === 0) {
  console.error(`В ${TESTS_DIR} не найдено ни одного *${TEST_SUFFIX}`);
  process.exit(2);
}

if (selected.length === 0) {
  console.error(
    `Ни один тест не подошёл под фильтр: ${filters.join(", ")}\n` +
      `Доступные тесты:\n  ${allTests.join("\n  ")}`,
  );
  process.exit(2);
}

if (listOnly) {
  console.log(selected.join("\n"));
  process.exit(0);
}

// ── Цвета (только в TTY, чтобы не сорить в логах CI) ─────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text);
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const dim = paint(2);
const bold = paint(1);

/**
 * В `--json` stdout принадлежит машине: человекочитаемый прогресс молчит,
 * остаётся ровно один JSON-объект. Ошибки по-прежнему идут в stderr.
 */
const log = jsonOnly ? () => {} : (...args) => console.log(...args);

// ── Запуск одного теста ──────────────────────────────────────────────────
/**
 * Запускает файл теста в дочернем процессе.
 * @returns {Promise<{ok: boolean, timedOut: boolean, code: number|null,
 *                    signal: string|null, output: string, durationMs: number}>}
 */
function runTest(file) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(process.execPath, [path.join(TESTS_DIR, file)], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      // Своя группа процессов — чтобы по таймауту убить и потомков теста.
      detached: true,
    });

    let output = "";
    let timedOut = false;
    let settled = false;

    const collect = (chunk) => {
      output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    // Дочерние тесты не должны пережить раннер: глушим всю группу процессов.
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      resolve({
        ok: !timedOut && code === 0,
        timedOut,
        code,
        signal,
        output,
        durationMs,
      });
    };

    child.on("error", (err) => {
      output += `\n[раннер] не удалось запустить процесс: ${err.message}\n`;
      finish(null, null);
    });
    child.on("close", finish);
  });
}

// ── Печать хвоста вывода упавшего теста ──────────────────────────────────
function printFailureOutput(output) {
  const lines = output.replace(/\s+$/, "").split("\n");
  const tail = lines.slice(-FAILURE_TAIL_LINES);
  if (lines.length > tail.length) {
    log(dim(`      … пропущено строк: ${lines.length - tail.length}`));
  }
  for (const line of tail) log(dim(`      │ ${line}`));
}

// ── Машиночитаемая сводка ────────────────────────────────────────────────
/**
 * Полный прогон (без фильтров) оставляет сводку в tests/.last-run.json —
 * единственный источник чисел для README/SESSION_HANDOFF. Отфильтрованный
 * прогон сводку не пишет: он описывает подмножество, а не состояние проекта.
 * @param {object} summary
 */
function writeSummary(summary) {
  try {
    fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  } catch (err) {
    console.error(
      `[раннер] не удалось записать сводку ${summaryFile}: ${err.message}`,
    );
  }
}

// ── Основной прогон ──────────────────────────────────────────────────────
(async () => {
  const total = selected.length;
  log(
    bold(`\nЗапуск ${total} тест(ов) из tests/`) +
      dim(`  (таймаут на тест: ${timeoutMs} мс, node ${process.version})\n`),
  );

  const failures = [];
  let passedCount = 0;
  const startedAt = Date.now();
  const startedHr = process.hrtime.bigint();

  for (let i = 0; i < total; i++) {
    const file = selected[i];
    const label = `[${String(i + 1).padStart(String(total).length)}/${total}]`;
    if (!jsonOnly) process.stdout.write(`${dim(label)} ${file} … `);

    const result = await runTest(file);
    const secs = (result.durationMs / 1000).toFixed(2);

    if (result.ok) {
      passedCount++;
      log(green("PASS") + dim(` (${secs}s)`));
      if (verbose && result.output.trim()) {
        for (const line of result.output.replace(/\s+$/, "").split("\n")) {
          log(dim(`      │ ${line}`));
        }
      }
      continue;
    }

    const reason = result.timedOut
      ? `TIMEOUT (>${timeoutMs} мс)`
      : `FAIL (код ${result.code}${result.signal ? `, сигнал ${result.signal}` : ""})`;
    log(yellow(reason) + dim(` (${secs}s)`));
    failures.push({
      file,
      reason,
      timedOut: result.timedOut,
      output: result.output,
    });
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  const durationMs = Math.round(Number(process.hrtime.bigint() - startedHr) / 1e6);

  if (failures.length > 0) {
    log(red(bold(`\n─── Вывод упавших тестов ───`)));
    for (const failure of failures) {
      log(red(`\n${failure.file} — ${failure.reason}`));
      printFailureOutput(failure.output);
    }
  }

  // ── Итог ───────────────────────────────────────────────────────────────
  log("");
  log(
    `${bold("Итого:")} ${green(`${passedCount} PASS`)}, ` +
      `${failures.length ? red(`${failures.length} FAIL`) : "0 FAIL"}, ` +
      `${total} всего ${dim(`(${elapsed}s)`)}`,
  );

  if (failures.length > 0) {
    log(red("Провалились: ") + failures.map((f) => f.file).join(", "));
  }

  const summary = {
    files: total,
    passed: passedCount,
    failed: failures.length,
    failures: failures.map((f) => ({ file: f.file, reason: f.reason })),
    timeoutMs,
    durationMs,
    node: process.version,
    filters,
    generatedAt: new Date().toISOString(),
  };

  // Фильтрованный прогон — не состояние проекта, а срез: сводку не трогаем.
  if (filters.length === 0) writeSummary(summary);

  if (jsonOnly) process.stdout.write(`${JSON.stringify(summary)}\n`);

  process.exitCode = failures.length === 0 ? 0 : 1;
})();
