/**
 * ===================================================
 * LABS.AUTOCONFIG.JS — Lab AutoConfig Layer
 * ===================================================
 * VERSION: 1.0 — Phase 2
 *
 * НАЗНАЧЕНИЕ:
 * - Читает Memory.labPlanner.needs
 * - Находит свободные тройки лаб
 * - Назначает конфиги для закрытия needs
 *
 * СИСТЕМА НЕ:
 * - не вызывает terminal.send / transfer
 * - не запускает workers
 * - не вызывает runReaction()
 * - не очищает лабы от ресурсов
 * - не трогает X-tier тройки
 *
 * ПРАВИЛО СВОБОДНОЙ ТРОЙКИ:
 * 1. нет memory (тройка не настроена)
 * 2. варит продукт которого нет в planner.needs И не X-tier
 * 3. пустая/неактивная
 *
 * X-TIER ЗАЩИТА:
 * Тройки варящие XLHO2, XKHO2, XKH2O и др. X-продукты — неприкосновенны.
 *
 * INPUTS:
 * - Memory.labPlanner (от labs.planner.js)
 * - Memory.rooms[*].labs*
 *
 * OUTPUTS:
 * - Memory.rooms[*].labs* (только свободные тройки)
 * - Memory.labAutoConfig (лог назначений)
 * ===================================================
 */

// Ключи конфигов лаб
const LAB_CONFIG_KEYS = ["labs", "labs2", "labs3", "labs4", "labs5"];

// X-tier продукты — никогда не трогать
const X_TIER = new Set([
  "XLHO2",
  "XKHO2",
  "XZHO2",
  "XKH2O",
  "XUHO2",
  "XGHO2",
  "XUH2O",
  "XZH2O",
  "XGH2O",
  "XLH2O",
  "XKHO2",
  "XUHO2",
  "XLHO2",
]);

// Граф реакций: product → [reagent1, reagent2]
const REACTIONS = {
  // T2
  LHO2: ["LO", "OH"],
  KHO2: ["KH", "OH"],
  ZHO2: ["ZO", "OH"],
  KH2O: ["KO", "OH"],
  UHO2: ["UO", "OH"],
  GHO2: ["GO", "OH"],
  UH2O: ["UO", "OH"],
  ZH2O: ["ZO", "OH"],
  GH2O: ["GO", "OH"],
  // T1
  OH: ["O", "H"],
  LO: ["L", "O"],
  KH: ["K", "H"],
  KO: ["K", "O"],
  ZO: ["Z", "O"],
  UO: ["U", "O"],
  GO: ["G", "O"],
  ZK: ["Z", "K"],
  UH: ["U", "H"],
  LH: ["L", "H"],
  GH: ["G", "H"],
};

// Интервал пересчёта
const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 7; // после labsPlanner (+6)

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const labsAutoConfig = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.configure();
  },

  configure: function () {
    const startCpu = Game.cpu.getUsed();

    const planner = Memory.labPlanner;
    if (!planner || !planner.needs || planner.needs.length === 0) {
      // Нет needs — ничего не делаем
      return;
    }

    // Needs которые ещё не покрыты активными тройками
    const unmetNeeds = this._findUnmetNeeds(planner.needs);

    if (unmetNeeds.length === 0) {
      return;
    }

    // Ищем свободные тройки по всем комнатам
    const freeSlots = this._findFreeSlots(planner.needs);

    const assignments = [];
    const needsQueue = [...unmetNeeds];

    for (const slot of freeSlots) {
      if (needsQueue.length === 0) break;

      const product = needsQueue.shift();
      const recipe = REACTIONS[product];
      if (!recipe) continue;

      // Назначаем конфиг
      const newConfig = {
        lab1: slot.config.lab1,
        lab2: slot.config.lab2,
        reactor: slot.config.reactor,
        reagent1: recipe[0],
        reagent2: recipe[1],
        product: product,
        assignedBy: "autoconfig",
        assignedAt: Game.time,
      };

      Memory.rooms[slot.roomName][slot.key] = newConfig;

      assignments.push({
        roomName: slot.roomName,
        key: slot.key,
        product,
        reagent1: recipe[0],
        reagent2: recipe[1],
        prev: slot.prevProduct || null,
      });

      console.log(
        `[LabsAutoConfig] ✅ ${slot.roomName} [${slot.key}]:` +
          ` ${slot.prevProduct || "empty"} → ${product}` +
          ` (${recipe[0]} + ${recipe[1]})`,
      );
    }

    // Публикуем лог
    const duration = Game.cpu.getUsed() - startCpu;
    Memory.labAutoConfig = {
      lastRun: Game.time,
      unmetNeeds,
      assignments,
      freeSlots: freeSlots.length,
      cpu: Math.round(duration * 1000) / 1000,
    };

    if (assignments.length < unmetNeeds.length) {
      const uncovered = needsQueue;
      console.log(
        `[LabsAutoConfig] ⚠️  Не хватает свободных троек для: ${uncovered.join(
          ", ",
        )}`,
      );
    }
  },

  // ── ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ─────────────────────────────────────────────

  /**
   * Находит needs которые НЕ покрыты ни одной активной тройкой.
   * @param {string[]} needs
   * @returns {string[]}
   */
  _findUnmetNeeds: function (needs) {
    // Собираем все продукты которые сейчас варятся
    const activeProducts = new Set();
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;
      const mem = room.memory;
      for (const key of LAB_CONFIG_KEYS) {
        if (mem[key] && mem[key].product) {
          activeProducts.add(mem[key].product);
        }
      }
    }

    // Need не покрыт если никто не варит этот продукт
    return needs.filter(n => !activeProducts.has(n));
  },

  /**
   * Находит свободные тройки по всем комнатам.
   * Свободная тройка:
   * 1. нет конфига (пустая)
   * 2. варит продукт которого нет в needs И не X-tier
   * 3. нет lab1/lab2/reactor ID (неактивная)
   *
   * @param {string[]} needs — текущие needs для защиты нужных троек
   * @returns {Array} [{ roomName, key, config, prevProduct }]
   */
  _findFreeSlots: function (needs) {
    const freeSlots = [];

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const mem = room.memory;

      for (const key of LAB_CONFIG_KEYS) {
        const cfg = mem[key];

        // Нет конфига — пустой слот
        if (!cfg) continue; // нет ID лаб — не можем назначить без них

        // Нет ID лаб — неактивный слот (пропускаем — нечего назначать)
        if (!cfg.lab1 || !cfg.lab2 || !cfg.reactor) continue;

        const product = cfg.product;

        // Нет продукта — свободен
        if (!product) {
          freeSlots.push({ roomName, key, config: cfg, prevProduct: null });
          continue;
        }

        // X-tier — не трогаем никогда
        if (X_TIER.has(product)) continue;

        // Продукт всё ещё в needs — тройка занята нужной работой
        if (needs.includes(product)) continue;

        // Продукт не в needs и не X-tier — свободен
        freeSlots.push({ roomName, key, config: cfg, prevProduct: product });
      }
    }

    return freeSlots;
  },

  // ── ПУБЛИЧНОЕ API ──────────────────────────────────────────────────────

  /**
   * Последние назначения.
   * @returns {Object}
   */
  getLastRun: function () {
    return Memory.labAutoConfig || {};
  },
};

module.exports = labsAutoConfig;
