"use strict";
/**
 * ===================================================
 * SYNC-TEST-COUNTS.TEST.JS — числа тестов в доках не набираются руками
 * ===================================================
 * Оценка 25.09.2026, п. 7: числа тестов в README/HANDOFF разъезжались с
 * фактом, потому что их писали руками. Теперь их подставляет
 * scripts/sync-test-counts.js из сводки раннера; здесь проверяется контракт
 * подстановки: какие числа попадают в маркер, что чужие маркеры и текст
 * вокруг не трогаются, что расхождение вообще детектируется (иначе гейт в
 * `npm run ci` был бы бутафорией) и что в живых документах маркеры есть.
 *
 * Прогон тестов скрипт НЕ запускает: функции чистые, сводка подставляется
 * синтетическая — тест быстрый и не зависит от числа файлов в tests/.
 *
 * Запуск: node tests/sync-test-counts.test.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  pluralFiles,
  formatCounts,
  renderBlock,
  replaceMarkers,
  collectDrift,
  markerPattern,
  OPEN,
  CLOSE,
} = require("../scripts/sync-test-counts");

const ROOT = path.join(__dirname, "..");

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

const summary = { passed: 34, failed: 0, files: 34 };

// ── 1. Склонение слова «файл» ────────────────────────────────────────────
console.log("\n1. Склонение «файл»");
check("1 → файл", pluralFiles(1) === "файл", pluralFiles(1));
check("34 → файла", pluralFiles(34) === "файла", pluralFiles(34));
check("2 → файла", pluralFiles(2) === "файла", pluralFiles(2));
check("5 → файлов", pluralFiles(5) === "файлов", pluralFiles(5));
check("11 → файлов", pluralFiles(11) === "файлов", pluralFiles(11));
check("21 → файл", pluralFiles(21) === "файл", pluralFiles(21));
check("112 → файлов", pluralFiles(112) === "файлов", pluralFiles(112));

// ── 2. Канонический текст маркера ────────────────────────────────────────
console.log("\n2. Канонический текст маркера");
check(
  "formatCounts даёт PASS / FAIL и число файлов",
  formatCounts(summary) === "**34 PASS / 0 FAIL** (34 файла)",
  formatCounts(summary),
);
check(
  "renderBlock заворачивает числа в маркеры",
  renderBlock(summary) === `${OPEN}**34 PASS / 0 FAIL** (34 файла)${CLOSE}`,
  renderBlock(summary),
);
check(
  "красный прогон честно печатает FAIL",
  formatCounts({ passed: 33, failed: 1, files: 34 }) === "**33 PASS / 1 FAIL** (34 файла)",
  formatCounts({ passed: 33, failed: 1, files: 34 }),
);

// ── 3. Замена маркеров ───────────────────────────────────────────────────
console.log("\n3. Замена маркеров");
const doc =
  "Статус: <!-- tests:auto -->**30 PASS / 0 FAIL**<!-- /tests:auto -->.\n" +
  "Ещё: <!-- tests:auto -->старьё<!-- /tests:auto -->\n" +
  "Историю не трогаем: 26/26 зелёные.\n";
const res = replaceMarkers(doc, summary);
check("заменены оба маркера", res.replaced === 2, res.replaced);
check(
  "оба блока стали каноническими",
  res.text.split(renderBlock(summary)).length === 3,
  res.text,
);
check("текст вокруг сохранён", res.text.includes("Историю не трогаем: 26/26 зелёные."));
check(
  "текст без маркеров не меняется",
  replaceMarkers("просто текст 30/30", summary).replaced === 0,
);
check(
  "битый маркер без пары не трогается",
  replaceMarkers("<!-- tests:auto -->**30**", summary).text === "<!-- tests:auto -->**30**",
);
check(
  "повторный вызов идемпотентен",
  replaceMarkers(res.text, summary).text === res.text,
);

// ── 4. Регулярка не «залипает» между вызовами ────────────────────────────
console.log("\n4. Регулярка без состояния между вызовами");
const twice = [doc, doc].map((text) => markerPattern().test(text));
check("два подряд .test() по одному тексту дают одинаковый ответ", twice[0] && twice[1], twice.join(","));

// ── 5. Детектор дрейфа ───────────────────────────────────────────────────
console.log("\n5. Детектор дрейфа (гейт в npm run ci)");
const goodFile = path.join(os.tmpdir(), `sync-counts-good-${process.pid}.md`);
const badFile = path.join(os.tmpdir(), `sync-counts-bad-${process.pid}.md`);
try {
  fs.writeFileSync(goodFile, `Статус: ${renderBlock(summary)}\n`);
  fs.writeFileSync(badFile, `${OPEN}**30 PASS / 0 FAIL**${CLOSE}\n`);
  check("совпадающий док не даёт дрейфа", collectDrift(summary, [goodFile]).length === 0);
  const drift = collectDrift(summary, [badFile]);
  check("устаревшее число — это дрейф", drift.length === 1, JSON.stringify(drift));
  check(
    "дрейф показывает и «сейчас», и «должно»",
    drift[0] &&
      drift[0].actual[0].includes("30 PASS") &&
      drift[0].expected.includes("34 PASS"),
    JSON.stringify(drift),
  );
  check(
    "файл без маркеров не считается дрейфом",
    collectDrift(summary, [path.join(ROOT, "package.json")]).length === 0,
  );
} finally {
  for (const file of [goodFile, badFile]) fs.rmSync(file, { force: true });
}

// ── 6. Маркеры в живых документах на месте ───────────────────────────────
console.log("\n6. Маркеры в живых документах");
for (const rel of ["README.md", "docs/SESSION_HANDOFF.md"]) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const blocks = text.match(markerPattern()) || [];
  check(`${rel}: есть маркер(ы) tests:auto`, blocks.length > 0, blocks.length);
  check(
    `${rel}: маркеры парные (открытый = закрытый)`,
    (text.match(/<!--\s*tests:auto\s*-->/g) || []).length ===
      (text.match(/<!--\s*\/tests:auto\s*-->/g) || []).length,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
