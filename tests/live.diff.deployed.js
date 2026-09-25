"use strict";
/**
 * Что реально лежит на шарде в ветке `test` и чем это отличается от того, что
 * уедет из рабочей копии. Нужен перед `npx grunt screeps`: деплой публикует
 * ВСЕ *.js из корня и constants/*.js, в том числе незакоммиченные правки, и
 * полезно видеть, что именно уедет.
 *
 * Сравнивается не сырой локальный файл, а результат сборки выгрузки
 * (scripts/deploy.modules.js): она переводит относительные require файлов из
 * constants/* в корневые имена, потому что require на шарде НЕ разрешает
 * относительные пути (см. шапку модуля). Без этого constants/spawn.js и
 * constants/powerSpawn.js всегда висели бы в «отличаются от шарда».
 *
 * Имена модулей на шарде — это путь файла без расширения (constants/market),
 * поэтому сравнение идёт по относительному пути, а не по basename.
 *
 * Только чтение: ни игру, ни файлы не меняем.
 * Запуск: node tests/live.diff.deployed.js
 */

const path = require("path");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const { collectModules, buildModules } = require("../scripts/deploy.modules");

const TOKEN = resolveToken();
const BRANCH = process.env.BRANCH || "test";
const ROOT = path.join(__dirname, "..");

const api = new ScreepsAPI({ token: TOKEN });
const norm = s => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");

(async () => {
  const code = await api.raw.user.code.get(BRANCH);
  const modules = code.modules || {};

  const local = buildModules(collectModules(ROOT));

  const same = [];
  const diffs = [];
  const onlyDeployed = [];

  for (const [name, src] of Object.entries(modules)) {
    if (!(name in local)) {
      onlyDeployed.push(`${name}.js`);
      continue;
    }
    if (norm(local[name]) === norm(src)) same.push(`${name}.js`);
    else
      diffs.push(
        `${name}.js (на шарде ${src.length}, уедет ${local[name].length} симв.)`,
      );
  }

  const onlyLocal = Object.keys(local)
    .filter(name => !(name in modules))
    .map(name => `${name}.js`);

  console.log(`Ветка ${BRANCH}: модулей ${Object.keys(modules).length}`);
  console.log(`\nОТЛИЧАЮТСЯ от шарда (уедут при деплое):\n  ${diffs.join("\n  ") || "нет"}`);
  console.log(`\nЕсть локально, нет на шарде:\n  ${onlyLocal.join(", ") || "нет"}`);
  console.log(`\nЕсть на шарде, нет локально:\n  ${onlyDeployed.join(", ") || "нет"}`);
  console.log(`\nСовпадают: ${same.length} файлов`);
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exitCode = 1;
});
