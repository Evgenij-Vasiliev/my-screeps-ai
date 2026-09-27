"use strict";

/**
 * Единая точка получения Screeps-токена для Gruntfile, скриптов и live-тестов.
 *
 * Приоритет источников:
 *   1. process.env.SCREEPS_TOKEN (или legacy-переменная SCREEPS_AUTH_TOKEN)
 *   2. .screeps.json в корне проекта (файл в .gitignore, в репозиторий не попадает)
 *
 * В самом коде токен не хранится. Файл лежит вне каталога деплоя,
 * чтобы grunt-screeps не выгружал его на сервер.
 *
 * Отдельно отслеживается источник: библиотека screeps-api при `token: null`
 * сама подхватывает ~/.screeps.json, и это может оказаться скомпрометированный
 * токен. resolveTokenSource() позволяет такие случаи обнаружить.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ENV_KEYS = ["SCREEPS_TOKEN", "SCREEPS_AUTH_TOKEN"];
const PROJECT_FILE = path.join(__dirname, ".screeps.json");

function readTokenFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Не удалось разобрать " + file + ": " + error.message);
  }

  for (const key of ["token", "SCREEPS_TOKEN", "authToken"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

/**
 * Возвращает { token, source } или { token: null, source: null }.
 * source: "env" | "project-file" | "home-file" | null
 * @returns {{token: string|null, source: string|null}}
 */
function resolveTokenSource() {
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
      return { token: value.trim(), source: "env" };
    }
  }

  const fromProject = readTokenFile(PROJECT_FILE);
  if (fromProject) return { token: fromProject, source: "project-file" };

  const homeFile = path.join(os.homedir(), ".screeps.json");
  const fromHome = readTokenFile(homeFile);
  if (fromHome) {
    process.stderr.write(
      "[screeps.token] ВНИМАНИЕ: токен взят из " + homeFile + ". " +
        "Это резервный источник и потенциальная утечка вне репозитория. " +
        "Перенесите токен в SCREEPS_TOKEN или в .screeps.json корня проекта.\n"
    );
    return { token: fromHome, source: "home-file" };
  }

  return { token: null, source: null };
}

/**
 * Возвращает токен или null, если он нигде не задан.
 * @returns {string|null}
 */
function resolveToken() {
  return resolveTokenSource().token;
}

/**
 * Возвращает токен, бросая понятную ошибку, если его нет.
 * @returns {string}
 */
function requireToken() {
  const { token } = resolveTokenSource();
  if (!token) {
    throw new Error(
      "Screeps-токен не задан. Укажите SCREEPS_TOKEN в окружении " +
        "или создайте .screeps.json с полем \"token\" в корне проекта."
    );
  }
  return token;
}

module.exports = { resolveToken, resolveTokenSource, requireToken };
