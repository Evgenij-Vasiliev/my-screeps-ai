/**
 * contract.consistency.js
 *
 * Аудит согласованности контрактов между собой.
 * Источник: CONTRACT_IMPLEMENTATION_ROADMAP V1.0.
 *
 * НАЗНАЧЕНИЕ:
 *   Проверяет, что контракты не противоречат друг другу.
 *   Выявляет рассинхрон: подсистема есть в одном контракте, но отсутствует в другом.
 *
 * ЖЁСТКИЕ ГАРАНТИИ:
 *   - НЕ изменяет данные
 *   - НЕ выполняет recovery
 *   - НЕ зависит от игровых объектов
 *   - Работает ТОЛЬКО с CONTRACT_REGISTRY
 *
 * ПРОВЕРЯЕМЫЕ УСЛОВИЯ (ТЗ №23, обновлено в ТЗ №24):
 *   1. Каждая запись policy имеет соответствующую запись в responsibility
 *      (исключение: подсистемы-заглушки будущих этапов, перечислены в POLICY_EXCEPTIONS)
 *   2. Каждая запись responsibility имеет соответствующего Director в contract.director
 *   3. Каждый Director из responsibility имеет ownerScope
 *   4. Каждый ownerScope присутствует среди путей ownership
 *
 * ИЗМЕНЕНИЕ ТЗ №24:
 *   Условие 1 инвертировано: было responsibility → policy, стало policy → responsibility.
 *   Причина: не каждая подсистема обязана управляться политикой.
 *   DiagnosticsDirector и ConsoleDirector — инфраструктурные подсистемы без политики.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const registry = require('contract.registry');
 *   const report   = registry.consistency.run(registry);
 *   console.log(JSON.stringify(report, null, 2));
 */

"use strict";

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// =============================================================================
// УСЛОВИЕ 1: policy → responsibility
// Каждая запись policy имеет соответствующую запись в responsibility.
// Исключение: подсистемы будущих этапов, перечисленные в POLICY_EXCEPTIONS.
// =============================================================================

/**
 * Подсистемы, допускающие отсутствие записи в responsibility.
 * На текущем этапе: expansion (будущая подсистема, ещё не реализована).
 */
const POLICY_EXCEPTIONS = new Set(["expansion"]);

/**
 * Инвертированная проверка: policy → responsibility.
 * Проверяет, что каждая политика имеет подсистему-исполнителя в responsibility.
 * Исключения из POLICY_EXCEPTIONS пропускаются как WARNING, а не ERROR.
 *
 * Логика:
 *   - Если политика есть в responsibility → OK.
 *   - Если политика в POLICY_EXCEPTIONS → WARNING (будущая подсистема).
 *   - Иначе → ERROR (политика без подсистемы-исполнителя).
 *
 * @param {object}   policy
 * @param {object}   responsibility
 * @param {string[]} problems
 * @param {string[]} warnings
 * @param {string[]} recommendations
 */
function checkPolicyVsResponsibility(
  policy,
  responsibility,
  problems,
  warnings,
  recommendations,
) {
  for (const key of Object.keys(policy)) {
    // Пропускаем служебное поле POLICY_STATES (не является записью политики)
    if (key === "POLICY_STATES") continue;

    if (key in responsibility) continue; // OK: политика покрыта подсистемой

    if (POLICY_EXCEPTIONS.has(key)) {
      // Будущая подсистема — предупреждение, не ошибка
      warnings.push(
        `[consistency] Политика "${key}" не имеет записи в responsibility (ожидаемая будущая подсистема).`,
      );
      recommendations.push(
        `Добавьте запись "${key}" в contract.responsibility.js при реализации подсистемы.`,
      );
    } else {
      // Неизвестная политика без подсистемы — ошибка
      problems.push(
        `[consistency] Политика "${key}" существует в policy, но не имеет записи в responsibility.`,
      );
      recommendations.push(
        `Добавьте запись "${key}" в contract.responsibility.js или удалите политику.`,
      );
    }
  }
}

// =============================================================================
// УСЛОВИЕ 2: responsibility → director
// Каждая запись responsibility имеет соответствующего Director в contract.director.
// =============================================================================

/**
 * @param {object}   responsibility
 * @param {object}   director
 * @param {string[]} problems
 * @param {string[]} recommendations
 */
function checkResponsibilityVsDirector(
  responsibility,
  director,
  problems,
  recommendations,
) {
  for (const [key, entry] of Object.entries(responsibility)) {
    const directorName = entry.ownerDirector;

    if (!isNonEmptyString(directorName)) continue; // уже проверяется auditor

    if (!(directorName in director)) {
      problems.push(
        `[consistency] ownerDirector "${directorName}" (из responsibility.${key}) отсутствует в contract.director.`,
      );
      recommendations.push(
        `Добавьте запись "${directorName}" в contract.director.js.`,
      );
    }
  }
}

// =============================================================================
// УСЛОВИЕ 3: director ownerScope существует
// Каждый Director из responsibility имеет ownerScope в contract.director.
// =============================================================================

/**
 * Проверяет, что у каждого директора, упомянутого в responsibility,
 * в contract.director заполнен ownerScope (непустой массив).
 *
 * @param {object}   responsibility
 * @param {object}   director
 * @param {string[]} problems
 * @param {string[]} recommendations
 */
function checkDirectorOwnerScope(
  responsibility,
  director,
  problems,
  recommendations,
) {
  // Собираем уникальные директора из responsibility
  const mentionedDirectors = new Set();
  for (const entry of Object.values(responsibility)) {
    if (isNonEmptyString(entry.ownerDirector)) {
      mentionedDirectors.add(entry.ownerDirector);
    }
  }

  for (const directorName of mentionedDirectors) {
    const dirEntry = director[directorName];
    if (!dirEntry) continue; // уже отмечено в условии 2

    if (
      !Array.isArray(dirEntry.ownerScope) ||
      dirEntry.ownerScope.length === 0
    ) {
      problems.push(
        `[consistency] Director "${directorName}" существует в contract.director, но ownerScope отсутствует или пуст.`,
      );
      recommendations.push(
        `Заполните ownerScope для "${directorName}" в contract.director.js.`,
      );
    }
  }
}

// =============================================================================
// УСЛОВИЕ 4: ownerScope → ownership paths
// Каждый ownerScope присутствует среди путей ownership.
// =============================================================================

/**
 * Проверяет, что каждый путь из ownerScope любого Director
 * присутствует как path в contract.ownership.
 *
 * @param {object}   responsibility
 * @param {object}   director
 * @param {object}   ownership
 * @param {string[]} warnings
 * @param {string[]} recommendations
 */
function checkOwnerScopeVsOwnership(
  responsibility,
  director,
  ownership,
  warnings,
  recommendations,
) {
  // Собираем множество всех path из ownership
  const knownPaths = new Set();
  for (const entry of Object.values(ownership)) {
    if (isNonEmptyString(entry.path)) {
      knownPaths.add(entry.path);
    }
  }

  // Собираем уникальные директора из responsibility
  const mentionedDirectors = new Set();
  for (const entry of Object.values(responsibility)) {
    if (isNonEmptyString(entry.ownerDirector)) {
      mentionedDirectors.add(entry.ownerDirector);
    }
  }

  // Проверяем каждый ownerScope упомянутого директора
  for (const directorName of mentionedDirectors) {
    const dirEntry = director[directorName];
    if (!dirEntry || !Array.isArray(dirEntry.ownerScope)) continue;

    for (const scopePath of dirEntry.ownerScope) {
      if (!knownPaths.has(scopePath)) {
        // WARNING, а не ERROR: ownership может заполняться поэтапно
        warnings.push(
          `[consistency] ownerScope "${scopePath}" (Director: ${directorName}) отсутствует среди путей в contract.ownership.`,
        );
        recommendations.push(
          `Добавьте путь "${scopePath}" в contract.ownership.js или скорректируйте ownerScope для "${directorName}".`,
        );
      }
    }
  }
}

// =============================================================================
// ОПРЕДЕЛЕНИЕ ИТОГОВОГО СОСТОЯНИЯ
// =============================================================================

function determineState(problems, warnings) {
  if (problems.length > 0) return "ERROR";
  if (warnings.length > 0) return "WARNING";
  return "HEALTHY";
}

// =============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// =============================================================================

/**
 * run(registry)
 *
 * Выполняет аудит согласованности контрактов.
 *
 * @param {object} registry — CONTRACT_REGISTRY из contract.registry.js
 * @returns {{ state: string, warnings: string[], problems: string[], recommendations: string[] }}
 *
 * Вызов из консоли Screeps:
 *   const r = require('contract.registry');
 *   JSON.stringify(r.consistency.run(r), null, 2)
 */
function run(registry) {
  if (!isObject(registry)) {
    return {
      state: "ERROR",
      warnings: [],
      problems: [
        "CONTRACT_REGISTRY не передан в run() или имеет некорректный тип.",
      ],
      recommendations: [
        "Вызов: const r = require('contract.registry'); r.consistency.run(r);",
      ],
    };
  }

  const problems = [];
  const warnings = [];
  const recommendations = [];

  // Проверяем наличие обязательных разделов для каждого условия
  const hasResponsibility = isObject(registry.responsibility);
  const hasPolicy = isObject(registry.policy);
  const hasDirector = isObject(registry.director);
  const hasOwnership = isObject(registry.ownership);

  if (!hasResponsibility) {
    return {
      state: "ERROR",
      warnings: [],
      problems: [
        "[consistency] Раздел responsibility недоступен. Аудит согласованности невозможен.",
      ],
      recommendations: [
        "Подключите contract.responsibility.js в contract.registry.js.",
      ],
    };
  }

  // Условие 1: policy → responsibility (инвертировано в ТЗ №24)
  if (!hasPolicy) {
    warnings.push(
      "[consistency] Раздел policy недоступен. Проверка условия 1 пропущена.",
    );
    recommendations.push(
      "Подключите contract.policy.js в contract.registry.js.",
    );
  } else {
    checkPolicyVsResponsibility(
      registry.policy,
      registry.responsibility,
      problems,
      warnings,
      recommendations,
    );
  }

  // Условие 2: responsibility → director
  if (!hasDirector) {
    warnings.push(
      "[consistency] Раздел director недоступен. Проверки условий 2 и 3 пропущены.",
    );
    recommendations.push(
      "Подключите contract.director.js в contract.registry.js.",
    );
  } else {
    checkResponsibilityVsDirector(
      registry.responsibility,
      registry.director,
      problems,
      recommendations,
    );
    // Условие 3: director ownerScope существует
    checkDirectorOwnerScope(
      registry.responsibility,
      registry.director,
      problems,
      recommendations,
    );
  }

  // Условие 4: ownerScope → ownership paths
  if (!hasDirector || !hasOwnership) {
    warnings.push(
      "[consistency] Разделы director или ownership недоступны. Проверка условия 4 пропущена.",
    );
  } else {
    checkOwnerScopeVsOwnership(
      registry.responsibility,
      registry.director,
      registry.ownership,
      warnings,
      recommendations,
    );
  }

  return {
    state: determineState(problems, warnings),
    warnings,
    problems,
    recommendations,
  };
}

// =============================================================================
// ЭКСПОРТ
// =============================================================================

module.exports = { run };
