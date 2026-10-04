"use strict";
/**
 * ===================================================
 * SCRIPTS/CHECK.ALL.JS — один прогон всех проверок проекта
 * ===================================================
 * Зачем: проверки разбросаны по трём разным командам (26 тестов циклом из
 * AGENTS.md:22, отдельно scripts/check.require.cycles.js, отдельно
 * scripts/check.boot.js, отдельно scripts/validate.skills.js), а агрегат
 * tests/.last-run.json молча устаревает: файл в .gitignore (.gitignore:10),
 * его обновляет рука, а не команда. Перед выгрузкой нужно одно число, а не
 * четыре вывода.
 *
 * Что запускает (каждый пункт — отдельный процесс node, cwd = корень репозитория):
 *   1) tests/*.test.js — все офлайн-тесты, по одному процессу на файл: так же,
 *      как в AGENTS.md:22 («node tests/<файл>.test.js»), иначе глобалы одного
 *      теста протекают в другой;
 *   2) scripts/check.require.cycles.js — циклический require движок Screeps (в
 *      отличие от Node) не разрешает и роняет загрузку ВСЕХ модулей;
 *   3) scripts/check.boot.js — загрузка 32 модулей и цепочки
 *      main -> empire -> room.manager на пустом Game;
 *   4) scripts/validate.skills.js — скиллы DSH: невалидный frontmatter или
 *      незакавыченный «: » в description заставляют провайдер МОЛЧА выбросить
 *      скилл из каталога сессии.
 *
 * Формат сводки по тестам. Тесты печатают итог двумя разными способами, и оба
 * обязаны разбираться, иначе часть файлов попадёт в отчёт как «0 проверок»:
 *   - «Итого: N PASS, M FAIL, K всего» (большинство);
 *   - «ПРОЙДЕНО: N, ПРОВАЛЕНО: M» (boost.energy, lab.worker,
 *     terminalNetwork.cache — у них свой check()).
 * Файл без разобранной строки не считается зелёным по умолчанию: статус и
 * код возврата берутся из процесса, а число проверок помечается 0.
 *
 * Агрегат: tests/.last-run.json — та же схема, что у прошлого прогона
 * (files, passed, failed, failures, timeoutMs, durationMs, node, filters,
 * generatedAt, command, checks{total,failed,passed}, details[{file,status,
 * checks,failed,ms}]). Файл в .gitignore и на шард не уезжает: выгрузка берёт
 * только "*.js", "constants/*.js", "room/*.js" и "task/*.js"
 * (scripts/deploy.modules.js:49), каталог
 * scripts/ в неё не входит.
 *
 * Запуск: node scripts/check.all.js [--quiet]
 * Код возврата: 0 — всё зелёное, 1 — есть падения (тесты или проверки).
 * ===================================================
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const QUIET = process.argv.includes("--quiet");
const TIMEOUT_MS = 120000;

/**
 * Строка итога теста в любом из двух форматов проекта.
 * @param {string} out
 * @returns {{passed: number, failed: number}|null}
 */
function parseSummary(out) {
  const a = out.match(/Итого:\s*(\d+)\s*PASS,\s*(\d+)\s*FAIL/);
  if (a) return { passed: +a[1], failed: +a[2] };

  const b = out.match(/ПРОЙДЕНО:\s*(\d+),\s*ПРОВАЛЕНО:\s*(\d+)/);
  if (b) return { passed: +b[1], failed: +b[2] };

  return null;
}

/** @param {string} file @param {string[]} args */
function runNode(file, args = []) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [file, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  const out = (res.stdout || "") + (res.stderr || "");
  return {
    code: res.status === null ? 1 : res.status,
    out,
    ms: Date.now() - started,
    timedOut: res.error ? String(res.error.message) : null,
  };
}

/* ── 1. Офлайн-тесты ──────────────────────────────────────────────────── */
const testDir = path.join(ROOT, "tests");
const testFiles = fs
  .readdirSync(testDir)
  .filter(f => f.endsWith(".test.js"))
  .sort();

const details = [];
const failures = [];
let checksTotal = 0;
let checksFailed = 0;

for (const name of testFiles) {
  const r = runNode(path.join("tests", name));
  const sum = parseSummary(r.out);
  const status = r.code === 0 ? "PASS" : "FAIL";

  details.push({
    file: name,
    status,
    checks: sum ? sum.passed + sum.failed : 0,
    failed: sum ? sum.failed : 0,
    ms: r.ms,
  });

  if (sum) {
    checksTotal += sum.passed + sum.failed;
    checksFailed += sum.failed;
  }
  if (status === "FAIL") {
    const firstFail = r.out
      .split("\n")
      .filter(l => /FAIL|Error|ОШИБКА/.test(l))
      .slice(0, 3)
      .join(" | ");
    failures.push(`${name}: ${firstFail || "код возврата " + r.code}`);
  }
  if (!QUIET) {
    const checks = sum ? `${sum.passed + sum.failed} проверок` : "сводки нет";
    console.log(
      `  ${status === "PASS" ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${checks.padEnd(14)} ${r.ms} мс`,
    );
  }
}

const passedFiles = details.filter(d => d.status === "PASS").length;
const failedFiles = details.length - passedFiles;

/* ── 2-4. Проверки проекта ────────────────────────────────────────────── */
/**
 * Каждая проверка: как её звать, что считается признаком успеха в выводе и
 * что печатать в сводке. Код возврата процесса — основной признак, строка —
 * доказательство для человека.
 */
const PROBES = [
  {
    name: "check.require.cycles",
    file: path.join("scripts", "check.require.cycles.js"),
    expect: /Циклов require нет/,
    note: out => (out.match(/Модулей корня: \d+/g) || []).join(", "),
  },
  {
    name: "check.boot",
    file: path.join("scripts", "check.boot.js"),
    expect: /main\.loop\(\) на пустом Game: OK/,
    note: out => (out.match(/Загрузка всех \d+ модулей[^\n]*/) || [])[0] || "",
  },
  {
    name: "validate.skills",
    file: path.join("scripts", "validate.skills.js"),
    expect: /Скиллы корректны/,
    note: out => (out.match(/\d+ \| Предупреждений: \d+/g) || []).join(", "),
  },
];

const probeResults = [];
for (const p of PROBES) {
  const r = runNode(p.file);
  const ok = r.code === 0 && p.expect.test(r.out);
  probeResults.push({ name: p.name, ok, ms: r.ms, note: p.note(r.out) });
  if (!ok) {
    const evidence = r.out.split("\n").filter(Boolean).slice(-3).join(" | ");
    failures.push(`${p.name}: ${evidence || "код возврата " + r.code}`);
  }
  if (!QUIET) {
    console.log(
      `  ${ok ? "OK  " : "FAIL"}  ${p.name.padEnd(38)} ${(p.note(r.out) || "").slice(0, 40)} ${r.ms} мс`,
    );
  }
}

/* ── Сводка и агрегат ─────────────────────────────────────────────────── */
const report = {
  files: details.length,
  passed: passedFiles,
  failed: failedFiles,
  failures,
  timeoutMs: TIMEOUT_MS,
  durationMs: details.reduce((s, d) => s + d.ms, 0) + probeResults.reduce((s, p) => s + p.ms, 0),
  node: process.version,
  filters: [],
  generatedAt: new Date().toISOString(),
  command: "node scripts/check.all.js",
  checks: { total: checksTotal, failed: checksFailed, passed: checksTotal - checksFailed },
  probes: probeResults.map(p => ({ name: p.name, status: p.ok ? "PASS" : "FAIL" })),
  details,
};

const ok = failedFiles === 0 && probeResults.every(p => p.ok);

console.log("");
console.log(
  `Тестов: ${report.files} (PASS ${report.passed}, FAIL ${report.failed}), ` +
    `проверок ${report.checks.total} (FAIL ${report.checks.failed})`,
);
console.log(
  `Проверки проекта: ${probeResults.map(p => `${p.name} ${p.ok ? "OK" : "FAIL"}`).join(", ")}`,
);

if (!ok) {
  console.log("\nПАДЕНИЯ:");
  for (const f of failures) console.log("  " + f);
}

// Агрегат пишется ДО выхода: он нужен и при падении — иначе по нему не видно,
// что именно упало. Ошибка записи не должна подменять собой результат проверок.
try {
  fs.writeFileSync(
    path.join(testDir, ".last-run.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`\nАгрегат: tests/.last-run.json (${report.files} файлов, ${report.checks.total} проверок)`);
} catch (e) {
  console.log(`\nАгрегат не записан: ${e.message}`);
}

console.log(ok ? "\nВСЁ ЗЕЛЁНОЕ" : "\nЕСТЬ ПАДЕНИЯ");
process.exit(ok ? 0 : 1);
