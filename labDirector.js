/**
 * ===================================================
 * LABDIRECTOR.JS — Стратегический планировщик boost economy
 * ===================================================
 * VERSION: 1.0
 * Strategic Boost Planning Layer.
 *
 * НАЗНАЧЕНИЕ:
 * - Читает текущие конфиги лаб из room.memory.labs/labs2/labs3...
 * - Анализирует что варится vs что нужно по EconomyManager
 * - Публикует стратегический план в Memory.empire.labs
 * - Выявляет дефицит входных минералов
 *
 * СИСТЕМА НЕ:
 * - не трогает labManager.js
 * - не запускает runReaction()
 * - не двигает ресурсы
 * - не управляет крипами
 * - не меняет room.memory.labs конфиги
 *
 * INPUTS:
 * room.memory.labs / labs2 / labs3 / labs4 / labs5
 * economyManager.getState(resource)
 * economyManager.isCritical(resource)
 * empireResourceRegistry.getInRoom(resource, roomName)
 *
 * OUTPUTS:
 * Memory.empire.labs
 *
 * ИНТЕГРАЦИЯ:
 * Работает ПОВЕРХ существующего labManager.js.
 * labManager.js продолжает работать как раньше — без изменений.
 * LabDirector только наблюдает и публикует аналитику.
 * ===================================================
 */

const economyManager = require("./economyManager");
const empireResourceRegistry = require("./empireResourceRegistry");

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────

/**
 * Интервал пересчёта.
 * Offset +4 — после Registry(+0), Economy(+1), Factory(+2), Logistics(+3).
 */
const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 4;

const LAB_VERSION = 1;

/**
 * Ключи конфигов лаб в room.memory.
 * labManager поддерживает до 5 троек.
 */
const LAB_CONFIG_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];

/**
 * Минимальное количество входного минерала для работы реакции.
 * Если меньше — реакция голодает.
 */
const MIN_REAGENT_AMOUNT = 500;

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const labDirector = {
  /**
   * Главная точка входа.
   * Вызывать из main.js после logisticsDirector.run().
   */
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.plan();
  },

  /**
   * Анализирует все комнаты с лабами.
   * Публикует в Memory.empire.labs.
   */
  plan: function () {
    const startCpu = Game.cpu.getUsed();

    const roomAnalysis = {};
    let totalReactions = 0;
    let criticalMissing = 0;
    let starvedCount = 0;

    // Анализируем только свои комнаты
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const mem = room.memory;

      // Собираем все активные конфиги троек лаб
      const activeConfigs = [];
      for (const key of LAB_CONFIG_KEYS) {
        if (mem[key] && mem[key].product) {
          activeConfigs.push({ key, config: mem[key] });
        }
      }

      if (activeConfigs.length === 0) continue;

      // Анализируем каждую тройку
      const reactions = [];

      for (const { key, config } of activeConfigs) {
        const product = config.product;
        const reagent1 = config.reagent1;
        const reagent2 = config.reagent2;

        // Состояние продукта по EconomyManager
        const productState = economyManager.getState(product);
        const isCritical = economyManager.isCritical(product);
        const priority = isCritical
          ? "high"
          : productState && productState.state === "low"
          ? "normal"
          : "low";

        // Проверяем наличие реагентов в комнате
        const r1Amount = empireResourceRegistry.getInRoom(reagent1, roomName);
        const r2Amount = empireResourceRegistry.getInRoom(reagent2, roomName);

        const r1Starved = r1Amount < MIN_REAGENT_AMOUNT;
        const r2Starved = r2Amount < MIN_REAGENT_AMOUNT;
        const isStarved = r1Starved || r2Starved;

        if (isStarved) starvedCount++;
        if (isCritical && isStarved) criticalMissing++;

        reactions.push({
          slot: key, // какой слот (labs, labs2...)
          product, // что варим
          reagent1, // первый реагент
          reagent2, // второй реагент
          r1Amount, // сколько есть реагента 1
          r2Amount, // сколько есть реагента 2
          priority, // приоритет по EconomyManager
          isCritical, // критический дефицит продукта?
          isStarved, // голодает ли реакция?
          productTotal: productState ? productState.total : 0,
          productTarget: productState ? productState.reserveTarget : 0,
        });

        totalReactions++;
      }

      roomAnalysis[roomName] = {
        reactions,
        reactionCount: reactions.length,
        starvedCount: reactions.filter(r => r.isStarved).length,
        criticalCount: reactions.filter(r => r.isCritical).length,
        updatedAt: Game.time,
      };
    }

    // ── ПУБЛИКАЦИЯ ────────────────────────────────────────────────────────
    const planDuration = Game.cpu.getUsed() - startCpu;

    Memory.empire.labs = {
      rooms: roomAnalysis,
    };

    Memory.empire.labsMeta = {
      version: LAB_VERSION,
      generatedAt: Game.time,
      totalReactions,
      starvedCount,
      criticalMissing,
      planDuration: Math.round(planDuration * 1000) / 1000,
    };

    // Throttled logging — раз в 100 тиков
    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[LabDirector] 🧪 Анализ: ${totalReactions} реакций` +
          ` | Голодают: ${starvedCount}` +
          ` | Critical+голодают: ${criticalMissing}` +
          ` | CPU: ${planDuration.toFixed(3)}ms`,
      );

      // Выводим голодающие критические реакции
      for (const [roomName, data] of Object.entries(roomAnalysis)) {
        for (const r of data.reactions) {
          if (r.isCritical && r.isStarved) {
            // console.log(
            //   `[LabDirector] 🚨 ${roomName} [${r.slot}]:` +
            //     ` ${r.product} CRITICAL + голодает` +
            //     ` (${r.reagent1}:${r.r1Amount} ${r.reagent2}:${r.r2Amount})`,
            // );
          }
        }
      }
    }
  },

  // ── ПУБЛИЧНОЕ API ─────────────────────────────────────────────────────────

  /**
   * Получить анализ лаб для комнаты.
   * @param {string} roomName
   * @returns {Object|null}
   */
  getReaction: function (roomName) {
    const labs = Memory.empire && Memory.empire.labs;
    if (!labs || !labs.rooms) return null;
    return labs.rooms[roomName] || null;
  },

  /**
   * Проверить есть ли активные реакции в комнате.
   * @param {string} roomName
   * @returns {boolean}
   */
  hasReaction: function (roomName) {
    const data = this.getReaction(roomName);
    return data ? data.reactionCount > 0 : false;
  },

  /**
   * Получить все реакции по всем комнатам.
   * @returns {Object}
   */
  getAllReactions: function () {
    const labs = Memory.empire && Memory.empire.labs;
    if (!labs || !labs.rooms) return {};
    return labs.rooms;
  },

  /**
   * Получить метаданные последнего планирования.
   * @returns {Object}
   */
  getMeta: function () {
    return (Memory.empire && Memory.empire.labsMeta) || {};
  },
};

module.exports = labDirector;
