"use strict";
/**
 * ===================================================
 * DEPLOY.MODULES.TEST.JS — контракт выгрузки модулей в шард
 * ===================================================
 * Живое падение 25.09.2026:
 *   Error: Unknown module 'logistics'
 *       at constants/powerSpawn:8:21
 *       at constants:30:20
 * Причина не в коде бота, а в том, что require на шарде — НЕ Node.require:
 * движок отбрасывает ведущий "./" и ищет имя ОТ КОРНЯ, без разрешения
 * относительно папки вызывающего модуля. Поэтому require("./logistics") из
 * constants/powerSpawn искал модуль "logistics" вместо "constants/logistics".
 * Node такие require разрешает (потому npm test был зелёным), а шард — нет;
 * тот же дефект был и в constants/spawn:10 (require("./creeps")).
 *
 * Здесь проверяется, что scripts/deploy.modules.js переводит относительные
 * спецификаторы файлов из подпапок в корневые имена, и главное — что ГРАФ
 * МОДУЛЕЙ В ВИДЕ ДЛЯ ШАРДА ЗАМКНУТ: каждый require("<литерал>") указывает на
 * выгружаемое имя. Это ловит класс ошибок «у Node работает, у шарда нет».
 *
 * Запуск: node tests/deploy.modules.test.js
 */

const path = require("path");
const {
  listSourceFiles,
  collectModules,
  buildModules,
  translateModuleSource,
  findRequireCalls,
  findUnresolvedRequires,
  resolveSpecifier,
} = require("../scripts/deploy.modules");

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

// ── 1. Что именно ищет движок шарда ──────────────────────────────────────
console.log("\n1. Семантика require на шарде (движок отбрасывает ведущий \"./\")");
check('resolveSpecifier("./logistics") → "logistics"', resolveSpecifier("./logistics") === "logistics");
check(
  'resolveSpecifier("constants/logistics") не меняется',
  resolveSpecifier("constants/logistics") === "constants/logistics",
);
check(
  'resolveSpecifier("./constants/market") → "constants/market"',
  resolveSpecifier("./constants/market") === "constants/market",
);

// ── 2. Перевод спецификаторов файлов из подпапок ─────────────────────────
console.log("\n2. Перевод относительных require в корневые имена");
check(
  "сосед по папке: constants/spawn + ./creeps → constants/creeps",
  translateModuleSource('const x = require("./creeps");', "constants/spawn") ===
    'const x = require("constants/creeps");',
);
check(
  "вверх на уровень: constants/x + ../y → y",
  translateModuleSource('require("../y");', "constants/x") === 'require("y");',
);
check(
  "вверх на два уровня: constants/sub/x + ../../y → y",
  translateModuleSource('require("../../y");', "constants/sub/x") === 'require("y");',
);
check(
  "вверх на уровень внутри папки: constants/sub/x + ../y → constants/y",
  translateModuleSource('require("../y");', "constants/sub/x") ===
    'require("constants/y");',
);
check(
  "корневой файл не меняется (движок и так читает ./x как x)",
  translateModuleSource('const x = require("./constants");', "main") ===
    'const x = require("./constants");',
);
check(
  "абсолютный спецификатор не переписывается",
  translateModuleSource('require("constants/creeps");', "constants/spawn") ===
    'require("constants/creeps");',
);
check(
  "несколько require в одном файле переводятся все",
  translateModuleSource(
    'const a = require("./creeps");\nconst b = require("./logistics");',
    "constants/spawn",
  ) ===
    'const a = require("constants/creeps");\nconst b = require("constants/logistics");',
);

// Комментарии и строки — это не вызовы require: их переписывать нельзя.
const COMMENT_AND_STRING = [
  '// require("./creeps") — так писать нельзя, но это комментарий',
  '/* require("./logistics") */',
  'const code = "require(\\"./creeps\\")";', // код для консоли шарда — данные
  'const other = \'require("./logistics")\';',
].join("\n");
check(
  "комментарии и строковые литералы не переписываются",
  translateModuleSource(COMMENT_AND_STRING, "constants/spawn") ===
    COMMENT_AND_STRING,
);
check(
  "findRequireCalls не видит ни одного вызова в комментариях и строках",
  findRequireCalls(COMMENT_AND_STRING).length === 0,
  JSON.stringify(findRequireCalls(COMMENT_AND_STRING)),
);
check(
  "динамический require не считается литералом",
  findRequireCalls("const m = require(name);").length === 0,
);
check(
  "require в коде находится вместе со спецификатором",
  JSON.stringify(findRequireCalls('x = require("./a"); y = require("b");').map(c => c.spec)) ===
    JSON.stringify(["./a", "b"]),
  JSON.stringify(findRequireCalls('x = require("./a"); y = require("b");').map(c => c.spec)),
);

// ── 3. Состав выгрузки ───────────────────────────────────────────────────
console.log("\n3. Состав выгрузки: корень + constants/*");
const files = listSourceFiles(ROOT);
check("main.js в выгрузке", files.includes("main.js"));
check("constants.js (barrel) в выгрузке", files.includes("constants.js"));
check("constants/powerSpawn.js в выгрузке", files.includes("constants/powerSpawn.js"));
check(
  "служебные файлы не выгружаются",
  !files.includes("Gruntfile.js") &&
    !files.includes("screeps.token.js") &&
    !files.includes("eslint.config.js"),
  files.filter(f => !f.includes("/")).join(","),
);
check(
  "из подпапки выгружаются только constants/*.js",
  files.every(f => !f.includes("/") || f.startsWith("constants/")),
);

// ── 4. ГЛАВНОЕ: граф модулей для шарда замкнут ───────────────────────────
console.log("\n4. Граф модулей в виде для шарда замкнут");
const raw = collectModules(ROOT);
const built = buildModules(raw);

const rawProblems = findUnresolvedRequires(raw);
check(
  "страховка видит исходный дефект: constants/powerSpawn → \"logistics\"",
  rawProblems.some(p => p.module === "constants/powerSpawn" && p.target === "logistics"),
  JSON.stringify(rawProblems),
);
check(
  "страховка видит второй дефект: constants/spawn → \"creeps\"",
  rawProblems.some(p => p.module === "constants/spawn" && p.target === "creeps"),
  JSON.stringify(rawProblems),
);

const builtProblems = findUnresolvedRequires(built);
check(
  "после перевода неразрешённых require нет (это и был баг)",
  builtProblems.length === 0,
  JSON.stringify(builtProblems),
);

// ── 5. Перевод не подменяет и не теряет модули ───────────────────────────
console.log("\n5. Перевод не меняет состав модулей");
check(
  "набор имён модулей тот же",
  JSON.stringify(Object.keys(raw).sort()) === JSON.stringify(Object.keys(built).sort()),
);
check(
  "корневые модули уезжают байт-в-байт",
  Object.keys(raw)
    .filter(name => !name.includes("/"))
    .every(name => raw[name] === built[name]),
);
check(
  "имя модуля из подпапки = путь файла без .js",
  Object.keys(built).every(name => files.includes(`${name}.js`)),
);
check(
  "constants/powerSpawn уезжает с корневым require",
  built["constants/powerSpawn"].includes('require("constants/logistics")') &&
    !built["constants/powerSpawn"].includes('require("./logistics")'),
);
check(
  "constants/spawn уезжает с корневым require",
  built["constants/spawn"].includes('require("constants/creeps")') &&
    !built["constants/spawn"].includes('require("./creeps")'),
);
check(
  "barrel и доменные модули указывают на один экземпляр по одному имени",
  built["constants"].includes('require("./constants/logistics")') &&
    built["constants/powerSpawn"].includes('require("constants/logistics")'),
);

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
