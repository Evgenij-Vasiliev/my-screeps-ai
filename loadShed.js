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

module.exports = {
  LEVELS,
  level,
  name,
  atLeast,
};
