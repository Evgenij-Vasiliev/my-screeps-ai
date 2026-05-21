/**
 * ===================================================
 * FACTORYCONTROLLER.JS — Промышленный исполнитель (room-level)
 * ===================================================
 * VERSION: 1.1
 * Industrial Runtime Execution Layer.
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - MIN_INPUT_AMOUNT снижен с 1000 до 200.
 *   Ранее фабрика простаивала при 964 energy (не хватало 36 единиц).
 *   200 достаточно для одного цикла produce() — 10 energy = 1 battery.
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

const STATUS = {
  QUEUED: "queued",
  PRODUCING: "producing",
  COOLDOWN: "cooldown",
  WAITING_INPUT: "waiting_input",
  DONE: "done",
  ERROR: "error",
};

/**
 * Минимальное количество сырья для запуска produce().
 *
 * ИЗМЕНЕНО v1.1: 1000 → 200.
 * Причина: фабрика простаивала при 964 energy в store.
 * 200 достаточно для нескольких циклов produce().
 * Delivery Worker доставит ещё пока фабрика работает.
 */
const MIN_INPUT_AMOUNT = 200;

/**
 * Карта: что нужно как сырьё для производства ресурса.
 */
const INPUT_MAP = {
  [RESOURCE_BATTERY]: RESOURCE_ENERGY,
  [RESOURCE_ENERGY]: RESOURCE_BATTERY,
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const factoryController = {
  /**
   * Главная точка входа — per-room execution.
   * Вызывается из roomManager.run(room).
   *
   * @param {Room} room
   */
  run: function (room) {
    // ── ШАГ 1: ПРОВЕРКА ЗАДАЧИ ────────────────────────────────────────────
    if (!factoryDirector.hasTask(room.name)) {
      this._setStatus(room.name, STATUS.DONE);
      return;
    }

    const task = factoryDirector.getTask(room.name);

    // ── ШАГ 2: ПРОВЕРКА ФАБРИКИ ───────────────────────────────────────────
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
    if (factory.cooldown > 0) {
      this._setStatus(room.name, STATUS.COOLDOWN);
      return;
    }

    // ── ШАГ 4: ПРОВЕРКА СЫРЬЯ ─────────────────────────────────────────────
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
      this._setStatus(room.name, STATUS.COOLDOWN);
    } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
      this._setStatus(room.name, STATUS.WAITING_INPUT);
    } else {
      this._setStatus(room.name, STATUS.ERROR);
      console.log(
        `[FactoryController] ❌ ${room.name}: ошибка produce()` +
          ` ${task.resource} → код ${result}`,
      );
    }
  },

  /**
   * Обновляет статус в Memory.empire.factory.rooms[roomName].
   * @param {string} roomName
   * @param {string} status
   */
  _setStatus: function (roomName, status) {
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

  /**
   * Получить текущий статус фабрики в комнате.
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
