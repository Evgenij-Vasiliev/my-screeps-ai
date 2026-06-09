/**
 * contract.registry.js
 *
 * Единый реестр архитектурных контрактов проекта.
 * Источник: CONTRACT_IMPLEMENTATION_ROADMAP V1.0, ЭТАП 1–4.
 *
 * НАЗНАЧЕНИЕ:
 *   Единая точка входа для доступа ко всем машинным контрактам.
 *
 * ПРАВИЛА:
 *   - Файл только агрегирует контракты. Никакой игровой логики.
 *   - Файл не подключён в существующий код (не вызывается из main.js).
 *   - Файл не создаёт и не изменяет Memory.
 *   - Файл не выполняет проверок и не запускает диагностику самостоятельно.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const contracts = require('contract.registry');
 *
 *   contracts.ownership.economy.owner          // => 'EconomyDirector'
 *   contracts.architecture.EmpireDirector.role // => 'ROOT_DIRECTOR'
 *   contracts.diagnostics.run(contracts)       // => { state, ... }
 *   contracts.auditor.run(contracts)           // => { state, ... }
 */

"use strict";

// Подключаем контракты данных
const ownership = require("contract.ownership");
const lifecycle = require("contract.lifecycle");
const responsibility = require("contract.responsibility");
const architecture = require("contract.architecture");

// Подключаем модули анализа
const diagnostics = require("contract.diagnostics");
const auditor = require("contract.auditor");

/**
 * CONTRACT_REGISTRY
 *
 * Структура:
 * CONTRACT_REGISTRY
 * ├── ownership       — владельцы разделов Memory
 * ├── lifecycle       — жизненные циклы объектов
 * ├── responsibility  — карта ответственности подсистем
 * ├── architecture    — корневые архитектурные сущности
 * ├── diagnostics     — диагностика целостности контракта
 * └── auditor         — аудит корректности Ownership Contract
 */
const CONTRACT_REGISTRY = {
  /**
   * ownership
   * Источник: contract.ownership.js
   * Контракт: ARCHITECTURE_CONTRACT V3.4, раздел 4.
   */
  ownership: ownership,

  /**
   * lifecycle
   * Источник: contract.lifecycle.js
   * Контракт: ARCHITECTURE_CONTRACT V3.4, раздел 6.
   */
  lifecycle: lifecycle,

  /**
   * responsibility
   * Источник: contract.responsibility.js
   * Контракт: ARCHITECTURE_CONTRACT V3.4 + ROADMAP V1.0, ЭТАП 2.
   */
  responsibility: responsibility,

  /**
   * architecture
   * Корневые архитектурные сущности (ROOT_DIRECTOR и другие).
   * Источник: contract.architecture.js
   * Контракт: ARCHITECTURE_CONTRACT V3.4, раздел 2.
   *
   * Эти сущности НЕ являются подсистемами responsibility.
   * Они описывают стратегический уровень управления.
   */
  architecture: architecture,

  /**
   * diagnostics
   * Источник: contract.diagnostics.js
   * Контракт: ROADMAP V1.0, ЭТАП 3.
   * Использование: contracts.diagnostics.run(contracts)
   */
  diagnostics: diagnostics,

  /**
   * auditor
   * Источник: contract.auditor.js
   * Контракт: ROADMAP V1.0, ЭТАП 4.
   * Использование: contracts.auditor.run(contracts)
   */
  auditor: auditor,
};

module.exports = CONTRACT_REGISTRY;
