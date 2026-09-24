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
 */

const fs = require("fs");
const path = require("path");

const ENV_KEYS = ["SCREEPS_TOKEN", "SCREEPS_AUTH_TOKEN"];

function fromEnv() {
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

function fromScreepsJson() {
  const file = path.join(__dirname, ".screeps.json");
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
    throw new Error(
      "Не удалось разобрать " + file + ": " + error.message
    );
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
 * Возвращает токен или null, если он нигде не задан.
 * @returns {string|null}
 */
function resolveToken() {
  return fromEnv() || fromScreepsJson();
}

/**
 * Возвращает токен, бросая понятную ошибку, если его нет.
 * @returns {string}
 */
function requireToken() {
  const token = resolveToken();
  if (!token) {
    throw new Error(
      "Screeps-токен не задан. Укажите SCREEPS_TOKEN в окружении " +
        "или создайте .screeps.json с полем \"token\" в корне проекта."
    );
  }
  return token;
}

module.exports = { resolveToken, requireToken };
