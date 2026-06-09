/**
 * contract.catalog.js
 *
 * Единый каталог контрактов системы.
 * Источник: CONTRACT_IMPLEMENTATION_ROADMAP V1.0.
 *
 * НАЗНАЧЕНИЕ:
 *   Машинное описание всех зарегистрированных контрактов.
 *   Позволяет любому модулю определить: какие контракты существуют,
 *   какого они типа, кто является владельцем.
 *
 * ПРАВИЛА:
 *   - Декларативный модуль. Никакой игровой логики.
 *   - Не выполняет проверок.
 *   - Не использует Memory.
 *
 * ТИПЫ КОНТРАКТОВ:
 *   DATA_CONTRACT        — описывает владельцев данных
 *   LIFECYCLE_CONTRACT   — описывает жизненные циклы объектов
 *   GOVERNANCE_CONTRACT  — описывает карту ответственности подсистем
 *   ARCHITECTURE_CONTRACT — описывает корневые архитектурные сущности
 *   DIAGNOSTIC_CONTRACT  — выполняет диагностику целостности
 *   AUDIT_CONTRACT       — выполняет аудит корректности
 */

"use strict";

/**
 * CATALOG_CONTRACT
 *
 * Каждая запись содержит:
 *   name        {string} — имя контракта
 *   type        {string} — тип контракта
 *   description {string} — краткое назначение
 *   owner       {string} — владелец контракта
 */
const CATALOG_CONTRACT = {
  ownership: {
    name: "ownership",
    type: "DATA_CONTRACT",
    description:
      "Владельцы разделов Memory. Единственный источник истины для Ownership Contract.",
    owner: "EmpireDirector",
  },

  lifecycle: {
    name: "lifecycle",
    type: "LIFECYCLE_CONTRACT",
    description:
      "Жизненные циклы объектов: состояния, начальное состояние, терминальные состояния, допустимые переходы.",
    owner: "EmpireDirector",
  },

  responsibility: {
    name: "responsibility",
    type: "GOVERNANCE_CONTRACT",
    description:
      "Карта ответственности подсистем: директор-владелец, раздел памяти, исполнитель, уровень соответствия контракту.",
    owner: "EmpireDirector",
  },

  architecture: {
    name: "architecture",
    type: "ARCHITECTURE_CONTRACT",
    description:
      "Корневые архитектурные сущности империи. Описывает сущности уровня ROOT_DIRECTOR, которые не являются подсистемами responsibility.",
    owner: "EmpireDirector",
  },

  diagnostics: {
    name: "diagnostics",
    type: "DIAGNOSTIC_CONTRACT",
    description:
      "Автоматическая диагностика целостности CONTRACT_REGISTRY. Возвращает отчёт: state, warnings, problems, recommendations.",
    owner: "DiagnosticsDirector",
  },

  auditor: {
    name: "auditor",
    type: "AUDIT_CONTRACT",
    description:
      "Аудит корректности Ownership Contract. Проверяет поля, уникальность путей, покрытие владельцев в responsibility.",
    owner: "DiagnosticsDirector",
  },
};

module.exports = CATALOG_CONTRACT;
