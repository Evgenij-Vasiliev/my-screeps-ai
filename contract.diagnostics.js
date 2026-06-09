/**
 * contract.diagnostics.js
 *
 * Модуль автоматической диагностики архитектурного контракта.
 * Источник: CONTRACT_IMPLEMENTATION_ROADMAP V1.0, ЭТАП 3.
 *
 * НАЗНАЧЕНИЕ:
 *   Проверяет целостность CONTRACT_REGISTRY и возвращает машинный отчёт.
 *   Отчёт используется будущим DiagnosticsDirector.
 *
 * ЖЁСТКИЕ ГАРАНТИИ:
 *   - НЕ изменяет Memory
 *   - НЕ выполняет recovery
 *   - НЕ зависит от игровых объектов (Game, Creep, Room и т.д.)
 *   - Работает ТОЛЬКО с CONTRACT_REGISTRY
 *
 * ПРОВЕРЯЕМЫЕ УСЛОВИЯ (ТЗ №15):
 *   1. Наличие раздела ownership    в CONTRACT_REGISTRY
 *   2. Наличие раздела lifecycle    в CONTRACT_REGISTRY
 *   3. Наличие раздела responsibility в CONTRACT_REGISTRY
 *   4. Каждая запись responsibility имеет поле ownerDirector
 *   5. Каждая запись responsibility имеет поле memorySection
 *
 * ДОПОЛНИТЕЛЬНЫЕ ПРОВЕРКИ (целостность данных):
 *   6. Каждая запись ownership имеет поля owner и path
 *   7. Каждый жизненный цикл lifecycle имеет states, initial, terminal, transitions
 *   8. Все терминальные состояния lifecycle присутствуют в states
 *   9. Все ключи transitions lifecycle присутствуют в states
 *
 * СТРУКТУРА ОТЧЁТА:
 *   {
 *     state:           'HEALTHY' | 'WARNING' | 'ERROR',
 *     warnings:        string[],
 *     problems:        string[],
 *     recommendations: string[]
 *   }
 *
 * ПРАВИЛА ФОРМИРОВАНИЯ СОСТОЯНИЯ:
 *   problems.length > 0              -> 'ERROR'
 *   warnings.length > 0, нет ошибок -> 'WARNING'
 *   нет ни ошибок, ни предупреждений -> 'HEALTHY'
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const registry = require('contract.registry');
 *   const diag     = require('contract.diagnostics');
 *   const report   = diag.run(registry);
 *   console.log(JSON.stringify(report, null, 2));
 */

"use strict";

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Проверяет, является ли значение непустым объектом (не массивом, не null).
 * @param {*} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Проверяет, является ли значение непустой строкой.
 * @param {*} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// =============================================================================
// ПРОВЕРКА РАЗДЕЛОВ ВЕРХНЕГО УРОВНЯ (Условия 1, 2, 3)
// =============================================================================

/**
 * Проверяет наличие трёх обязательных разделов в CONTRACT_REGISTRY.
 * Возвращает флаги — продолжать ли проверки каждого раздела.
 *
 * @param {object}   registry
 * @param {string[]} problems
 * @param {string[]} recommendations
 * @returns {{ hasOwnership: boolean, hasLifecycle: boolean, hasResponsibility: boolean }}
 */
function checkTopLevelSections(registry, problems, recommendations) {
  let hasOwnership = false;
  let hasLifecycle = false;
  let hasResponsibility = false;

  // Условие 1
  if (!isObject(registry.ownership)) {
    problems.push(
      "[ownership] Раздел ownership отсутствует или имеет неверный тип.",
    );
    recommendations.push(
      "Убедитесь, что contract.ownership.js существует и экспортирует объект.",
    );
  } else {
    hasOwnership = true;
  }

  // Условие 2
  if (!isObject(registry.lifecycle)) {
    problems.push(
      "[lifecycle] Раздел lifecycle отсутствует или имеет неверный тип.",
    );
    recommendations.push(
      "Убедитесь, что contract.lifecycle.js существует и экспортирует объект.",
    );
  } else {
    hasLifecycle = true;
  }

  // Условие 3
  if (!isObject(registry.responsibility)) {
    problems.push(
      "[responsibility] Раздел responsibility отсутствует или имеет неверный тип.",
    );
    recommendations.push(
      "Убедитесь, что contract.responsibility.js существует и экспортирует объект.",
    );
  } else {
    hasResponsibility = true;
  }

  return { hasOwnership, hasLifecycle, hasResponsibility };
}

// =============================================================================
// ПРОВЕРКА OWNERSHIP (Условие 6: поля owner и path)
// =============================================================================

/**
 * Структура записи в contract.ownership.js:
 *   { owner: string, path: string, description: string }
 *
 * ВАЖНО: поле называется 'owner', не 'ownerDirector'.
 *
 * @param {object}   ownership
 * @param {string[]} warnings
 * @param {string[]} recommendations
 */
function checkOwnershipEntries(ownership, warnings, recommendations) {
  for (const [key, entry] of Object.entries(ownership)) {
    if (!isNonEmptyString(entry.owner)) {
      warnings.push(`[ownership.${key}] Отсутствует или пустое поле "owner".`);
      recommendations.push(
        `Добавьте поле owner в запись "${key}" файла contract.ownership.js.`,
      );
    }

    if (!isNonEmptyString(entry.path)) {
      warnings.push(`[ownership.${key}] Отсутствует или пустое поле "path".`);
      recommendations.push(
        `Добавьте поле path (например, "Memory.empire.${key}") в запись "${key}".`,
      );
    }
  }
}

// =============================================================================
// ПРОВЕРКА LIFECYCLE (Условия 7, 8, 9)
// =============================================================================

/**
 * Структура записи в contract.lifecycle.js:
 *   { states: string[], initial: string, terminal: string[], transitions: object }
 *
 * @param {object}   lifecycle
 * @param {string[]} warnings
 * @param {string[]} recommendations
 */
function checkLifecycleEntries(lifecycle, warnings, recommendations) {
  for (const [name, lc] of Object.entries(lifecycle)) {
    const prefix = `[lifecycle.${name}]`;

    // Условие 7а: states — непустой массив
    if (!Array.isArray(lc.states) || lc.states.length === 0) {
      warnings.push(`${prefix} Отсутствует или пустой массив "states".`);
      recommendations.push(
        `Добавьте массив states в жизненный цикл "${name}".`,
      );
      continue; // без states остальные проверки бессмысленны
    }

    const stateSet = new Set(lc.states);

    // Условие 7б: initial присутствует в states
    if (!isNonEmptyString(lc.initial)) {
      warnings.push(
        `${prefix} Отсутствует поле "initial" (начальное состояние).`,
      );
      recommendations.push(`Укажите начальное состояние в поле initial.`);
    } else if (!stateSet.has(lc.initial)) {
      warnings.push(
        `${prefix} Начальное состояние "${lc.initial}" отсутствует в массиве states.`,
      );
    }

    // Условие 7в + 8: terminal — массив, каждое значение есть в states
    if (!Array.isArray(lc.terminal)) {
      warnings.push(
        `${prefix} Отсутствует массив "terminal" (терминальные состояния).`,
      );
      recommendations.push(
        `Добавьте массив terminal в жизненный цикл "${name}".`,
      );
    } else {
      for (const t of lc.terminal) {
        if (!stateSet.has(t)) {
          warnings.push(
            `${prefix} Терминальное состояние "${t}" отсутствует в массиве states.`,
          );
        }
      }
    }

    // Условие 7г + 9: transitions — объект, каждый ключ есть в states
    if (!isObject(lc.transitions)) {
      warnings.push(`${prefix} Отсутствует объект "transitions".`);
      recommendations.push(
        `Добавьте объект transitions в жизненный цикл "${name}".`,
      );
    } else {
      for (const fromState of Object.keys(lc.transitions)) {
        if (!stateSet.has(fromState)) {
          warnings.push(
            `${prefix} В transitions найден ключ "${fromState}", которого нет в states.`,
          );
        }
      }
    }
  }
}

// =============================================================================
// ПРОВЕРКА RESPONSIBILITY (Условия 4, 5 из ТЗ №15)
// =============================================================================

/**
 * Структура записи в contract.responsibility.js:
 *   { ownerDirector: string, memorySection: string, executor: string, contractCompliance: string }
 *
 * Условие 4: ownerDirector обязателен.
 * Условие 5: memorySection обязателен.
 *
 * @param {object}   responsibility
 * @param {string[]} problems
 * @param {string[]} recommendations
 */
function checkResponsibilityEntries(responsibility, problems, recommendations) {
  for (const [key, entry] of Object.entries(responsibility)) {
    const prefix = `[responsibility.${key}]`;

    // Условие 4
    if (!isNonEmptyString(entry.ownerDirector)) {
      problems.push(
        `${prefix} Отсутствует или пустое обязательное поле "ownerDirector".`,
      );
      recommendations.push(
        `Добавьте ownerDirector в запись "${key}" файла contract.responsibility.js.`,
      );
    }

    // Условие 5
    if (!isNonEmptyString(entry.memorySection)) {
      problems.push(
        `${prefix} Отсутствует или пустое обязательное поле "memorySection".`,
      );
      recommendations.push(
        `Добавьте memorySection в запись "${key}" файла contract.responsibility.js.`,
      );
    }
  }
}

// =============================================================================
// ОПРЕДЕЛЕНИЕ ИТОГОВОГО СОСТОЯНИЯ
// =============================================================================

/**
 * @param {string[]} problems
 * @param {string[]} warnings
 * @returns {'HEALTHY'|'WARNING'|'ERROR'}
 */
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
 * Выполняет полную диагностику CONTRACT_REGISTRY.
 *
 * @param {object} registry — CONTRACT_REGISTRY из contract.registry.js
 * @returns {{ state: string, warnings: string[], problems: string[], recommendations: string[] }}
 *
 * Вызов из консоли Screeps:
 *   const r = require('contract.registry');
 *   JSON.stringify(require('contract.diagnostics').run(r), null, 2)
 */
function run(registry) {
  // Защита: реестр не передан
  if (!isObject(registry)) {
    return {
      state: "ERROR",
      warnings: [],
      problems: [
        "CONTRACT_REGISTRY не передан в run() или имеет некорректный тип.",
      ],
      recommendations: [
        "Вызов: const r = require('contract.registry'); diag.run(r);",
      ],
    };
  }

  const problems = [];
  const warnings = [];
  const recommendations = [];

  // Условия 1, 2, 3 — наличие разделов верхнего уровня
  const { hasOwnership, hasLifecycle, hasResponsibility } =
    checkTopLevelSections(registry, problems, recommendations);

  // Условие 6 — целостность записей ownership
  if (hasOwnership) {
    checkOwnershipEntries(registry.ownership, warnings, recommendations);
  }

  // Условия 7, 8, 9 — целостность жизненных циклов
  if (hasLifecycle) {
    checkLifecycleEntries(registry.lifecycle, warnings, recommendations);
  }

  // Условия 4, 5 — ownerDirector и memorySection в responsibility
  if (hasResponsibility) {
    checkResponsibilityEntries(
      registry.responsibility,
      problems,
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
