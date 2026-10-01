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
 *   Memory.loadShedBudgetRatio = 0.5  — внутритиковый гейт строже (Шаг 8)
 *   Memory.loadShedBudgetRatio = 100  — внутритиковый гейт выключен
 *
 * ПРИНЦИП БЕЗОПАСНОСТИ ОПЕЧАТКИ: неизвестное или битое значение
 * (в том числе "HARD" в другом регистре, null, число) трактуется как
 * off. Опечатка в консоли не должна глушить Империю — глушение всегда
 * только явное. Это же зафиксировано тестом tests/load.shed.test.js.
 *
 * ВНУТРИТИКОВЫЙ ГЕЙТ (Шаг 8). Кроме уровня по bucket есть вторая,
 * независимая причина понизить нагрузку: счётчик ТЕКУЩЕГО тика. Если
 * `Game.cpu.getUsed()` перевалил за `Game.cpu.limit × 0.8`, необязательная
 * работа (рынок, фабрика, powerSpawn, фоновые генераторы) не начинается до
 * конца тика. Это не экономия, а страховка от пиков: bucket — величина
 * сглаженная и показывает пик с задержкой. Порог настраивается из консоли
 * (Memory.loadShedBudgetRatio), см. блок ниже.
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

/**
 * ── ВНУТРИТИКОВЫЙ ГЕЙТ ПО ОСТАТКУ БЮДЖЕТА (Шаг 8) ─────────────────────
 *
 * Пороги выше реагируют на bucket — величину СГЛАЖЕННУЮ: bucket тратится
 * только при перерасходе и прибавляется на 1 за спокойный тик, поэтому
 * одиночный пик (например, синхронный пересчёт путей несколькими крипами)
 * он показывает с задержкой. Второй, независимый сигнал — счётчик ТЕКУЩЕГО
 * тика, читаемый в самой точке решения:
 *
 *   Game.cpu.getUsed() > Game.cpu.limit * ratio  →  hard до конца тика
 *
 * Счётчик тика монотонен (растёт и не убывает внутри тика), поэтому «до
 * конца тика» выполняется само, без отдельной защёлки: перешагнув порог,
 * все последующие проверки в этом же тике тоже сработают. Движок сбрасывает
 * счётчик на новом тике.
 *
 * Замер shard3 29.09.2026 (25 крипов, 5 комнат, лимит 20, bucket 10000):
 * 2.43–3.68 CPU/тик по интервалам и 3.10–4.31 по окну Memory.cpuStats —
 * то есть при ratio 0.8 (16 CPU) гейт в обычном режиме молчит и включается
 * только тогда, когда тик стал дорогим. Это страховка, а не экономия.
 *
 * ratio настраивается из консоли без выгрузки:
 *   Memory.loadShedBudgetRatio = 0.5   — строже (10 CPU при лимите 20)
 *   Memory.loadShedBudgetRatio = 100   — гейт выключен (порог недостижим)
 *   delete Memory.loadShedBudgetRatio  — вернуть значение ниже
 *
 * ПРАВИЛО ОПЕЧАТКИ: нечисловое, NaN, 0 и отрицательное значение
 * игнорируется и берётся 0.8. Опечатка не должна ни глушить Империю
 * (ratio 0 = «бюджет исчерпан всегда»), ни тихо снимать защиту.
 */
const DEFAULT_BUDGET_RATIO = 0.8;

/** Уровень, который включается при исчерпанном бюджете тика. */
const OVER_BUDGET_LEVEL = LEVEL_INDEX.hard;

/** Считает ли гейт срабатывания (heap-накопитель для консольной пробы). */
function gateStats() {
  const g = global.__loadShedGate;
  if (g) return g;

  global.__loadShedGate = { tick: 0, calls: 0, over: 0, lastUsed: 0 };
  return global.__loadShedGate;
}

/**
 * Порог гейта: доля Game.cpu.limit, после которой необязательная работа
 * не начинается. Читается из Memory каждый раз (как и Memory.loadShed) —
 * чтобы правка из консоли действовала со следующего обращения.
 * @returns {number} конечное число > 0; по умолчанию 0.8
 */
function budgetRatio() {
  const value =
    typeof Memory === "undefined" || Memory === null
      ? undefined
      : Memory.loadShedBudgetRatio;

  if (typeof value === "number" && isFinite(value) && value > 0) return value;

  return DEFAULT_BUDGET_RATIO;
}

/** Game.cpu.limit текущего шарда или null (офлайн-тест, нет поля). */
function limitCPU() {
  if (typeof Game === "undefined" || !Game.cpu) return null;

  const limit = Game.cpu.limit;
  return typeof limit === "number" && isFinite(limit) ? limit : null;
}

/** Израсходовано CPU в текущем тике или null (нет Game или нет getUsed). */
function usedCPU() {
  if (typeof Game === "undefined" || !Game.cpu) return null;

  // Проверка типа, а вызов — только через объект: `const u = Game.cpu.getUsed;
  // u()` даёт Illegal invocation (docs/CPU-BASELINE.md:133-134).
  if (typeof Game.cpu.getUsed !== "function") return null;

  const used = Game.cpu.getUsed();
  return typeof used === "number" && isFinite(used) ? used : null;
}

/**
 * Исчерпан ли бюджет текущего тика.
 * Без Game, без getUsed и без положительного лимита (офлайн-тест, симулятор)
 * — false: отсутствие данных не должно глушить подсистемы.
 * @returns {boolean}
 */
function overBudget() {
  const used = usedCPU();
  const limit = limitCPU();
  const over =
    used !== null && limit !== null && limit > 0 && used > limit * budgetRatio();

  // Наблюдаемость: срабатывание видно ТОЛЬКО изнутри тика — в консоли
  // getUsed() считает саму консольную команду, а не тик бота (консоль и тик —
  // разные бюджеты CPU, docs/PROFILING-ON-DEMAND.md:296-298). Поэтому счётчик
  // ведётся в heap и читается пробой из консоли.
  const tick = typeof Game !== "undefined" && typeof Game.time === "number" ? Game.time : 0;
  const g = gateStats();
  if (g.tick !== tick) {
    g.tick = tick;
    g.calls = 0;
    g.over = 0;
  }
  g.calls++;
  if (used !== null) g.lastUsed = used;
  if (over) g.over++;

  return over;
}

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
 * Итоговый уровень: более строгий из ручного флага, автоматического по bucket
 * и внутритикового по остатку бюджета (Шаг 8).
 * @returns {number} 0..3
 */
function effectiveLevel() {
  // Внутритиковый гейт: бюджет тика исчерпан → hard до конца тика. Счётчик
  // тика монотонен, поэтому «до конца тика» отдельной защёлки не требует.
  const budget = overBudget() ? OVER_BUDGET_LEVEL : OFF;

  return Math.max(level(), bucketLevel(), budget);
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
  const used = usedCPU();
  const limit = limitCPU();
  const over = overBudget();

  return {
    bucket: typeof bucket === "number" ? bucket : null,
    manual: name(),
    manualLevel: level(),
    bucketLevel: bucketLevel(),
    // Внутритиковый гейт (Шаг 8): в консоли used — счётчик самой консольной
    // команды, а не тика бота; состояние гейта внутри тика видно в heap,
    // global.__loadShedGate (calls, over, lastUsed).
    used,
    limit,
    ratio: budgetRatio(),
    overBudget: over,
    gate: typeof global !== "undefined" && global.__loadShedGate
      ? Object.assign({}, global.__loadShedGate)
      : null,
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
  DEFAULT_BUDGET_RATIO,
  level,
  name,
  atLeast,
  thresholds,
  bucketLevel,
  budgetRatio,
  overBudget,
  effectiveLevel,
  effectiveAtLeast,
  debug,
};
