#!/usr/bin/env node
"use strict";
// ===================================================
// SCRIPTS/SYNC-TEST-COUNTS.JS — числа тестов в доках из вывода раннера
// ===================================================
// Зачем: README и docs/SESSION_HANDOFF.md годами называли число тестов руками
// («30 PASS / 0 FAIL», «26/26», «34 файла») и расходились с фактом — оценка
// 25.09.2026, п. 7. Теперь числа генерируются, а не набираются.
//
// КАК ЭТО УСТРОЕНО
//   1. tests/run-all.js на полном прогоне (без фильтров) пишет машиночитаемую
//      сводку в tests/.last-run.json.
//   2. В доках стоит невидимый в отрендеренном markdown маркер:
//
//          <!-- tests:auto -->**34 PASS / 0 FAIL** (34 файла)<!-- /tests:auto -->
//
//   3. Этот скрипт перезаписывает содержимое КАЖДОГО такого маркера
//      канонической строкой из сводки раннера. Руками внутри маркера не
//      правится ничего: правка будет затёрта.
//
// ИСПОЛЬЗОВАНИЕ
//   node scripts/sync-test-counts.js          # прогнать тесты и обновить доки
//   node scripts/sync-test-counts.js --check  # только проверить (код 1 при дрейфе)
//   node scripts/sync-test-counts.js --from=tests/.last-run.json   # без прогона
//
// Числа в маркеры НЕ пишутся, пока тесты красные: доки не должны утверждать
// зелёный статус, которого нет. Исторические числа в тексте сессий остаются
// как есть — это летопись, а не текущий статус.
// ===================================================

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RUNNER = path.join(ROOT, "tests", "run-all.js");
/**
 * Путь к сводке. tests/run-all.js знает тот же путь (DEFAULT_SUMMARY_FILE) —
 * держать эти две константы согласованными.
 */
const SUMMARY_FILE = path.join(ROOT, "tests", ".last-run.json");

const OPEN = "<!-- tests:auto -->";
const CLOSE = "<!-- /tests:auto -->";
/**
 * Свежий regex на каждый вызов: у глобального литерала есть lastIndex, и
 * `.test()`/`.exec()` подряд по разным файлам молча врут на втором файле.
 *
 * Блок ограничен ОДНОЙ строкой (`[^\n]*?`): иначе одиночный открытый маркер,
 * забытый в прозе, проглотил бы пол-документа до следующего закрывающего.
 * Все настоящие маркеры в README/HANDOFF встроены в одну строку.
 */
const markerPattern = () =>
  /<!--\s*tests:auto\s*-->[^\n]*?<!--\s*\/tests:auto\s*-->/g;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

// ── Канонический текст маркера ───────────────────────────────────────────

/** Русская форма слова «файл» для числа тестовых файлов. */
function pluralFiles(n) {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return "файл";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "файла";
  return "файлов";
}

/** @param {{passed:number, failed:number, files:number}} summary */
function formatCounts(summary) {
  return `**${summary.passed} PASS / ${summary.failed} FAIL** (${summary.files} ${pluralFiles(summary.files)})`;
}

/** Полный блок маркера с каноническим содержимым. */
function renderBlock(summary) {
  return `${OPEN}${formatCounts(summary)}${CLOSE}`;
}

/**
 * Заменяет содержимое всех маркеров в тексте. Маркеры без пары не трогаются:
 * битый маркер должен быть виден, а не молча проглочен.
 * @returns {{text: string, replaced: number}}
 */
function replaceMarkers(text, summary) {
  let replaced = 0;
  const out = text.replace(markerPattern(), () => {
    replaced++;
    return renderBlock(summary);
  });
  return { text: out, replaced };
}

// ── Поиск документов с маркерами ─────────────────────────────────────────

/** Все .md репозитория, кроме node_modules/.git, в стабильном порядке. */
function findDocFiles(dir = ROOT, acc = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) findDocFiles(full, acc);
    else if (name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

/**
 * Расхождения между доками и сводкой.
 * @returns {Array<{file:string, count:number, expected:string, actual:string[]}>}
 */
function collectDrift(summary, files = findDocFiles()) {
  const drift = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const found = text.match(markerPattern());
    if (!found || found.length === 0) continue;
    const expected = renderBlock(summary);
    const wrong = found.filter((block) => block !== expected);
    if (wrong.length > 0) {
      drift.push({ file, count: wrong.length, expected, actual: wrong });
    }
  }
  return drift;
}

// ── Сводка раннера ───────────────────────────────────────────────────────

/** Время последнего изменения входов, от которых зависит ЧИСЛО тестов. */
function newestTestMtime() {
  const dir = path.join(ROOT, "tests");
  let newest = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".test.js") && name !== "run-all.js") continue;
    const stat = fs.statSync(path.join(dir, name));
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  }
  return newest;
}

/** Сводка ещё описывает текущий набор тестов? */
function isSummaryFresh(file = SUMMARY_FILE) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  return stat.mtimeMs + 1000 >= newestTestMtime();
}

function readSummary(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    fail(`не читается сводка ${path.relative(ROOT, file)}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fail(`сводка ${path.relative(ROOT, file)} — не JSON: ${err.message}`);
  }
}

/** Прогон раннера в режиме --json; выход по коду 1/2, если тесты не прошли. */
function runRunner() {
  console.log(`Прогон тестов: node tests/run-all.js --json …`);
  const result = spawnSync(process.execPath, [RUNNER, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.error) fail(`не запустить раннер: ${result.error.message}`);

  const lastLine = String(result.stdout || "")
    .trim()
    .split("\n")
    .pop();
  if (!lastLine) {
    process.stderr.write(String(result.stderr || ""));
    fail(`раннер не вернул JSON-сводку (код ${result.status})`);
  }

  let summary;
  try {
    summary = JSON.parse(lastLine);
  } catch (err) {
    process.stderr.write(String(result.stderr || ""));
    fail(`не разобрать JSON раннера: ${err.message}`);
  }

  if (result.status === 2) {
    fail("раннер не нашёл тестов (код 2)");
  }
  if (summary.failed > 0 || result.status !== 0) {
    console.error(
      `Тесты красные: ${summary.passed} PASS / ${summary.failed} FAIL — числа в доки не пишем.`,
    );
    for (const failure of summary.failures || []) {
      console.error(`  ${failure.file} — ${failure.reason}`);
    }
    process.exit(1);
  }
  return summary;
}

/** exit с понятным сообщением; в тестах не вызывается (там функции зовутся напрямую). */
function fail(message) {
  console.error(`sync-test-counts: ${message}`);
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { check: false, from: null, help: false };
  for (const arg of argv) {
    if (arg === "--check") opts.check = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("--from=")) opts.from = path.resolve(ROOT, arg.slice("--from=".length));
    else fail(`неизвестный аргумент: ${arg} (см. --help)`);
  }
  return opts;
}

function usage() {
  console.log(
    [
      "Использование:",
      "  node scripts/sync-test-counts.js          # прогнать тесты и обновить доки",
      "  node scripts/sync-test-counts.js --check  # проверить доки, ничего не писать",
      "  node scripts/sync-test-counts.js --from=PATH   # взять готовую сводку",
      "",
      "Числа живут между маркерами <!-- tests:auto --> … <!-- /tests:auto -->",
      "в README.md и docs/*.md; руками их не правят.",
    ].join("\n"),
  );
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    usage();
    return 0;
  }

  const summary = opts.from
    ? readSummary(opts.from)
    : opts.check && isSummaryFresh()
      ? readSummary(SUMMARY_FILE)
      : runRunner();

  if (summary.failed > 0) {
    console.error(
      `Сводка раннера красная: ${summary.passed} PASS / ${summary.failed} FAIL — доки не трогаем.`,
    );
    return 1;
  }

  const files = findDocFiles();
  const withMarkers = files.filter((file) =>
    markerPattern().test(fs.readFileSync(file, "utf8")),
  );
  if (withMarkers.length === 0) {
    console.error(
      "sync-test-counts: ни в одном .md не найдено маркеров <!-- tests:auto -->. " +
        "Маркеры удалены или переименованы — числа тестов снова придётся держать руками.",
    );
    return 1;
  }

  const status = `${summary.passed} PASS / ${summary.failed} FAIL (${summary.files} ${pluralFiles(summary.files)})`;

  if (opts.check) {
    const drift = collectDrift(summary, files);
    if (drift.length === 0) {
      console.log(`Числа тестов в доках совпадают с прогоном: ${status}`);
      return 0;
    }
    console.error(`Числа тестов в доках разошлись с прогоном: ${status}`);
    for (const item of drift) {
      console.error(`\n${path.relative(ROOT, item.file)} (${item.count}):`);
      console.error(`  сейчас: ${item.actual.join("\n          ")}`);
      console.error(`  должно: ${item.expected}`);
    }
    console.error("\nПочини: npm run test:counts");
    return 1;
  }

  let changed = 0;
  for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    const { text, replaced } = replaceMarkers(before, summary);
    if (replaced === 0) continue;
    const rel = path.relative(ROOT, file);
    if (text === before) {
      console.log(`${rel}: без изменений (${replaced})`);
      continue;
    }
    fs.writeFileSync(file, text);
    changed++;
    console.log(`${rel}: обновлено (${replaced})`);
  }

  console.log(`Числа тестов: ${status}${changed ? "" : " — доки уже совпадали"}`);
  return 0;
}

module.exports = {
  pluralFiles,
  formatCounts,
  renderBlock,
  replaceMarkers,
  findDocFiles,
  collectDrift,
  isSummaryFresh,
  main,
  OPEN,
  CLOSE,
  markerPattern,
  SUMMARY_FILE,
};

if (require.main === module) {
  process.exitCode = main();
}
