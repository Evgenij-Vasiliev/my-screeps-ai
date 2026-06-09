// =============================================================================
// empireDirector.js — Верхний уровень управления империей (Каркас V3)
// =============================================================================
// РОЛЬ: Единственный источник стратегических решений.
//       Координирует всех директоров. Не управляет крипами напрямую.
// СТАТУС: Каркас. Логика режимов не реализована. Только структура.
// =============================================================================

// --- Импорт реальных директоров ---
const economyManager = require("economyManager");
const logisticsDirector = require("logisticsDirector");
const marketDirector = require("marketDirector");
const labDirector = require("labDirector");
const diagnostics = require("diagnostics");
const consoleDirector = require("console");

// --- Заглушки для директоров, которых ещё нет ---
// MilitaryDirector — управление обороной и атакой (не реализован)
const militaryDirector = {
  run: function () {
    // TODO: реализовать MilitaryDirector
  },
};

// ExpansionDirector — управление расширением империи (не реализован)
const expansionDirector = {
  run: function () {
    // TODO: реализовать ExpansionDirector
  },
};

// =============================================================================
// POLICY LAYER — Глобальные политики империи
// Хранятся в Memory.empire.policy
// Являются входными данными для всех директоров.
// Директора читают политику, но НЕ меняют её самостоятельно.
// =============================================================================

/**
 * Инициализирует структуру Memory.empire при первом запуске.
 * Если структура уже есть — не трогает.
 */
function initMemory() {
  // Создаём корневую структуру если её нет
  if (!Memory.empire) {
    Memory.empire = {};
  }

  // --- Режим империи ---
  // Определяет текущий стратегический приоритет.
  // Поддерживаемые значения: 'normal' | 'growth' | 'survival' | 'war'
  // Изменяется только через EmpireDirector или ConsoleDirector.
  if (!Memory.empire.mode) {
    Memory.empire.mode = "normal";
  }

  // --- Policy Layer ---
  // Набор флагов и параметров, которые читают все директора.
  // Директора НЕ меняют политику — только читают.
  if (!Memory.empire.policy) {
    Memory.empire.policy = {
      // Экономическая политика
      growth: {
        enabled: true, // Разрешён ли активный рост (апгрейд Controller)
        spawnPriority: "economy", // Приоритет спавна: 'economy' | 'military' | 'expansion'
      },

      // Политика выживания
      survival: {
        enabled: false, // Режим выживания: жёсткая экономия ресурсов
        minEnergyReserve: 5000, // Минимальный запас энергии в Storage
      },

      // Военная политика
      military: {
        enabled: true, // Разрешено ли использовать боевых крипов
        defensePriority: "auto", // 'auto' | 'high' | 'low'
      },

      // Политика расширения
      expansion: {
        enabled: false, // Разрешено ли захватывать новые комнаты
        maxRooms: 3, // Максимальное количество контролируемых комнат
      },

      // Рыночная политика
      market: {
        enabled: true, // Разрешено ли торговать на рынке
        sellSurplus: true, // Продавать ли излишки ресурсов
        buyCritical: true, // Покупать ли критически нужные ресурсы
      },
    };
  }
}

// =============================================================================
// РЕЕСТР ДИРЕКТОРОВ
// Все директора регистрируются здесь.
// EmpireDirector вызывает их в нужном порядке каждый тик.
// =============================================================================

/**
 * Реестр директоров с их метаданными.
 * enabled: false — директор зарегистрирован, но не вызывается.
 * stub: true    — реальной реализации ещё нет (заглушка).
 */
const DIRECTORS = [
  {
    name: "ConsoleDirector",
    // ConsoleDirector всегда первый — обрабатывает ручные команды
    // до того, как остальные директора примут решения
    module: consoleDirector,
    enabled: true,
    stub: false,
  },
  {
    name: "DiagnosticsDirector",
    // Диагностика запускается в начале тика — собирает состояние
    module: diagnostics,
    enabled: true,
    stub: false,
  },
  {
    name: "EconomyDirector",
    module: economyManager,
    enabled: true,
    stub: false,
  },
  {
    name: "LogisticsDirector",
    module: logisticsDirector,
    enabled: true,
    stub: false,
  },
  {
    name: "MarketDirector",
    module: marketDirector,
    enabled: true,
    stub: false,
  },
  {
    name: "LabDirector",
    module: labDirector,
    enabled: true,
    stub: false,
  },
  {
    name: "MilitaryDirector",
    module: militaryDirector,
    enabled: false, // Отключён до реализации
    stub: true,
  },
  {
    name: "ExpansionDirector",
    module: expansionDirector,
    enabled: false, // Отключён до реализации
    stub: true,
  },
];

// =============================================================================
// РЕЖИМЫ ИМПЕРИИ (структура, без реализации поведения)
// =============================================================================
// В будущем каждый режим будет менять политики в Memory.empire.policy.
// Сейчас — только описание структуры.

const EMPIRE_MODES = {
  // Стандартный режим: баланс роста и стабильности
  normal: {
    description: "Стандартный режим. Баланс роста и стабильности.",
    // TODO: определить какие policy включены в этом режиме
  },
  // Режим роста: максимальный апгрейд Controller, экспансия разрешена
  growth: {
    description: "Активный рост. Приоритет — апгрейд Controller и расширение.",
    // TODO: policy.growth.enabled = true, policy.expansion.enabled = true
  },
  // Режим выживания: жёсткая экономия, только критически важные крипы
  survival: {
    description: "Выживание. Минимум крипов, максимум резервов.",
    // TODO: policy.survival.enabled = true, policy.market.sellSurplus = false
  },
  // Военный режим: приоритет обороны и боевых крипов
  war: {
    description: "Война. Приоритет — оборона и боевые крипы.",
    // TODO: policy.military.defensePriority = 'high'
  },
};

// =============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// Вызывается из main.js один раз за тик.
// =============================================================================

/**
 * Точка входа EmpireDirector.
 * Вызывать из main.js: empireDirector.run()
 *
 * Порядок работы:
 * 1. Инициализировать структуру Memory (один раз при первом запуске)
 * 2. Прочитать текущий режим империи
 * 3. Вызвать всех включённых директоров в порядке реестра
 */
function run() {
  // Шаг 1: Инициализация Memory при первом запуске
  initMemory();

  // Шаг 2: Читаем текущий режим (в будущем будет влиять на поведение)
  const currentMode = Memory.empire.mode || "normal";
  // TODO: применять режим к политикам — пока только структура

  // Шаг 3: Вызов директоров в порядке реестра
  for (const director of DIRECTORS) {
    // Пропускаем отключённые директора
    if (!director.enabled) continue;

    // Проверяем что модуль реальный и имеет метод run()
    if (!director.module || typeof director.module.run !== "function") {
      // Директор зарегистрирован, но не имеет метода run() — пропускаем
      continue;
    }

    // Запускаем директора
    // Оборачиваем в try/catch: сбой одного директора не должен
    // остановить работу всей империи
    try {
      director.module.run();
    } catch (e) {
      console.log(`[EmpireDirector] ОШИБКА в ${director.name}: ${e.message}`);
    }
  }
}

// =============================================================================
// ПУБЛИЧНОЕ API
// =============================================================================

module.exports = {
  // Главная функция — вызывать из main.js каждый тик
  run,

  // Доступ к реестру директоров (для диагностики и ConsoleDirector)
  getDirectors: function () {
    return DIRECTORS.map(d => ({
      name: d.name,
      enabled: d.enabled,
      stub: d.stub,
    }));
  },

  // Доступ к текущему режиму и политике (для диагностики)
  getState: function () {
    return {
      mode: Memory.empire ? Memory.empire.mode : "не инициализировано",
      policy: Memory.empire ? Memory.empire.policy : null,
    };
  },
};
