"use strict";
// ===================================================
// SCRIPTS/DEPLOY.MODULES.JS — карта модулей для выгрузки в Screeps
// ===================================================
// Здесь живёт вся логика «что уедет и под каким именем»; Gruntfile только
// регистрирует задачу и вызывает api.code.set(). Модуль намеренно не тянет ни
// grunt, ни screeps-api: его проверяет tests/deploy.modules.test.js — офлайн,
// без токена и без devDependencies.
//
// ПОЧЕМУ НУЖНА ТРАНСЛЯЦИЯ require. require на шарде — НЕ Node.require:
// движок отбрасывает ведущий "./" и ищет модуль по имени ОТ КОРНЯ, без
// разрешения относительно папки вызывающего модуля (Screeps Forum, «Native
// Folder Support»: «the current require implementation ignores leading ./»).
// Отсюда два разных случая:
//
//   1. Корневые файлы. require("./constants/logistics") → движок отбрасывает
//      "./" → ищет "constants/logistics" — ровно то имя, под которым файл
//      выгружен (имя модуля = путь без .js). Работает как есть, не трогаем.
//
//   2. Файлы из подпапки. require("./logistics") из constants/powerSpawn ищет
//      модуль "logistics" (basename!) и падает с "Unknown module 'logistics'",
//      хотя constants/logistics благополучно загружен баррелем: живой стек
//      25.09.2026 — constants/powerSpawn:8:21 ← constants:30:20. То же самое
//      с require("./creeps") в constants/spawn.
//
// Поэтому для файлов из подпапки относительные спецификаторы ПЕРЕВОДЯТСЯ в
// корневые имена ("constants/logistics") ещё на выгрузке: исходники остаются
// обычными для Node (npm test, линтер, переход по ссылке в IDE), а на шард
// уезжает то, что движок действительно понимает.
//
// Комментарии и строковые литералы при переводе НЕ трогаются: строка вида
// "require(\"./x\")" — это данные (например, код для консоли шарда), а не
// вызов require, и переписывать её нельзя.
// ===================================================

const fs = require("fs");
const path = require("path");

/**
 * Шаблоны выгрузки. Поддерживается только форма "<папка>/*.js" (и "*.js" для
 * корня): список раскрывается в listSourceFiles() без glob-движка.
 */
const SRC = ["*.js", "constants/*.js"];

/**
 * Исключения: служебный код деплоя, чтение токена и конфиг линтера на шарде не
 * нужны. Первые два не могут там работать (нужны fs/process), а eslint.config.js
 * до 25.09.2026 уезжал по шаблону "*.js" и тянул require("eslint-config-screeps")
 * / require("globals") — модулей с такими именами на шарде нет и быть не может.
 */
const EXCLUDE = ["Gruntfile.js", "screeps.token.js", "eslint.config.js"];

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const SPACE = /\s/;

/** @param {string|undefined} ch */
function isIdentChar(ch) {
  return typeof ch === "string" && IDENT_CHAR.test(ch);
}

/** @param {string|undefined} ch */
function isSpace(ch) {
  return typeof ch === "string" && SPACE.test(ch);
}

/**
 * Индекс за концом строкового литерала, который начинается в source[i].
 * Обрабатывает экранирование; незакрытый литерал (или перевод строки внутри
 * одиночных/двойных кавычек) завершает сканирование файла, чтобы не уехать
 * в бесконечный цикл на сломанном исходнике.
 *
 * @param {string} source
 * @param {number} i индекс открывающей кавычки
 * @returns {number}
 */
function skipString(source, i) {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    const ch = source[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === quote) return j + 1;
    // В '…' и "…" перевод строки невозможен — считаем литерал незакрытым.
    if (quote !== "`" && (ch === "\n" || ch === "\r")) return j;
    j++;
  }
  return source.length;
}

/**
 * Разбирает вызов require("<литерал>") , начинающийся в source[start].
 * Возвращает null, если это не вызов с одним строковым литералом (динамический
 * require, require от переменной — такие на выгрузке не проверяются).
 *
 * @param {string} source
 * @param {number} start индекс буквы "r" в "require"
 * @returns {{spec: string, start: number, end: number}|null}
 */
function matchRequireCall(source, start) {
  let i = start + "require".length;
  while (isSpace(source[i])) i++;
  if (source[i] !== "(") return null;
  i++;
  while (isSpace(source[i])) i++;

  const quote = source[i];
  if (quote !== '"' && quote !== "'") return null;

  let spec = "";
  let j = i + 1;
  while (j < source.length && source[j] !== quote) {
    if (source[j] === "\\") {
      spec += source[j + 1];
      j += 2;
      continue;
    }
    spec += source[j];
    j++;
  }
  if (source[j] !== quote) return null;
  j++;
  while (isSpace(source[j])) j++;
  if (source[j] !== ")") return null;

  return { spec, start, end: j + 1 };
}

/**
 * Все вызовы require("<литерал>") в КОДЕ модуля, в порядке появления.
 * Комментарии (строчные и блочные) и строковые литералы пропускаются.
 *
 * @param {string} source
 * @returns {{spec: string, start: number, end: number}[]}
 */
function findRequireCalls(source) {
  const calls = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (
      ch === "r" &&
      source.startsWith("require", i) &&
      !isIdentChar(source[i - 1]) &&
      !isIdentChar(source[i + "require".length])
    ) {
      const call = matchRequireCall(source, i);
      if (call) {
        calls.push(call);
        i = call.end;
        continue;
      }
    }
    i++;
  }
  return calls;
}

/**
 * Что ищет движок шарда по спецификатору: он отбрасывает ведущий "./" и больше
 * ничего не делает (никакого разрешения относительно папки модуля).
 *
 * @param {string} spec
 * @returns {string}
 */
function resolveSpecifier(spec) {
  return spec.startsWith("./") ? spec.slice(2) : spec;
}

/**
 * Переводит относительные спецификаторы модуля из подпапки в корневые имена,
 * понятные движку. Корневые модули возвращаются байт-в-байт: для них "./x"
 * движок и так читает как "x", а трогать их текст (в т.ч. комментарии) незачем.
 *
 * @param {string} source
 * @param {string} moduleName имя модуля = путь без .js ("constants/spawn")
 * @returns {string}
 */
function translateModuleSource(source, moduleName) {
  const dir = path.posix.dirname(moduleName);
  if (dir === "." || dir === "") return source;

  const calls = findRequireCalls(source).filter(c => c.spec.startsWith("."));
  if (calls.length === 0) return source;

  // С конца, чтобы не сдвигать индексы ещё не обработанных вызовов.
  let out = source;
  for (let k = calls.length - 1; k >= 0; k--) {
    const { spec, start, end } = calls[k];
    const target = path.posix.join(dir, spec);
    out = `${out.slice(0, start)}require("${target}")${out.slice(end)}`;
  }
  return out;
}

/**
 * @param {string} root корень проекта
 * @returns {string[]} относительные пути .js, попадающих в выгрузку
 */
function listSourceFiles(root) {
  const files = [];
  for (const pattern of SRC) {
    const dir = path.posix.dirname(pattern);
    const prefix = dir === "." ? "" : `${dir}/`;
    const base = prefix === "" ? root : path.join(root, dir);
    for (const name of fs.readdirSync(base).sort()) {
      const rel = `${prefix}${name}`;
      if (!name.endsWith(".js") || EXCLUDE.includes(rel)) continue;
      files.push(rel);
    }
  }
  return files;
}

/**
 * @param {string} root корень проекта
 * @returns {Record<string, string>} имя модуля (путь без .js) → исходник
 */
function collectModules(root) {
  /** @type {Record<string, string>} */
  const modules = {};
  for (const rel of listSourceFiles(root)) {
    modules[rel.replace(/\.js$/, "")] = fs.readFileSync(
      path.join(root, rel),
      "utf8",
    );
  }
  return modules;
}

/**
 * Карта модулей в том виде, в каком она уедет на шард.
 *
 * @param {Record<string, string>} fileMap имя модуля → исходник
 * @returns {Record<string, string>}
 */
function buildModules(fileMap) {
  /** @type {Record<string, string>} */
  const modules = {};
  for (const [name, source] of Object.entries(fileMap)) {
    modules[name] = translateModuleSource(source, name);
  }
  return modules;
}

/**
 * Страховка перед выгрузкой: каждый require("<литерал>") в том, что уедет,
 * обязан указывать на имя, которое среди выгружаемых модулей есть — по
 * правилам движка (см. resolveSpecifier). Ловит ровно тот класс ошибок,
 * который иначе проявляется только на шарде как "Unknown module '…'".
 *
 * Оговорка: динамический require (require(expr)) статически не проверяется —
 * его здесь просто нет.
 *
 * @param {Record<string, string>} modules карта в виде для шарда
 * @returns {{module: string, spec: string, target: string}[]}
 */
function findUnresolvedRequires(modules) {
  const problems = [];
  for (const [name, source] of Object.entries(modules)) {
    for (const { spec } of findRequireCalls(source)) {
      const target = resolveSpecifier(spec);
      if (!Object.prototype.hasOwnProperty.call(modules, target)) {
        problems.push({ module: name, spec, target });
      }
    }
  }
  return problems;
}

module.exports = {
  SRC,
  EXCLUDE,
  listSourceFiles,
  collectModules,
  buildModules,
  translateModuleSource,
  findRequireCalls,
  findUnresolvedRequires,
  resolveSpecifier,
};
