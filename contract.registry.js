/**
 * contract.registry.js
 *
 * Единый реестр архитектурных контрактов проекта.
 * Источник: CONTRACT_IMPLEMENTATION_ROADMAP V1.0, ЭТАП 1–4.
 *
 * ПРАВИЛА:
 *   - Файл только агрегирует контракты. Никакой игровой логики.
 *   - Не подключён в main.js. Не создаёт и не изменяет Memory.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const contracts = require('contract.registry');
 *
 *   contracts.policy.economy.state                   // => 'ENABLED'
 *   contracts.policy.POLICY_STATES                   // => ['ENABLED','DISABLED']
 *   contracts.directorDiagnostics.createReport()     // => { state, warnings, ... }
 *   contracts.diagnostics.run(contracts)             // => { state, ... }
 *   contracts.auditor.run(contracts)                 // => { state, ... }
 */

"use strict";

const ownership = require("contract.ownership");
const lifecycle = require("contract.lifecycle");
const responsibility = require("contract.responsibility");
const architecture = require("contract.architecture");
const catalog = require("contract.catalog");
const director = require("contract.director");
const directorDiagnostics = require("contract.directorDiagnostics");
const policy = require("contract.policy");
const diagnostics = require("contract.diagnostics");
const auditor = require("contract.auditor");

/**
 * CONTRACT_REGISTRY
 *
 * Структура:
 * CONTRACT_REGISTRY
 * ├── ownership           — владельцы разделов Memory
 * ├── lifecycle           — жизненные циклы объектов
 * ├── responsibility      — карта ответственности подсистем
 * ├── architecture        — корневые архитектурные сущности
 * ├── catalog             — единый каталог всех контрактов
 * ├── director            — контракт Director Layer
 * ├── directorDiagnostics — нормативный формат диагностики Director
 * ├── policy              — контракт Policy Layer
 * ├── diagnostics         — диагностика целостности контракта
 * └── auditor             — аудит корректности Ownership Contract
 */
const CONTRACT_REGISTRY = {
  ownership,
  lifecycle,
  responsibility,
  architecture,
  catalog,
  director,
  directorDiagnostics,
  policy,
  diagnostics,
  auditor,
};

module.exports = CONTRACT_REGISTRY;
