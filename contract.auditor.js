/**
 * contract.auditor.js
 *
 * Модуль Ownership Audit для контрактного слоя.
 * Источник: CONTRACT_IMPLEMENTATION_ROADMAP V1.0, ЭТАП 4.
 *
 * НАЗНАЧЕНИЕ:
 *   Проверяет корректность Ownership Contract.
 *   Выявляет нарушения: отсутствующие поля, пустые значения,
 *   дублирующиеся пути, владельцев без зоны ответственности.
 *
 * ЖЁСТКИЕ ГАРАНТИИ:
 *   - НЕ изменяет данные
 *   - НЕ выполняет recovery
 *   - НЕ зависит от игровых объектов (Game, Creep, Room и т.д.)
 *   - Работает ТОЛЬКО с CONTRACT_REGISTRY
 *
 * ПРОВЕРЯЕМЫЕ УСЛОВИЯ (ТЗ №16, обновлено в ТЗ №19):
 *   1. Каждый раздел ownership содержит поле owner
 *   2. Каждый раздел ownership содержит поле path
 *   3. Значение owner не пустое
 *   4. Значение path не пустое
 *   5. Не существует двух записей ownership с одинаковым path
 *   6. Каждый owner присутствует в responsibility (ownerDirector)
 *      ИЛИ в architecture как именованная сущность
 *
 * СТРУКТУРА ОТЧЁТА:
 *   { state, warnings, problems, recommendations }
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const registry = require('contract.registry');
 *   const report   = registry.auditor.run(registry);
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
// ПРОВЕРКИ 1–4: НАЛИЧИЕ И НЕПУСТОТА ПОЛЕЙ owner И path
// =============================================================================

/**
 * Проверяет каждую запись ownership на наличие и непустоту полей owner и path.
 * Условия 1, 2, 3, 4.
 *
 * @param {object}   ownership
 * @param {string[]} problems
 * @param {string[]} recommendations
 */
function checkRequiredFields(ownership, problems, recommendations) {
  for (const [key, entry] of Object.entries(ownership)) {
    const prefix = `[ownership.${key}]`;

    // Условие 1: поле owner существует
    if (!("owner" in entry)) {
      problems.push(`${prefix} Отсутствует поле "owner".`);
      recommendations.push(
        `Добавьте поле owner в запись "${key}" файла contract.ownership.js.`,
      );

      // Условие 3: значение owner не пустое
    } else if (!isNonEmptyString(entry.owner)) {
      problems.push(
        `${prefix} Поле "owner" существует, но содержит пустое значение.`,
      );
      recommendations.push(
        `Укажите непустое значение owner в записи "${key}".`,
      );
    }

    // Условие 2: поле path существует
    if (!("path" in entry)) {
      problems.push(`${prefix} Отсутствует поле "path".`);
      recommendations.push(
        `Добавьте поле path в запись "${key}" файла contract.ownership.js.`,
      );

      // Условие 4: значение path не пустое
    } else if (!isNonEmptyString(entry.path)) {
      problems.push(
        `${prefix} Поле "path" существует, но содержит пустое значение.`,
      );
      recommendations.push(`Укажите непустое значение path в записи "${key}".`);
    }
  }
}

// =============================================================================
// ПРОВЕРКА 5: УНИКАЛЬНОСТЬ path
// =============================================================================

/**
 * Проверяет, что не существует двух записей ownership с одинаковым path.
 * Условие 5.
 *
 * @param {object}   ownership
 * @param {string[]} problems
 * @param {string[]} recommendations
 */
function checkUniquePaths(ownership, problems, recommendations) {
  // Строим карту: path -> массив ключей, которые его используют
  const pathMap = {};

  for (const [key, entry] of Object.entries(ownership)) {
    // Проверяем только записи с непустым path (остальные уже отмечены выше)
    if (!isNonEmptyString(entry.path)) continue;

    if (!pathMap[entry.path]) {
      pathMap[entry.path] = [];
    }
    pathMap[entry.path].push(key);
  }

  // Ищем path, которые используются более одного раза
  for (const [path, keys] of Object.entries(pathMap)) {
    if (keys.length > 1) {
      problems.push(
        `[ownership] Дублирующийся path "${path}" обнаружен в записях: ${keys.join(
          ", ",
        )}.`,
      );
      recommendations.push(
        `Убедитесь, что каждый раздел Memory принадлежит ровно одному владельцу. Проверьте записи: ${keys.join(
          ", ",
        )}.`,
      );
    }
  }
}

// =============================================================================
// ПРОВЕРКА 6: КАЖДЫЙ owner ПОКРЫТ В responsibility ИЛИ architecture
// =============================================================================

/**
 * Проверяет, что каждый owner из ownership присутствует хотя бы в одном
 * из двух источников:
 *   - responsibility: как значение поля ownerDirector в любой записи
 *   - architecture:   как именованная сущность (ключ верхнего уровня)
 *
 * Условие 6 (обновлено в ТЗ №19).
 *
 * Логика:
 *   1. Ищем owner среди ownerDirector в responsibility.
 *   2. Если не найден — ищем owner как ключ в architecture.
 *   3. Если отсутствует в обоих местах — формируем WARNING.
 *
 * Тип WARNING (не ERROR): responsibility и architecture могут заполняться
 * поэтапно в ходе реконструкции империи.
 *
 * @param {object}        ownership
 * @param {object}        responsibility
 * @param {object|null}   architecture   — может отсутствовать (необязательный раздел)
 * @param {string[]}      warnings
 * @param {string[]}      recommendations
 */
function checkOwnersCoverage(
  ownership,
  responsibility,
  architecture,
  warnings,
  recommendations,
) {
  // Собираем множество всех ownerDirector из responsibility
  const coveredByResponsibility = new Set();
  for (const entry of Object.values(responsibility)) {
    if (isNonEmptyString(entry.ownerDirector)) {
      coveredByResponsibility.add(entry.ownerDirector);
    }
  }

  // Проверяем каждый owner из ownership
  for (const [key, entry] of Object.entries(ownership)) {
    if (!isNonEmptyString(entry.owner)) continue; // уже отмечен в checkRequiredFields

    const owner = entry.owner;

    // Шаг 1: owner есть в responsibility?
    if (coveredByResponsibility.has(owner)) continue;

    // Шаг 2: owner есть в architecture?
    if (isObject(architecture) && owner in architecture) continue;

    // Шаг 3: не найден нигде — WARNING
    warnings.push(
      `[ownership.${key}] Владелец "${owner}" не найден ни в responsibility (ownerDirector), ни в architecture.`,
    );
    recommendations.push(
      `Добавьте "${owner}" в contract.responsibility.js или в contract.architecture.js.`,
    );
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
 * Выполняет Ownership Audit CONTRACT_REGISTRY.
 *
 * @param {object} registry — CONTRACT_REGISTRY из contract.registry.js
 * @returns {{ state: string, warnings: string[], problems: string[], recommendations: string[] }}
 *
 * Вызов из консоли Screeps:
 *   const r = require('contract.registry');
 *   JSON.stringify(r.auditor.run(r), null, 2)
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
        "Вызов: const r = require('contract.registry'); r.auditor.run(r);",
      ],
    };
  }

  // Защита: раздел ownership отсутствует — аудит невозможен
  if (!isObject(registry.ownership)) {
    return {
      state: "ERROR",
      warnings: [],
      problems: [
        "[ownership] Раздел ownership отсутствует в CONTRACT_REGISTRY. Аудит невозможен.",
      ],
      recommendations: [
        "Убедитесь, что contract.ownership.js подключён в contract.registry.js.",
      ],
    };
  }

  const problems = [];
  const warnings = [];
  const recommendations = [];

  // Условия 1, 2, 3, 4 — поля owner и path
  checkRequiredFields(registry.ownership, problems, recommendations);

  // Условие 5 — уникальность path
  checkUniquePaths(registry.ownership, problems, recommendations);

  // Условие 6 — покрытие владельцев в responsibility ИЛИ architecture
  // Запускаем только если responsibility доступна; иначе — предупреждение
  if (!isObject(registry.responsibility)) {
    warnings.push(
      "[responsibility] Раздел responsibility недоступен. Проверка покрытия владельцев (условие 6) пропущена.",
    );
    recommendations.push(
      "Подключите contract.responsibility.js в contract.registry.js для полного аудита.",
    );
  } else {
    // architecture передаём как необязательный аргумент — может быть null/undefined
    checkOwnersCoverage(
      registry.ownership,
      registry.responsibility,
      registry.architecture || null,
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
