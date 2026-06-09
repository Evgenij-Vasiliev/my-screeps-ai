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
 *   contracts.ownership.economy.owner             // => 'EconomyDirector'
 *   contracts.architecture.EmpireDirector.role    // => 'ROOT_DIRECTOR'
 *   contracts.catalog.diagnostics.type            // => 'DIAGNOSTIC_CONTRACT'
 *   contracts.diagnostics.run(contracts)          // => { state, ... }
 *   contracts.auditor.run(contracts)              // => { state, ... }
 */

"use strict";

// Подключаем контракты данных
const ownership = require("contract.ownership");
const lifecycle = require("contract.lifecycle");
const responsibility = require("contract.responsibility");
const architecture = require("contract.architecture");
const catalog = require("contract.catalog");

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
 * ├── catalog         — единый каталог всех контрактов
 * ├── diagnostics     — диагностика целостности контракта
 * └── auditor         — аудит корректности Ownership Contract
 */
const CONTRACT_REGISTRY = {
  ownership: ownership,
  lifecycle: lifecycle,
  responsibility: responsibility,
  architecture: architecture,
  catalog: catalog,
  diagnostics: diagnostics,
  auditor: auditor,
};

module.exports = CONTRACT_REGISTRY;
