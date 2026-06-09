/**
 * contract.director.js
 *
 * Единый контракт Director Layer империи.
 * Источник: ARCHITECTURE_CONTRACT V3.4, раздел 2 "Иерархия управления".
 *
 * НАЗНАЧЕНИЕ:
 *   Определяет обязательную структуру любого Director в империи.
 *   Позволяет любому модулю определить: какими данными владеет Director,
 *   обязан ли публиковать состояние и диагностику, поддерживает ли
 *   ручное управление через ConsoleDirector.
 *
 * ПРАВИЛА:
 *   - Декларативный контракт. Никакой игровой логики.
 *   - Не использует Memory.
 *   - Не выполняет проверок.
 *
 * ПОЛЯ КАЖДОЙ ЗАПИСИ:
 *   name                {string}   — имя директора
 *   ownerScope          {string[]} — разделы Memory, которыми директор владеет
 *   stateProvider       {boolean}  — обязан публиковать состояние
 *   diagnosticsProvider {boolean}  — обязан публиковать диагностику
 *   manualControl       {boolean}  — поддерживает ручное управление через ConsoleDirector
 */

"use strict";

/**
 * DIRECTOR_CONTRACT
 *
 * Контракт Director Layer.
 * Ключ — имя директора (совпадает с полем name).
 */
const DIRECTOR_CONTRACT = {
  /**
   * EconomyDirector
   * Экономика: производство, резервы, баланс ресурсов.
   */
  EconomyDirector: {
    name: "EconomyDirector",
    ownerScope: ["Memory.empire.economy"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * LogisticsDirector
   * Логистика: движение ресурсов, доставки, назначения.
   */
  LogisticsDirector: {
    name: "LogisticsDirector",
    ownerScope: ["Memory.empire.logistics"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * MarketDirector
   * Торговая политика: ордера, запреты, стратегия продаж.
   */
  MarketDirector: {
    name: "MarketDirector",
    ownerScope: ["Memory.empire.market"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * LabDirector
   * Лаборатории: реакции, производство бустов, цепочки.
   */
  LabDirector: {
    name: "LabDirector",
    ownerScope: ["Memory.empire.labs"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * FactoryDirector
   * Фабрика: очередь, текущий заказ, состояние, статистика.
   */
  FactoryDirector: {
    name: "FactoryDirector",
    ownerScope: ["Memory.empire.factory"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * MilitaryDirector
   * Военные операции: оборона, атака.
   */
  MilitaryDirector: {
    name: "MilitaryDirector",
    ownerScope: ["Memory.empire.military"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * ExpansionDirector
   * Развитие империи: захват новых комнат, резервирование.
   */
  ExpansionDirector: {
    name: "ExpansionDirector",
    ownerScope: ["Memory.empire.expansion"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * DiagnosticsDirector
   * Диагностика: агрегация состояний всех подсистем, аудит контракта.
   */
  DiagnosticsDirector: {
    name: "DiagnosticsDirector",
    ownerScope: ["Memory.empire.diagnostics"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },

  /**
   * ConsoleDirector
   * Ручное управление: единственная точка консольных команд.
   */
  ConsoleDirector: {
    name: "ConsoleDirector",
    ownerScope: ["Memory.empire.console"],
    stateProvider: true,
    diagnosticsProvider: true,
    manualControl: true,
  },
};

module.exports = DIRECTOR_CONTRACT;
