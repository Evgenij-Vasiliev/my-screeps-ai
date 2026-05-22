/**
 * ===================================================
 * LABCONTROLLER.JS — Reaction Orchestration Layer
 * ===================================================
 * VERSION: 1.0
 *
 * НАЗНАЧЕНИЕ:
 * - Читает reaction plans из LabDirector
 * - Проверяет readiness лабораторий
 * - Определяет статус каждой реакции
 * - Публикует missing reagents для будущего LogisticsDirector v2
 *
 * СИСТЕМА НЕ:
 * - не двигает ресурсы
 * - не управляет крипами
 * - не вызывает creep.transfer()
 * - не вызывает runReaction() напрямую
 * - не анализирует economy самостоятельно
 * - не заменяет labManager.js
 *
 * INPUTS:
 * labDirector.getReaction(roomName)
 * room.memory.labs / labs2 / labs3 / labs4 / labs5
 * empireResourceRegistry.getInRoom(resource, roomName)
 *
 * OUTPUTS:
 * Memory.empire.labController
 *
 * STATUS LIFECYCLE:
 * queued → waiting_input  (нет реагентов)
 * queued → ready          (всё есть, лабы готовы)
 * ready  → running        (labManager активно работает)
 * ready  → cooldown       (лабы на cooldown)
 * any    → error          (лабы не найдены)
 * ===================================================
 */

const labDirector = require("./labDirector");
const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал пересчёта.
 * Offset +5 — после Registry(+0), Economy(+1), Factory(+2),
 * Logistics(+3), LabDirector(+4).
 */
const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 4;

const LAB_CONTROLLER_VERSION = 1;

/**
 * Ключи конфигов лаб в room.memory.
 */
const LAB_CONFIG_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];

/**
 * Минимальное количество реагента в комнате.
 * Если меньше — реакция в waiting_input.
 */
const MIN_REAGENT_AMOUNT = 200;

/**
 * Статусы реакции.
 */
const STATUS = {
  QUEUED: "queued",
  WAITING_INPUT: "waiting_input",
  READY: "ready",
  RUNNING: "running",
  COOLDOWN: "cooldown",
  ERROR: "error",
};

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const labController = {
  /**
   * Главная точка входа.
   * Вызывать из main.js после labDirector.run().
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.orchestrate();
  },

  /**
   * Orchestrates reaction readiness для всех комнат.
   * Читает конфиги из room.memory — не делает find() каждый тик.
   */
  orchestrate: function () {
    const startCpu = Game.cpu.getUsed();

    const roomStatuses = {};
    let waitingCount = 0;
    let readyCount = 0;
    let runningCount = 0;
    let errorCount = 0;

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const mem = room.memory;

      // Собираем все активные конфиги троек
      const activeConfigs = [];
      for (const key of LAB_CONFIG_KEYS) {
        if (mem[key] && mem[key].product) {
          activeConfigs.push({ key, config: mem[key] });
        }
      }

      if (activeConfigs.length === 0) continue;

      // Анализируем каждую тройку
      const slotStatuses = [];

      for (const { key, config } of activeConfigs) {
        const slotStatus = this._checkSlot(roomName, key, config);
        slotStatuses.push(slotStatus);

        // Счётчики
        if (slotStatus.status === STATUS.WAITING_INPUT) waitingCount++;
        else if (slotStatus.status === STATUS.READY) readyCount++;
        else if (slotStatus.status === STATUS.RUNNING) runningCount++;
        else if (slotStatus.status === STATUS.ERROR) errorCount++;
      }

      // Собираем все missing reagents по комнате
      const allMissing = [];
      for (const s of slotStatuses) {
        for (const m of s.missing) {
          if (!allMissing.includes(m)) allMissing.push(m);
        }
      }

      // Общий статус комнаты — наихудший из слотов
      const roomStatus = this._worstStatus(slotStatuses.map(s => s.status));

      roomStatuses[roomName] = {
        status: roomStatus,
        slots: slotStatuses,
        missing: allMissing,
        updatedAt: Game.time,
      };
    }

    // ── ПУБЛИКАЦИЯ ────────────────────────────────────────────────────────
    const duration = Game.cpu.getUsed() - startCpu;

    Memory.empire.labController = {
      rooms: roomStatuses,
    };

    Memory.empire.labControllerMeta = {
      version: LAB_CONTROLLER_VERSION,
      generatedAt: Game.time,
      waitingCount,
      readyCount,
      runningCount,
      errorCount,
      planDuration: Math.round(duration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков
    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[LabController] ⚗️  Orchestration:` +
          ` waiting=${waitingCount} ready=${readyCount}` +
          ` running=${runningCount} error=${errorCount}` +
          ` | CPU: ${duration.toFixed(3)}ms`,
      );

      // Логируем waiting_input с missing reagents
      for (const [roomName, data] of Object.entries(roomStatuses)) {
        if (data.missing.length > 0) {
          console.log(
            `[LabController] ⏳ ${roomName}: ждём реагенты` +
              ` [${data.missing.join(", ")}]`,
          );
        }
      }
    }
  },

  /**
   * Проверяет один слот (тройку лаб) на готовность.
   *
   * @param {string} roomName
   * @param {string} key — 'labs', 'labs2'...
   * @param {object} config — конфиг тройки
   * @returns {object} { slot, product, status, missing, cooldown }
   */
  _checkSlot: function (roomName, key, config) {
    const product = config.product;
    const reagent1 = config.reagent1;
    const reagent2 = config.reagent2;

    const result = {
      slot: key,
      product,
      reagent1,
      reagent2,
      status: STATUS.QUEUED,
      missing: [],
      cooldown: 0,
    };

    // ── ПРОВЕРКА ЛАБ ─────────────────────────────────────────────────────
    // Читаем из Memory — не делаем find() каждый тик
    const lab1 = Game.getObjectById(config.lab1);
    const lab2 = Game.getObjectById(config.lab2);
    const reactor = Game.getObjectById(config.reactor);

    if (!lab1 || !lab2 || !reactor) {
      result.status = STATUS.ERROR;
      return result;
    }

    // ── ПРОВЕРКА COOLDOWN ─────────────────────────────────────────────────
    if (reactor.cooldown > 0) {
      result.status = STATUS.COOLDOWN;
      result.cooldown = reactor.cooldown;
      return result;
    }

    // ── ПРОВЕРКА РЕАГЕНТОВ ────────────────────────────────────────────────
    // Проверяем в самих лабах (lab1, lab2) — там реагенты должны быть
    // для запуска реакции. Если лаба пуста — смотрим в комнате.

    const r1InLab = lab1.store[reagent1] || 0;
    const r2InLab = lab2.store[reagent2] || 0;

    // Также проверяем наличие в комнате (storage/terminal)
    const r1InRoom = empireResourceRegistry.getInRoom(reagent1, roomName);
    const r2InRoom = empireResourceRegistry.getInRoom(reagent2, roomName);

    const r1Available = r1InLab + r1InRoom;
    const r2Available = r2InLab + r2InRoom;

    if (r1Available < MIN_REAGENT_AMOUNT) {
      result.missing.push(reagent1);
    }
    if (r2Available < MIN_REAGENT_AMOUNT) {
      result.missing.push(reagent2);
    }

    if (result.missing.length > 0) {
      result.status = STATUS.WAITING_INPUT;
      return result;
    }

    // ── ПРОВЕРКА RUNNING ──────────────────────────────────────────────────
    // Если в реакторе уже есть продукт — реакция идёт
    const productInReactor = reactor.store[product] || 0;
    const r1InLabActive = lab1.store[reagent1] > 0;
    const r2InLabActive = lab2.store[reagent2] > 0;

    if (r1InLabActive && r2InLabActive) {
      result.status = STATUS.RUNNING;
      return result;
    }

    // Всё есть — готовы к реакции
    result.status = STATUS.READY;
    return result;
  },

  /**
   * Определяет наихудший статус из списка.
   * Приоритет: error > waiting_input > cooldown > queued > ready > running
   *
   * @param {string[]} statuses
   * @returns {string}
   */
  _worstStatus: function (statuses) {
    const priority = {
      [STATUS.ERROR]: 6,
      [STATUS.WAITING_INPUT]: 5,
      [STATUS.COOLDOWN]: 4,
      [STATUS.QUEUED]: 3,
      [STATUS.READY]: 2,
      [STATUS.RUNNING]: 1,
    };

    return statuses.reduce((worst, s) => {
      return (priority[s] || 0) > (priority[worst] || 0) ? s : worst;
    }, STATUS.RUNNING);
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  /**
   * Получить статус лаб для комнаты.
   * @param {string} roomName
   * @returns {Object|null}
   */
  getStatus: function (roomName) {
    const lc = Memory.empire && Memory.empire.labController;
    if (!lc || !lc.rooms) return null;
    return lc.rooms[roomName] || null;
  },

  /**
   * Проверить готовы ли лабы к реакции.
   * @param {string} roomName
   * @returns {boolean}
   */
  isReady: function (roomName) {
    const data = this.getStatus(roomName);
    return data ? data.status === STATUS.READY : false;
  },

  /**
   * Получить список отсутствующих реагентов для комнаты.
   * Используется будущим LogisticsDirector v2.
   * @param {string} roomName
   * @returns {string[]}
   */
  getMissing: function (roomName) {
    const data = this.getStatus(roomName);
    return data ? data.missing : [];
  },

  /**
   * Получить статусы всех комнат.
   * @returns {Object}
   */
  getAllStatuses: function () {
    const lc = Memory.empire && Memory.empire.labController;
    if (!lc || !lc.rooms) return {};
    return lc.rooms;
  },

  /**
   * Метаданные последнего orchestration.
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.labControllerMeta) || {};
  },
};

module.exports = labController;
