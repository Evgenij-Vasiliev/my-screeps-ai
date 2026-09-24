"use strict";

/**
 * Одноразовый codemod: убрать хардкод Screeps-токена из tests/*.js
 * и заменить его на resolveToken() из ../screeps.token.
 *
 * Паттерн A: const TOKEN = "<token>";          -> const TOKEN = resolveToken();
 * Паттерн B: process.env.SCREEPS_TOKEN || "<token>" -> resolveToken()
 * Паттерн C: new ScreepsAPI({ token: "<token>" })    -> new ScreepsAPI({ token: resolveToken() })
 *
 * Токен передаётся аргументом и в файле не хранится:
 *   node scripts/scrub-token-codemod.js <token> [--apply]
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const OLD_TOKEN = args[0];
const APPLY = process.argv.includes("--apply");
const TESTS_DIR = path.join(__dirname, "..", "tests");

if (!OLD_TOKEN || OLD_TOKEN.length < 8) {
  throw new Error(
    "Укажите заменяемый токен: node scripts/scrub-token-codemod.js <token> [--apply]"
  );
}

const escaped = OLD_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE_A = new RegExp('const TOKEN = "' + escaped + '"', "g");
const RE_B = new RegExp(
  'process\\.env\\.SCREEPS_TOKEN \\|\\|\\s*\\n?\\s*"' + escaped + '"',
  "g"
);
const RE_C_SPACED = new RegExp('token: "' + escaped + '"', "g");
const RE_C_TIGHT = new RegExp('token:"' + escaped + '"', "g");
const RE_REQUIRE = /^([ \t]*)(?:const|var|let)\s*\{[^}]*ScreepsAPI[^}]*\}\s*=\s*require\((["'])screeps-api\2\);[ \t]*$/m;

/** Ищет конец последнего require(...) в верхней части файла. */
function lastRequireEnd(text) {
  const re = /require\(/g;
  let match;
  let end = -1;
  while ((match = re.exec(text)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === ";") i++;
    end = i;
  }
  return end;
}

/** Вставляет импорт resolveToken после require, сохраняя стиль отступа. */
function insertResolveTokenRequire(text) {
  const apiMatch = text.match(RE_REQUIRE);
  if (apiMatch && apiMatch.index !== undefined) {
    const at = apiMatch.index + apiMatch[0].length;
    const indent = apiMatch[1];
    return (
      text.slice(0, at) +
      "\n" +
      indent +
      'const { resolveToken } = require("../screeps.token");' +
      text.slice(at)
    );
  }

  const at = lastRequireEnd(text);
  if (at === -1) {
    const strict = text.match(/^["']use strict["'];[ \t]*$/m);
    if (strict && strict.index !== undefined) {
      const strictAt = strict.index + strict[0].length;
      return (
        text.slice(0, strictAt) +
        '\nconst { resolveToken } = require("../screeps.token");' +
        text.slice(strictAt)
      );
    }
    return 'const { resolveToken } = require("../screeps.token");\n' + text;
  }
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const anchorLine = text.slice(lineStart, at);
  const indent = (anchorLine.match(/^[ \t]*/) || [""])[0];
  return (
    text.slice(0, at) +
    "\n" +
    indent +
    'const { resolveToken } = require("../screeps.token");' +
    text.slice(at)
  );
}

let changed = 0;
const report = [];

for (const name of fs.readdirSync(TESTS_DIR).sort()) {
  if (!name.endsWith(".js")) continue;
  const file = path.join(TESTS_DIR, name);
  const before = fs.readFileSync(file, "utf8");
  if (!before.includes(OLD_TOKEN)) continue;

  let text = before;
  const hits = { A: 0, B: 0, C: 0 };

  text = text.replace(RE_A, () => {
    hits.A++;
    return "const TOKEN = resolveToken()";
  });
  text = text.replace(RE_B, () => {
    hits.B++;
    return "resolveToken()";
  });
  text = text.replace(RE_C_SPACED, () => {
    hits.C++;
    return "token: resolveToken()";
  });
  text = text.replace(RE_C_TIGHT, () => {
    hits.C++;
    return "token:resolveToken()";
  });

  if (text.includes(OLD_TOKEN)) {
    throw new Error("Не удалось заменить все вхождения в " + name);
  }

  if (/\bresolveToken\s*\(/.test(text) && !/\bconst\s*\{\s*resolveToken\s*\}/.test(text)) {
    text = insertResolveTokenRequire(text);
  }

  // Синтаксическая проверка результата до записи.
  const checkFile = path.join(TESTS_DIR, ".codemod-check.js");
  fs.writeFileSync(checkFile, text);
  try {
    execFileSync(process.execPath, ["--check", checkFile], { stdio: "pipe" });
  } catch (error) {
    throw new Error("Синтаксическая ошибка в " + name + ":\n" + error.stderr);
  } finally {
    fs.unlinkSync(checkFile);
  }

  if (APPLY) fs.writeFileSync(file, text);
  changed++;
  report.push(
    name.padEnd(34) + " A=" + hits.A + " B=" + hits.B + " C=" + hits.C
  );
}

console.log((APPLY ? "Изменено" : "Будет изменено") + " файлов: " + changed);
console.log(report.join("\n"));
