/**
 * ===================================================
 * FACTORYCONTROLLER.JS — Промышленный исполнитель (room-level)
 * ===================================================
 * VERSION: 1.0
 * Industrial Runtime Execution Layer.
 *
 * НАЗНАЧЕНИЕ:
 * - Исполняет factory tasks из FactoryDirector
 * - Вызывает factory.produce()
 * - Управляет runtime execution
 * - Обновляет execution status
 *
 * СИСТЕМА НЕ:
 * - принимает strategic decisions
 * - анализирует economy
 * - строит production queues
 * - назначает задачи
 * - управляет market
 * - управляет logistics
 * - хранит production strategy
 * - меняет priorities
 * - сканирует все комнаты
 *
 * DESIGN: per-room — вызывается из roomManager для каждой комнаты.
 *
 * INPUTS:
 * factoryDirector.getTask(room.name)
 * factoryDirector.hasTask(room.name)
 *
 * OUTPUTS:
 * Memory.empire.factory.rooms[roomName].status
 *
 * STATUS FLOW:
 * queued → producing
 * queued → cooldown        (factory на cooldown)
 * queued → waiting_input   (нет сырья)
 * queued → error           (нет фабрики или ошибка API)
 * ===================================================
 */

const factoryDirector = require("./factoryDirector");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Статусы выполнения задачи.
 * Обновляются в Memory.empire.factory.rooms[roomName].status
 */
const STATUS = {
  QUEUED: "queued", // задача назначена, ждёт выполнения
  PRODUCING: "producing", // factory.produce() вызван успешно
  COOLDOWN: "cooldown", // фабрика на cooldown — ждём
  WAITING_INPUT: "waiting_input", // нет сырья — ждём логистику
  DONE: "done", // производство завершено
  ERROR: "error", // ошибка: нет фабрики или API error
};

/**
 * Минимальное количество сырья для запуска produce().
 * Соответствует MIN_INPUT_AMOUNT в FactoryDirector.
 */
const MIN_INPUT_AMOUNT = 1000;

/**
 * Карта: что нужно как сырьё для производства ресурса.
 * Battery производится из energy (10:1).
 * Energy производится из battery (1:10).
 *
 * FactoryController не знает о стратегии — только о физике производства.
 */
const INPUT_MAP = {
  [RESOURCE_BATTERY]: RESOURCE_ENERGY,
  [RESOURCE_ENERGY]: RESOURCE_BATTERY,
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const factoryController = {
  /**
   * Главная точка входа — per-room execution.
   * Вызывается из roomManager.run(room) для каждой нашей комнаты.
   *
   * Алгоритм:
   * 1. Проверяем наличие задачи от FactoryDirector
   * 2. Проверяем наличие фабрики в комнате
   * 3. Проверяем cooldown
   * 4. Проверяем сырьё
   * 5. Вызываем factory.produce()
   * 6. Обновляем status
   *
   * @param {Room} room — объект комнаты Screeps
   */
  run: function (room) {
    // ── ШАГ 1: ПРОВЕРКА ЗАДАЧИ ────────────────────────────────────────────
    // FactoryDirector — единственный источник задач.
    // Если задачи нет — нечего исполнять.
    if (!factoryDirector.hasTask(room.name)) {
      // Нет задачи — обновляем статус если была предыдущая запись
      this._setStatus(room.name, STATUS.DONE);
      return;
    }

    const task = factoryDirector.getTask(room.name);

    // ── ШАГ 2: ПРОВЕРКА ФАБРИКИ ───────────────────────────────────────────
    // Ищем фабрику в комнате — она может ещё строиться.
    const factory = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY,
    })[0];

    if (!factory) {
      this._setStatus(room.name, STATUS.ERROR);
      if (Game.time % 100 === 0) {
        console.log(`[FactoryController] ❌ ${room.name}: фабрика не найдена`);
      }
      return;
    }

    // ── ШАГ 3: ПРОВЕРКА COOLDOWN ──────────────────────────────────────────
    // factory.cooldown — количество тиков до следующего produce().
    // Пока cooldown > 0 — ждём, статус = cooldown.
    if (factory.cooldown > 0) {
      this._setStatus(room.name, STATUS.COOLDOWN);
      return;
    }

    // ── ШАГ 4: ПРОВЕРКА СЫРЬЯ ────────────────────────────────────────────
    // Проверяем наличие input ресурса в фабрике.
    // НЕ вызываем produce() если сырья нет.
    const inputResource = INPUT_MAP[task.resource];

    if (inputResource) {
      const inputAmount = factory.store[inputResource] || 0;

      if (inputAmount < MIN_INPUT_AMOUNT) {
        this._setStatus(room.name, STATUS.WAITING_INPUT);
        if (Game.time % 100 === 0) {
          console.log(
            `[FactoryController] ⏳ ${room.name}: ждём сырьё` +
              ` ${inputResource} (есть: ${inputAmount}, нужно: ${MIN_INPUT_AMOUNT})`,
          );
        }
        return;
      }
    }

    // ── ШАГ 5: EXECUTION ──────────────────────────────────────────────────
    // Все проверки пройдены — запускаем производство.
    const result = factory.produce(task.resource);

    // ── ШАГ 6: RESULT HANDLING ────────────────────────────────────────────
    if (result === OK) {
      this._setStatus(room.name, STATUS.PRODUCING);
      if (Game.time % 100 === 0) {
        console.log(
          `[FactoryController] ✅ ${room.name}: производство` +
            ` ${task.resource} x${task.amount} [${task.priority}]`,
        );
      }
    } else if (result === ERR_TIRED) {
      // factory.produce() вернул ERR_TIRED — cooldown только что начался
      this._setStatus(room.name, STATUS.COOLDOWN);
    } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
      // Сырья не хватило — несмотря на проверку выше
      // (могло измениться между тиками)
      this._setStatus(room.name, STATUS.WAITING_INPUT);
    } else {
      // Неожиданная ошибка API
      this._setStatus(room.name, STATUS.ERROR);
      console.log(
        `[FactoryController] ❌ ${room.name}: ошибка produce()` +
          ` ${task.resource} → код ${result}`,
      );
    }
  },

  /**
   * Обновляет статус в Memory.empire.factory.rooms[roomName].
   * FactoryController владеет только полем status —
   * остальные поля (task, assignedAt) принадлежат FactoryDirector.
   *
   * @param {string} roomName
   * @param {string} status — одно из STATUS.*
   */
  _setStatus: function (roomName, status) {
    // Защита: Memory.empire.factory может не существовать
    // если FactoryDirector ещё не запускался
    if (
      !Memory.empire ||
      !Memory.empire.factory ||
      !Memory.empire.factory.rooms ||
      !Memory.empire.factory.rooms[roomName]
    ) {
      return;
    }

    Memory.empire.factory.rooms[roomName].status = status;
    Memory.empire.factory.rooms[roomName].updatedAt = Game.time;
  },

  // ── ПУБЛИЧНОЕ API ────────────────────────────────────────────────────────

  /**
   * Получить текущий статус фабрики в комнате.
   *
   * @param {string} roomName
   * @returns {string|null}
   */
  getStatus: function (roomName) {
    if (
      !Memory.empire ||
      !Memory.empire.factory ||
      !Memory.empire.factory.rooms
    )
      return null;
    const data = Memory.empire.factory.rooms[roomName];
    return data ? data.status : null;
  },
};

module.exports = factoryController;
