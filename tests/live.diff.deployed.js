"use strict";
/**
 * Что реально лежит на шарде в ветке `test` и чем это отличается от локальных
 * файлов рабочей копии. Нужен перед `npx grunt screeps`: деплой публикует ВСЕ
 * *.js из корня и constants/*.js, в том числе незакоммиченные правки, и полезно
 * видеть, что именно уедет (docs/REMOTE-BORDER-PING-PONG.md, раздел про деплой).
 *
 * Имена модулей на шарде — это путь файла без расширения (constants/market),
 * поэтому сравнение идёт по относительному пути, а не по basename.
 *
 * Только чтение: ни игру, ни файлы не меняем.
 * Запуск: node tests/live.diff.deployed.js
 */

const fs = require("fs");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const BRANCH = process.env.BRANCH || "test";

const api = new ScreepsAPI({ token: TOKEN });
const norm = s => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");

(async () => {
  const code = await api.raw.user.code.get(BRANCH);
  const modules = code.modules || {};

  const same = [];
  const diffs = [];
  const onlyDeployed = [];

  for (const [name, src] of Object.entries(modules)) {
    const file = `${name}.js`;
    if (!fs.existsSync(file)) {
      onlyDeployed.push(file);
      continue;
    }
    const local = fs.readFileSync(file, "utf8");
    if (norm(local) === norm(src)) same.push(file);
    else diffs.push(`${file} (на шарде ${src.length}, локально ${local.length} симв.)`);
  }

  // Локальные модули: корень + constants/ (см. Gruntfile SRC). Имя модуля —
  // путь без .js, поэтому constants/labs.js сравнивается с модулем
  // "constants/labs", а не с "labs".
  const localFiles = [
    ...fs.readdirSync("."),
    ...fs.readdirSync("constants").map(f => `constants/${f}`),
  ].filter(
    f =>
      f.endsWith(".js") && f !== "Gruntfile.js" && f !== "screeps.token.js",
  );
  const onlyLocal = localFiles.filter(f => !(f.slice(0, -3) in modules));

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
