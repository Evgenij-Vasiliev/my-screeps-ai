#!/usr/bin/env node
"use strict";
/**
 * ===================================================
 * INSTALL-HOOKS.JS — подключение .githooks/ к git
 * ===================================================
 * Прописывает `core.hooksPath=.githooks`, чтобы версионируемые хуки
 * из репозитория (pre-commit, pre-push) реально запускались. Без этого
 * git смотрит в `.git/hooks/` — каталог, который не коммитится и у
 * каждого клона свой, поэтому гейты качества держались бы на памяти.
 *
 * Запуск:
 *   npm install                 # автоматически, через "prepare" (--strict не нужен)
 *   npm run hooks:install       # вручную, строгий режим: ошибка = код 1
 *
 * Скрипт идемпотентен: повторный вызов ничего не ломает и лишь
 * выставляет права на файлы хуков. Токен и сеть не нужны.
 *
 * Проверить, что хуки подключены:
 *   git config --get core.hooksPath   # => .githooks
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HOOKS_DIR = ".githooks";
const HOOK_FILES = ["pre-commit", "pre-push"];
/** `npm run hooks:install` падает с кодом 1, `prepare` — только предупреждает. */
const STRICT = process.argv.includes("--strict");

/** @type {import("child_process").ExecFileSyncOptionsWithStringEncoding} */
const GIT_OPTS = { cwd: ROOT, encoding: "utf8" };

/**
 * @param {string[]} args
 * @returns {string} stdout команды git без завершающего перевода строки
 */
function git(args) {
  return execFileSync("git", args, GIT_OPTS).trim();
}

function install() {
  try {
    git(["rev-parse", "--git-dir"]);
  } catch {
    console.warn("[hooks] каталог не является git-репозиторием — хуки не установлены");
    return;
  }

  /** @type {string} */
  let current = "";
  try {
    current = git(["config", "--local", "--get", "core.hooksPath"]);
  } catch {
    current = ""; // ключ не задан — это норма
  }

  if (current && current !== HOOKS_DIR) {
    console.warn(`[hooks] core.hooksPath был "${current}" — переключаю на "${HOOKS_DIR}"`);
  }

  if (current !== HOOKS_DIR) {
    git(["config", "--local", "core.hooksPath", HOOKS_DIR]);
  }

  let ready = 0;
  for (const file of HOOK_FILES) {
    const abs = path.join(ROOT, HOOKS_DIR, file);
    if (!fs.existsSync(abs)) {
      console.warn(`[hooks] ${HOOKS_DIR}/${file} не найден в репозитории — пропускаю`);
      continue;
    }
    fs.chmodSync(abs, 0o755);
    ready += 1;
  }

  console.log(`[hooks] core.hooksPath=${HOOKS_DIR}, исполняемых хуков: ${ready}/${HOOK_FILES.length}`);
  console.log("[hooks] pre-commit = npm run check, pre-push = npm run ci; обход: --no-verify");
}

try {
  install();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (STRICT) {
    console.error(`[hooks] не удалось установить хуки: ${message}`);
    process.exit(1);
  }
  // prepare не должен ронять `npm install` из-за прав на .git: предупреждаем,
  // но установку зависимостей не срываем.
  console.warn(`[hooks] хуки не установлены: ${message}`);
  console.warn("[hooks] повторите вручную: npm run hooks:install");
}
