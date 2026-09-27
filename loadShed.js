"use strict";
/**
 * ===================================================
 * LOADSHED.JS — переключатель нагрузки (Load Shedding)
 * ===================================================
 * Назначение: дать боту один дешёвый способ узнать, «насколько сильно»
 * ему разрешено работать в этом тике, и централизованно отключать
 * необязательные подсистемы, когда CPU уходит в перерасход.
 *
 * Уровни (по возрастанию строгости):
 *
 *   off   — 0 — обычный режим, работают все подсистемы
 *   lite  — 1 — отключается необязательная аналитика и «красивости»
 *               (визуализация путей, отчёты вне интервала)
 *   hard  — 2 — отключаются второстепенные подсистемы
 *               (рынок, межкомнатная логистика, ремонт, апгрейд)
 *   max   — 3 — работает только критичный минимум
 *               (спавн, добыча, заполнение spawn/extension, оборона)
 *
 * Управление через консоль шарда:
 *   Memory.loadShed = "hard"   — включить уровень hard
 *   Memory.loadShed = true     — то же, что "lite" (булево «включить»)
 *   delete Memory.loadShed     — вернуться в off
 *
 * ПРИНЦИП БЕЗОПАСНОСТИ ОПЕЧАТКИ: неизвестное или битое значение
 * (в том числе "HARD" в другом регистре, null, число) трактуется как
 * off. Опечатка в консоли не должна глушить Империю — глушение всегда
 * только явное. Это же зафиксировано тестом tests/load.shed.test.js.
 *
 * Модуль намеренно НЕ обращается к Game: он проверяется офлайн в Node,
 * где Game не существует. Чтение Memory — одно обращение к свойству,
 * результат не кэшируется, чтобы переключение из консоли действовало
 * со следующего обращения, а не со следующего рестарта.
 * ===================================================
 */

/** Имена уровней в порядке возрастания строгости. Индекс = числовой уровень. */
const LEVELS = ["off", "lite", "hard", "max"];

/** Индекс уровня по имени. Собран из LEVELS — единственного источника правды. */
const LEVEL_INDEX = {};
for (let i = 0; i < LEVELS.length; i++) {
  LEVEL_INDEX[LEVELS[i]] = i;
}

/** Числовой уровень для значения из Memory.loadShed. */
const BOOL_TRUE_LEVEL = LEVEL_INDEX.lite;

const OFF = LEVEL_INDEX.off;

/**
 * Безопасно читает Memory.loadShed.
 * Memory может отсутствовать (офлайн-тест) или быть не объектом.
 * @returns {*}
 */
function readFlag() {
  if (typeof Memory === "undefined" || Memory === null) return undefined;
  return Memory.loadShed;
}

/**
 * Текущий уровень нагрузки.
 * @returns {number} 0..3; 0 (off) для отсутствующего, битого или неизвестного значения
 */
function level() {
  const flag = readFlag();

  // Булево «включить» — это lite, а не максимальный уровень:
  // неожиданно включённый loadShed не должен глушить Империю до минимума.
  if (flag === true) return BOOL_TRUE_LEVEL;

  if (typeof flag === "string") {
    const index = LEVEL_INDEX[flag];
    // hasOwnProperty обязателен: LEVEL_INDEX["constructor"] и подобные
    // унаследованные свойства иначе вернули бы функцию вместо числа.
    if (typeof index === "number" && Object.prototype.hasOwnProperty.call(LEVEL_INDEX, flag)) {
      return index;
    }
  }

  return OFF;
}

/**
 * Имя текущего уровня.
 * @returns {string} "off" | "lite" | "hard" | "max"
 */
function name() {
  return LEVELS[level()];
}

/**
 * Достигнут ли указанный уровень нагрузки.
 * Неизвестное имя уровня — false (а не исключение): вызывающий код
 * не должен падать из-за опечатки, а подсистемы не должны глушиться.
 *
 * @param {string} requiredLevel имя уровня: "off" | "lite" | "hard" | "max"
 * @returns {boolean}
 */
function atLeast(requiredLevel) {
  if (typeof requiredLevel !== "string") return false;

  const required = LEVEL_INDEX[requiredLevel];
  if (
    typeof required !== "number" ||
    !Object.prototype.hasOwnProperty.call(LEVEL_INDEX, requiredLevel)
  ) {
    return false;
  }

  return level() >= required;
}

/**
 * ── АВТОМАТИЧЕСКИЕ ПОРОГИ ПО БАКЕТУ ────────────────────────────────────
 *
 * Кроме ручного флага Memory.loadShed есть автоматический режим: уровень
 * определяется запасом CPU (Game.cpu.bucket). Чем ниже бакет, тем строже
 * режим. Пороги НАСТРАИВАЮТСЯ через Memory.loadShedThresholds — менять
 * можно из консоли игры, без перевыгрузки кода:
 *
 *   Memory.loadShedThresholds = { lite: 9000, hard: 7000, max: 5000 }
 *   Memory.loadShedThresholds.hard = 8500      — поменять один порог
 *   delete Memory.loadShedThresholds           — вернуть значения ниже
 *
 * Смысл порогов: бакет — это запас прочности (максимум 10 000, +1 за тик,
 * когда расход ниже лимита). Перерасход тратит бакет; когда он станет
 * нулём, игра остановит бота. Пороги вступают в действие ЗАДОЛГО до нуля,
 * чтобы бот успел сбросить необязательное и не встал.
 *
 * ПРАВИЛО ПОРЯДКА: действует САМЫЙ СТРОГИЙ подходящий уровень. Если
 * пороги перепутаны (например lite ниже hard), бот не начнёт «мигать» —
 * он возьмёт строгий уровень. Испорченное значение порога игнорируется
 * и берётся значение по умолчанию: опечатка не должна глушить Империю.
 */
const DEFAULT_THRESHOLDS = {
  // Ниже 9000 — сбрасываем ФОНОВОЕ: апгрейд, стройка, ремонт.
  // Отступ 1000 от верха — чтобы не «дёргаться» на каждом колебании.
  lite: 9000,
  // Ниже 7000 — сбрасываем ВТОРОСТЕПЕННОЕ: терминал, фабрика, рынок.
  hard: 7000,
  // Ниже 5000 — только критичный минимум: спавн, добыча, заливка, линки.
  max: 5000,
};

/** Читает Memory.loadShedThresholds, не падая при отсутствии Memory. */
function readThresholds() {
  if (typeof Memory === "undefined" || Memory === null) return null;
  const t = Memory.loadShedThresholds;
  return t && typeof t === "object" ? t : null;
}

/**
 * Пороги с учётом переопределений из Memory.
 * @returns {{lite: number, hard: number, max: number}}
 */
function thresholds() {
  const custom = readThresholds();
  const out = {
    lite: DEFAULT_THRESHOLDS.lite,
    hard: DEFAULT_THRESHOLDS.hard,
    max: DEFAULT_THRESHOLDS.max,
  };

  if (!custom) return out;

  for (const key in out) {
    const value = custom[key];
    // Только конечное число: строка, NaN, null и мусор игнорируются.
    if (typeof value === "number" && isFinite(value)) {
      out[key] = value;
    }
  }

  return out;
}

/**
 * Уровень по запасу CPU. Без Game (офлайн-тест) — off.
 * @returns {number} 0..3
 */
function bucketLevel() {
  const bucket =
    typeof Game !== "undefined" && Game.cpu ? Game.cpu.bucket : undefined;

  if (typeof bucket !== "number" || !isFinite(bucket)) return OFF;

  const t = thresholds();
  let result = OFF;

  // Строгий уровень побеждает: см. «ПРАВИЛО ПОРЯДКА» выше.
  if (bucket < t.lite) result = LEVEL_INDEX.lite;
  if (bucket < t.hard) result = LEVEL_INDEX.hard;
  if (bucket < t.max) result = LEVEL_INDEX.max;

  return result;
}

/**
 * Итоговый уровень: более строгий из ручного флага и автоматического.
 * @returns {number} 0..3
 */
function effectiveLevel() {
  return Math.max(level(), bucketLevel());
}

/**
 * Достигнут ли уровень с учётом автоматики.
 * @param {string} requiredLevel
 * @returns {boolean}
 */
function effectiveAtLeast(requiredLevel) {
  if (typeof requiredLevel !== "string") return false;

  const required = LEVEL_INDEX[requiredLevel];
  if (
    typeof required !== "number" ||
    !Object.prototype.hasOwnProperty.call(LEVEL_INDEX, requiredLevel)
  ) {
    return false;
  }

  return effectiveLevel() >= required;
}

/** Отладочный срез: почему выбран именно этот уровень. */
function debug() {
  const t = thresholds();
  const bucket =
    typeof Game !== "undefined" && Game.cpu ? Game.cpu.bucket : undefined;

  return {
    bucket: typeof bucket === "number" ? bucket : null,
    manual: name(),
    manualLevel: level(),
    bucketLevel: bucketLevel(),
    effective: LEVELS[effectiveLevel()],
    thresholds: t,
    defaults: {
      lite: DEFAULT_THRESHOLDS.lite,
      hard: DEFAULT_THRESHOLDS.hard,
      max: DEFAULT_THRESHOLDS.max,
    },
  };
}

module.exports = {
  LEVELS,
  DEFAULT_THRESHOLDS,
  level,
  name,
  atLeast,
  thresholds,
  bucketLevel,
  effectiveLevel,
  effectiveAtLeast,
  debug,
};
