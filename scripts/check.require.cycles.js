"use strict";
/**
 * ===================================================
 * SCRIPTS/CHECK.REQUIRE.CYCLES.JS — проверка графа require на циклы
 * ===================================================
 * Зачем: 29.09.2026 код с циклическим require уехал на шард и уронил
 * загрузку модулей:
 *
 *   Error: Circular reference to module 'room.manager'
 *       at Object.requireFn (<runtime>:21121:19)
 *       at task.generators:7:34
 *       ...
 *       at room.manager:14:24
 *
 * Gruntfile проверяет только РАЗРЕШИМОСТЬ литеральных require
 * (Gruntfile.js, шаг «проверка require») — цикл он пропускает. Движок
 * Screeps, в отличие от Node, циклический require не разрешает: он бросает
 * ошибку на этапе загрузки, то есть бот не работает вовсе.
 *
 * Что делает скрипт: строит граф модулей, которые уезжают на шард (список
 * берётся у самого деплоя, listSourceFiles из scripts/deploy.modules.js:
 * корневые *.js, constants/*.js, room/*.js и task/*.js), и ищет в нём циклы.
 * Только чтение файлов, никаких изменений и вызовов API.
 *
 * Почему список берётся у деплоя, а не повторяется здесь: файл из подпапки
 * уезжает под именем с путём ("constants/spawn"), и цикл ВНУТРИ constants/*
 * виден в графе только тогда, когда эти файлы в графе есть. Пока здесь был
 * readdirSync корня, такой цикл уезжал на шард незамеченным — а движок
 * циклический require не разрешает и роняет загрузку всех модулей.
 *
 * Запуск:
 *   node scripts/check.require.cycles.js        # 0 — циклов нет, 1 — есть
 * ===================================================
 */

const fs = require("fs");
const path = require("path");

const { listSourceFiles } = require("./deploy.modules");

const ROOT = path.join(__dirname, "..");

/** Разбор литеральных require("...") и require('...'). */
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Убирает комментарии перед разбором require.
 *
 * Без этого проверка ловит ложный цикл на самом себе: в файле достаточно
 * упомянуть require в комментарии (например, «room.manager сам подключает
 * require("./task.generators")»), и граф получает ребро, которого в коде нет.
 * Именно на этом скрипт и попался при первом запуске:
 * «НАЙДЕНЫ ЦИКЛЫ: task.generators -> task.generators».
 *
 * Блочные комментарии снимаются до строчных; содержимое строк при этом не
 * разбирается (в проекте нет require внутри строковых литералов).
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Тот же путь, что Gruntfile даёт модулю: имя без .js, слеши сохраняются.
 * @param {string} file абсолютный путь
 */
function moduleName(file) {
  return path.relative(ROOT, file).replace(/\.js$/, "").split(path.sep).join("/");
}

/**
 * Разрешает запрошенный модуль в файл на диске — как это делает движок
 * (и как проверяет Gruntfile): сначала относительно файла, затем от корня.
 * @param {string} request
 * @param {string} fromFile
 * @returns {string|null} абсолютный путь или null
 */
function resolveRequest(request, fromFile) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const fromRoot = path.join(ROOT, request + ".js");
    return fs.existsSync(fromRoot) ? fromRoot : null;
  }
  const fromDir = path.resolve(path.dirname(fromFile), request);
  if (fs.existsSync(fromDir) && fs.statSync(fromDir).isFile()) return fromDir;
  const withJs = fromDir + ".js";
  return fs.existsSync(withJs) ? withJs : null;
}

/**
 * Файлы ровно в том составе, в каком они уедут на шард: SRC деплоя
 * (корень, constants/*, room/*) минус EXCLUDE. Список берётся у самого
 * деплоя, чтобы проверка циклов и выгрузка не разошлись.
 */
function listModules() {
  return listSourceFiles(ROOT).map(rel => path.join(ROOT, rel));
}

/** Строит граф: file -> [files]. */
function buildGraph(files) {
  const graph = new Map();

  for (const file of files) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const deps = [];
    let m;
    REQUIRE_RE.lastIndex = 0;
    while ((m = REQUIRE_RE.exec(src)) !== null) {
      const target = resolveRequest(m[1], file);
      if (target) deps.push(target);
    }
    graph.set(file, deps);
  }

  return graph;
}

/**
 * Ищет циклы обходом в глубину, возвращает список путей вида
 * ["a.js", "b.js", "a.js"].
 */
function findCycles(graph) {
  const cycles = [];
  const state = new Map(); // file -> 1 (в стеке) | 2 (завершён)
  const stack = [];

  function visit(file) {
    state.set(file, 1);
    stack.push(file);

    for (const dep of graph.get(file) || []) {
      if (state.get(dep) === 1) {
        // Нашли цикл: вырезаем его хвост из стека.
        const at = stack.indexOf(dep);
        cycles.push(stack.slice(at).concat(dep));
        continue;
      }
      if (state.get(dep) === undefined) visit(dep);
    }

    stack.pop();
    state.set(file, 2);
  }

  for (const file of graph.keys()) {
    if (state.get(file) === undefined) visit(file);
  }

  return cycles;
}

const files = listModules();
const graph = buildGraph(files);
const cycles = findCycles(graph);

const inFolders = files.filter(f => moduleName(f).includes("/")).length;
console.log(
  `Модулей уезжает: ${files.length} (в подпапках: ${inFolders}), рёбер require: ${[...graph.values()].reduce(
    (a, d) => a + d.length,
    0,
  )}`,
);

if (cycles.length === 0) {
  console.log("Циклов require нет: движок Screeps загрузит модули.");
  console.log("Порядок загрузки начинается с main.js: " + moduleName(path.join(ROOT, "main.js")));
  process.exit(0);
}

console.log(`\nНАЙДЕНЫ ЦИКЛЫ (${cycles.length}) — движок упадёт с "Circular reference":`);
for (const cycle of cycles) {
  console.log("  " + cycle.map(moduleName).join(" -> "));
}
process.exit(1);
