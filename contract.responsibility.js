/**
 * contract.responsibility.js
 *
 * Машинная карта ответственности подсистем империи.
 * Источник: ARCHITECTURE_CONTRACT V3.4 + CONTRACT_IMPLEMENTATION_ROADMAP V1.0, ЭТАП 2.
 *
 * НАЗНАЧЕНИЕ:
 *   Единое машинное описание ответственности каждой подсистемы.
 *   Является основой для будущих ContractAuditor и DiagnosticsDirector.
 *
 * ПРАВИЛА:
 *   - Файл только описывает ответственность. Никакой игровой логики.
 *   - Файл не выполняет проверок и не изменяет Memory.
 *   - Значение 'UNKNOWN' используется для ещё не исследованных подсистем.
 *
 * ПОЛЯ КАЖДОЙ ЗАПИСИ:
 *   ownerDirector     {string} — директор-владелец данных подсистемы
 *   memorySection     {string} — путь в Memory (раздел данных)
 *   executor          {string} — фактический исполнитель (модуль или роль)
 *   contractCompliance {string} — уровень соответствия ARCHITECTURE_CONTRACT V3.4
 *
 * УРОВНИ СООТВЕТСТВИЯ (contractCompliance):
 *   'COMPLIANT'    — полностью соответствует контракту
 *   'PARTIAL'      — частично соответствует контракту
 *   'NON_COMPLIANT'— не соответствует контракту
 *   'UNKNOWN'      — соответствие не исследовано
 *
 * ИСПОЛЬЗОВАНИЕ (в будущих этапах реконструкции):
 *   const contracts = require('contract.registry');
 *   const rec = contracts.responsibility;
 *
 *   rec.economy.ownerDirector;     // => 'EconomyDirector'
 *   rec.economy.memorySection;     // => 'Memory.empire.economy'
 *   rec.economy.executor;          // => 'economyManager'
 *   rec.economy.contractCompliance // => 'UNKNOWN'
 */

"use strict";

/**
 * RESPONSIBILITY_CONTRACT
 *
 * Карта ответственности подсистем.
 * Ключ — идентификатор подсистемы (совпадает с разделами contract.ownership).
 */
const RESPONSIBILITY_CONTRACT = {
  /**
   * economy
   * Экономика: производство, резервы, баланс ресурсов.
   */
  economy: {
    ownerDirector: "EconomyDirector",
    memorySection: "Memory.empire.economy",
    executor: "economyManager",
    contractCompliance: "UNKNOWN",
  },

  /**
   * logistics
   * Логистика: доставки, назначения, движение ресурсов.
   */
  logistics: {
    ownerDirector: "LogisticsDirector",
    memorySection: "Memory.empire.logistics",
    executor: "logisticsDirector",
    contractCompliance: "UNKNOWN",
  },

  /**
   * market
   * Торговая политика: ордера, запреты, стратегия продаж.
   */
  market: {
    ownerDirector: "MarketDirector",
    memorySection: "Memory.empire.market",
    executor: "marketDirector",
    contractCompliance: "UNKNOWN",
  },

  /**
   * labs
   * Лаборатории: реакции, производство бустов, цепочки.
   */
  labs: {
    ownerDirector: "LabDirector",
    memorySection: "Memory.empire.labs",
    executor: "labDirector",
    contractCompliance: "UNKNOWN",
  },

  /**
   * factory
   * Фабрика: очередь, текущий заказ, состояние, статистика.
   */
  factory: {
    ownerDirector: "FactoryDirector",
    memorySection: "Memory.empire.factory",
    executor: "factoryController",
    contractCompliance: "UNKNOWN",
  },

  /**
   * military
   * Военные операции: оборона, атака.
   * Директор и исполнитель на текущем этапе не реализованы.
   */
  military: {
    ownerDirector: "MilitaryDirector",
    memorySection: "Memory.empire.military",
    executor: "UNKNOWN",
    contractCompliance: "UNKNOWN",
  },

  /**
   * diagnostics
   * Диагностика: агрегация состояний всех подсистем.
   */
  diagnostics: {
    ownerDirector: "DiagnosticsDirector",
    memorySection: "Memory.empire.diagnostics",
    executor: "diagnostics",
    contractCompliance: "UNKNOWN",
  },

  /**
   * console
   * Ручное управление: команды из консоли.
   */
  console: {
    ownerDirector: "ConsoleDirector",
    memorySection: "Memory.empire.console",
    executor: "console",
    contractCompliance: "UNKNOWN",
  },
};

module.exports = RESPONSIBILITY_CONTRACT;
