/**
 * contracts/ownership.js
 *
 * Машинное представление Ownership Contract.
 * Источник: ARCHITECTURE_CONTRACT V3.4, раздел 4 "Владельцы данных".
 *
 * НАЗНАЧЕНИЕ:
 *   Единый источник истины для определения владельцев разделов Memory.
 *
 * ПРАВИЛА:
 *   - Этот файл только объявляет владельцев. Он не запускает никакой логики.
 *   - Этот файл не вызывается из существующего кода (не подключён в main.js).
 *   - Этот файл не создаёт и не изменяет Memory.
 *   - Запись в раздел Memory разрешена ТОЛЬКО владельцу (OWNER).
 *   - Чтение разрешено всем модулям без ограничений.
 *
 * ИСПОЛЬЗОВАНИЕ (в будущих этапах реконструкции):
 *   const ownership = require('contracts/ownership');
 *   const owner = ownership.economy.owner; // => 'EconomyDirector'
 *   const path  = ownership.economy.path;  // => 'Memory.empire.economy'
 */

"use strict";

/**
 * OWNERSHIP_CONTRACT
 *
 * Объект с описанием владельцев данных.
 * Каждый раздел содержит:
 *   - owner {string}       — строковый идентификатор директора-владельца
 *   - path  {string}       — полный путь в Memory
 *   - description {string} — краткое назначение раздела
 */
const OWNERSHIP_CONTRACT = {
  /**
   * empire
   * Верхний уровень стратегической памяти империи.
   * OWNER: EmpireDirector
   */
  empire: {
    owner: "EmpireDirector",
    path: "Memory.empire",
    description: "Корневой раздел стратегической политики империи.",
  },

  /**
   * economy
   * Экономика: производство, резервы, баланс энергии.
   * OWNER: EconomyDirector
   */
  economy: {
    owner: "EconomyDirector",
    path: "Memory.empire.economy",
    description: "Экономические решения, производство, резервы.",
  },

  /**
   * logistics
   * Логистика: движение ресурсов, доставки, назначения.
   * OWNER: LogisticsDirector
   */
  logistics: {
    owner: "LogisticsDirector",
    path: "Memory.empire.logistics",
    description: "Доставки, назначения исполнителей, запросы ресурсов.",
  },

  /**
   * market
   * Торговая политика: ордера, запреты, стратегия.
   * OWNER: MarketDirector
   */
  market: {
    owner: "MarketDirector",
    path: "Memory.empire.market",
    description: "Торговая политика, ордера на покупку и продажу.",
  },

  /**
   * labs
   * Лаборатории: реакции, бусты, производственные цепочки.
   * OWNER: LabDirector
   */
  labs: {
    owner: "LabDirector",
    path: "Memory.empire.labs",
    description: "Лабораторные реакции, производство бустов.",
  },

  /**
   * factory
   * Фабрика: очередь, текущий заказ, статистика.
   * OWNER: FactoryDirector
   */
  factory: {
    owner: "FactoryDirector",
    path: "Memory.empire.factory",
    description: "Очередь фабрики, текущий заказ, состояние, статистика.",
  },

  /**
   * military
   * Военные операции: оборона, атака.
   * OWNER: MilitaryDirector
   */
  military: {
    owner: "MilitaryDirector",
    path: "Memory.empire.military",
    description: "Военные операции, оборона, атака.",
  },

  /**
   * diagnostics
   * Агрегированная диагностика всей империи.
   * OWNER: DiagnosticsDirector
   */
  diagnostics: {
    owner: "DiagnosticsDirector",
    path: "Memory.empire.diagnostics",
    description:
      "Состояние, предупреждения, ошибки, рекомендации всех подсистем.",
  },

  /**
   * console
   * Ручное управление из консоли.
   * OWNER: ConsoleDirector
   */
  console: {
    owner: "ConsoleDirector",
    path: "Memory.empire.console",
    description: "Команды ручного управления через консоль.",
  },
};

module.exports = OWNERSHIP_CONTRACT;
