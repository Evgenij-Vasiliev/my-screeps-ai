/**
 * ===================================================
 * EMPIRERESOURCEREGISTRY.JS — Глобальный реестр ресурсов империи
 * ===================================================
 * VERSION: 2.0
 * Foundation Layer — основа всей economic AI architecture.
 *
 * НАЗНАЧЕНИЕ:
 * - Сканирует все комнаты под контролем ОДИН РАЗ за комнату
 * - Собирает ресурсы из ВСЕХ структур у которых есть store
 * - Строит global resource snapshot с метаданными
 * - Публикует агрегированные данные в Memory.empire.resources
 *
 * СИСТЕМА НЕ:
 * - принимает стратегических решений
 * - управляет market
 * - запускает production
 * - изменяет priorities
 * - управляет logistics
 * - считает transient cargo крипов (это noise, не strategic state)
 *
 * ИСПРАВЛЕНИЯ v2 (после архитектурного ревью):
 * 1. Один room.find() на комнату → фильтрация в JS
 * 2. Убраны hardcoded STRUCTURE_TYPES → generic store scanning
 * 3. Крипы исключены из foundation layer
 * 4. Добавлены snapshot metadata (version, generatedAt, scanDuration...)
 *
 * OWNERSHIP:
 * EmpireResourceRegistry владеет только
 * resource aggregation и global totals.
 *
 * ФОРМАТ ДАННЫХ:
 * Memory.empire.resources = {
 *   energy: {
 *     total: 500000,
 *     rooms: { W1N1: 120000, W2N3: 80000 }
 *   },
 *   silicon: { total: 12000, rooms: {...} }
 * }
 *
 * Memory.empire.resourcesMeta = {
 *   version: 2,
 *   generatedAt: 12345,
 *   roomCount: 5,
 *   scanDuration: 0.12
 * }
 * ===================================================
 */

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал полного пересчёта в тиках.
 * Запрещено делать full recalculation каждый тик — дорого для CPU.
 * Каждые 20 тиков — баланс между актуальностью и CPU.
 */
const UPDATE_INTERVAL = 20;

/**
 * Версия формата данных.
 * Увеличивать при изменении структуры Memory.empire.resources.
 * Используется для cache invalidation при деплое новой версии.
 */
const REGISTRY_VERSION = 2;

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const empireResourceRegistry = {
  /**
   * Главная точка входа.
   * Вызывать ОДИН РАЗ за тик из main.js (из первой комнаты).
   *
   * Стратегия обновления:
   * - Полный пересчёт раз в UPDATE_INTERVAL тиков
   * - В остальные тики — данные из кэша (Memory.empire.resources)
   */
  run: function () {
    // Инициализируем Memory.empire если не существует
    if (!Memory.empire) {
      Memory.empire = {};
    }

    // Обновляем только по расписанию — экономим CPU
    if (Game.time % UPDATE_INTERVAL !== 0) return;

    // Запускаем полный сбор данных
    this.collect();
  },

  /**
   * Собирает ресурсы из всех структур по всем комнатам.
   * Строит snapshot и записывает в Memory.empire.resources.
   *
   * КЛЮЧЕВОЕ РЕШЕНИЕ:
   * room.find(FIND_MY_STRUCTURES) вызывается ОДИН РАЗ на комнату.
   * Затем фильтруем в JS — это намного дешевле повторных find().
   *
   * GENERIC SCANNING:
   * Не перечисляем типы структур явно.
   * Проверяем if (structure.store) — работает для любой структуры
   * с инвентарём: Storage, Terminal, Factory, Lab, PowerSpawn, Nuker
   * и любых будущих структур.
   */
  collect: function () {
    // Засекаем время для scanDuration metadata
    const startCpu = Game.cpu.getUsed();

    // Итоговый объект ресурсов
    // Формат: { resourceType: { total: N, rooms: { roomName: N } } }
    const resources = {};

    // Получаем все наши комнаты
    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my,
    );

    // ── СКАНИРОВАНИЕ СТРУКТУР ──────────────────────────────────────────────
    for (const room of ourRooms) {
      // ОДИН вызов find() на всю комнату — дешевле повторных вызовов
      const allStructures = room.find(FIND_MY_STRUCTURES);

      for (const structure of allStructures) {
        // Generic check: есть ли у структуры инвентарь?
        // Работает для Storage, Terminal, Factory, Lab, PowerSpawn, Nuker
        // и любых будущих структур — не нужно перечислять типы явно.
        if (!structure.store) continue;

        // Перебираем все ресурсы внутри структуры
        for (const resourceType in structure.store) {
          const amount = structure.store[resourceType] || 0;
          if (amount === 0) continue;

          this._addToRegistry(resources, resourceType, room.name, amount);
        }
      }
    }

    // ── METADATA ──────────────────────────────────────────────────────────
    // Метаданные snapshot — для debugging, profiling, cache invalidation.
    // Крипы намеренно исключены: их cargo — transient hauling noise,
    // не strategic state. Foundation layer хранит только stable data.
    const scanDuration = Game.cpu.getUsed() - startCpu;

    Memory.empire.resources = resources;
    Memory.empire.resourcesMeta = {
      version: REGISTRY_VERSION, // версия формата данных
      generatedAt: Game.time, // тик последнего обновления
      roomCount: ourRooms.length, // сколько комнат просканировано
      scanDuration: Math.round(scanDuration * 1000) / 1000, // CPU в ms
    };

    // Логируем только раз в 100 тиков чтобы не засорять консоль
    if (Game.time % 100 === 0) {
      console.log(
        `[EmpireRegistry] 📊 Обновлено: ${Object.keys(resources).length}` +
          ` типов ресурсов из ${ourRooms.length} комнат` +
          ` | CPU: ${scanDuration.toFixed(3)}ms (тик ${Game.time})`,
      );
    }
  },

  /**
   * Вспомогательный метод — добавляет amount ресурса в реестр.
   * Создаёт структуру если её ещё нет.
   *
   * @param {Object} registry — общий объект реестра
   * @param {string} resourceType — тип ресурса
   * @param {string} roomName — имя комнаты
   * @param {number} amount — количество
   */
  _addToRegistry: function (registry, resourceType, roomName, amount) {
    if (!registry[resourceType]) {
      registry[resourceType] = { total: 0, rooms: {} };
    }

    registry[resourceType].total += amount;

    if (!registry[resourceType].rooms[roomName]) {
      registry[resourceType].rooms[roomName] = 0;
    }
    registry[resourceType].rooms[roomName] += amount;
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────
  // Методы для чтения данных другими системами (EconomyManager и т.д.)

  /**
   * Весь текущий snapshot ресурсов.
   * @returns {Object} Memory.empire.resources или {}
   */
  getResources: function () {
    return (Memory.empire && Memory.empire.resources) || {};
  },

  /**
   * Суммарное количество ресурса по всей империи.
   * @param {string} resourceType
   * @returns {number}
   */
  getTotal: function (resourceType) {
    const resources = this.getResources();
    return resources[resourceType] ? resources[resourceType].total : 0;
  },

  /**
   * Количество ресурса в конкретной комнате.
   * @param {string} resourceType
   * @param {string} roomName
   * @returns {number}
   */
  getInRoom: function (resourceType, roomName) {
    const resources = this.getResources();
    if (!resources[resourceType]) return 0;
    return resources[resourceType].rooms[roomName] || 0;
  },

  /**
   * Метаданные последнего snapshot.
   * Используется для debugging и cache invalidation.
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.resourcesMeta) || {};
  },
};

module.exports = empireResourceRegistry;
