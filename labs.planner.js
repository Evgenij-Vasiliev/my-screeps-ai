/**
 * ===================================================
 * LABS.PLANNER.JS — Lab Production Chain Planner
 * ===================================================
 * VERSION: 1.0 — Phase 1: Foundation
 *
 * НАЗНАЧЕНИЕ:
 * - Читает активные конфиги лаб из room.memory.labs*
 * - Строит граф зависимостей по текущим продуктам
 * - Считает запасы по всей империи
 * - Находит bottleneck (чего не хватает)
 * - Публикует результат в Memory.labPlanner
 *
 * СИСТЕМА НЕ:
 * - не меняет room.memory.labs*
 * - не запускает terminal
 * - не запускает workers
 * - не вызывает runReaction()
 * - не переключает продукты
 *
 * INPUTS:
 * - Memory.rooms[*].labs / labs2 / labs3 / labs4 / labs5
 * - room.storage.store
 * - room.terminal.store
 * - lab структуры через Game.getObjectById
 *
 * OUTPUTS:
 * - Memory.labPlanner = {
 *     targets: [...],       // конечные продукты из активных конфигов
 *     needs: [...],         // чего не хватает для производства
 *     chain: { product: [reagent1, reagent2] },  // граф зависимостей
 *     stock: { resource: amount },               // запасы по империи
 *     bottlenecks: [...],   // критические дефициты
 *     updatedAt: Game.time
 *   }
 * ===================================================
 */

// ── ХИМИЯ SCREEPS — только то что нужно для текущих цепочек ───────────────
// Граф реакций: product → [reagent1, reagent2]
// Добавлять только по мере появления в конфигах лаб.

const REACTIONS = {
  // T3 (конечные boost'ы)
  XLHO2: ["LHO2", "X"],
  XKHO2: ["KHO2", "X"],
  XZHO2: ["ZHO2", "X"],
  XKH2O: ["KH2O", "X"],
  XUHO2: ["UHO2", "X"],
  XGHO2: ["GHO2", "X"],
  XUH2O: ["UH2O", "X"],
  XZH2O: ["ZH2O", "X"],
  XGH2O: ["GH2O", "X"],

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

// Минимальный запас для считать "есть в наличии"
const MIN_STOCK = 200;

// Интервал пересчёта
const UPDATE_INTERVAL = 20;
const UPDATE_OFFSET = 6; // после LabController (+5)

// Ключи конфигов лаб
const LAB_CONFIG_KEYS = [
  "labs",
  "labs2",
  "labs3",
  "labs4",
  "labs5",
  "boostLab",
];

// ── МОДУЛЬ ─────────────────────────────────────────────────────────────────

const labsPlanner = {
  run: function () {
    if (!Memory.empire) Memory.empire = {};
    if (Game.time % UPDATE_INTERVAL !== UPDATE_OFFSET) return;
    this.plan();
  },

  plan: function () {
    const startCpu = Game.cpu.getUsed();

    // 1. Собираем целевые продукты из активных конфигов
    const targets = this._collectTargets();

    // 2. Строим граф зависимостей только по активным продуктам
    const chain = this._buildChain(targets);

    // 3. Считаем запасы по всей империи
    const stock = this._countStock();

    // 4. Находим что нужно произвести (needs) и bottlenecks
    const { needs, bottlenecks } = this._analyze(chain, stock);

    // 5. Публикуем
    const duration = Game.cpu.getUsed() - startCpu;

    Memory.labPlanner = {
      targets,
      needs,
      chain,
      stock,
      bottlenecks,
      updatedAt: Game.time,
      cpu: Math.round(duration * 1000) / 1000,
    };

    // Логируем раз в 100 тиков
    if (Game.time % 100 <= UPDATE_OFFSET) {
      console.log(
        `[LabsPlanner] 🔬 Targets: ${targets.length}` +
          ` | Needs: ${needs.length}` +
          ` | Bottlenecks: ${bottlenecks.length}` +
          ` | CPU: ${duration.toFixed(3)}ms`,
      );
      if (bottlenecks.length > 0) {
        console.log(`[LabsPlanner] 🚨 Bottlenecks: ${bottlenecks.join(", ")}`);
      }
    }
  },

  // ── СБОР ЦЕЛЕВЫХ ПРОДУКТОВ ─────────────────────────────────────────────

  /**
   * Читает все активные конфиги лаб по всем комнатам.
   * Возвращает уникальный список продуктов.
   */
  _collectTargets: function () {
    const targets = new Set();

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      const mem = room.memory;
      for (const key of LAB_CONFIG_KEYS) {
        if (mem[key] && mem[key].product) {
          targets.add(mem[key].product);
        }
      }
    }

    return Array.from(targets);
  },

  // ── ГРАФ ЗАВИСИМОСТЕЙ ──────────────────────────────────────────────────

  /**
   * Строит полный граф зависимостей для списка продуктов.
   * Рекурсивно раскрывает все промежуточные продукты.
   * @param {string[]} targets
   * @returns {Object} { product: [reagent1, reagent2] }
   */
  _buildChain: function (targets) {
    const chain = {};
    const visited = new Set();

    const expand = product => {
      if (visited.has(product)) return;
      visited.add(product);

      const recipe = REACTIONS[product];
      if (!recipe) return; // сырьё — нет рецепта

      chain[product] = recipe;
      expand(recipe[0]);
      expand(recipe[1]);
    };

    for (const target of targets) {
      expand(target);
    }

    return chain;
  },

  // ── ПОДСЧЁТ ЗАПАСОВ ────────────────────────────────────────────────────

  /**
   * Считает суммарные запасы всех ресурсов по всей империи.
   * Смотрит: storage, terminal, labs (lab1, lab2, reactor).
   * @returns {Object} { resource: totalAmount }
   */
  _countStock: function () {
    const stock = {};

    const add = (resource, amount) => {
      if (!amount || amount <= 0) return;
      stock[resource] = (stock[resource] || 0) + amount;
    };

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      // Storage
      if (room.storage) {
        for (const res in room.storage.store) {
          add(res, room.storage.store[res]);
        }
      }

      // Terminal
      if (room.terminal) {
        for (const res in room.terminal.store) {
          add(res, room.terminal.store[res]);
        }
      }

      // Лабы — читаем из конфигов
      const mem = room.memory;
      for (const key of LAB_CONFIG_KEYS) {
        if (!mem[key]) continue;
        const cfg = mem[key];

        const lab1 = cfg.lab1 ? Game.getObjectById(cfg.lab1) : null;
        const lab2 = cfg.lab2 ? Game.getObjectById(cfg.lab2) : null;
        const reactor = cfg.reactor ? Game.getObjectById(cfg.reactor) : null;

        if (lab1) for (const res in lab1.store) add(res, lab1.store[res]);
        if (lab2) for (const res in lab2.store) add(res, lab2.store[res]);
        if (reactor)
          for (const res in reactor.store) add(res, reactor.store[res]);
      }
    }

    return stock;
  },

  // ── АНАЛИЗ ДЕФИЦИТОВ ───────────────────────────────────────────────────

  /**
   * Анализирует граф зависимостей и запасы.
   * Возвращает:
   *   needs      — все ресурсы которых не хватает (включая промежуточные)
   *   bottlenecks — сырьё или продукты которые блокируют всю цепочку
   * @param {Object} chain
   * @param {Object} stock
   * @returns {{ needs: string[], bottlenecks: string[] }}
   */
  _analyze: function (chain, stock) {
    const needs = [];
    const bottlenecks = [];

    // Все ресурсы в графе (продукты + реагенты)
    const allResources = new Set();
    for (const product in chain) {
      allResources.add(product);
      chain[product].forEach(r => allResources.add(r));
    }

    for (const resource of allResources) {
      const available = stock[resource] || 0;
      if (available < MIN_STOCK) {
        needs.push(resource);

        // Bottleneck — ресурс которого нет И нет рецепта для производства
        // (т.е. сырьё или T1 которое не варится)
        if (!chain[resource]) {
          bottlenecks.push(resource);
        }
      }
    }

    return { needs, bottlenecks };
  },

  // ── ПУБЛИЧНОЕ API ──────────────────────────────────────────────────────

  /**
   * Нужен ли ресурс (в дефиците)?
   * @param {string} resource
   * @returns {boolean}
   */
  isNeeded: function (resource) {
    const p = Memory.labPlanner;
    return p ? p.needs.includes(resource) : false;
  },

  /**
   * Является ли ресурс bottleneck?
   * @param {string} resource
   * @returns {boolean}
   */
  isBottleneck: function (resource) {
    const p = Memory.labPlanner;
    return p ? p.bottlenecks.includes(resource) : false;
  },

  /**
   * Получить все текущие потребности.
   * @returns {string[]}
   */
  getNeeds: function () {
    const p = Memory.labPlanner;
    return p ? p.needs : [];
  },

  /**
   * Получить все bottlenecks.
   * @returns {string[]}
   */
  getBottlenecks: function () {
    const p = Memory.labPlanner;
    return p ? p.bottlenecks : [];
  },

  /**
   * Получить целевые продукты.
   * @returns {string[]}
   */
  getTargets: function () {
    const p = Memory.labPlanner;
    return p ? p.targets : [];
  },

  /**
   * Получить запас ресурса по империи.
   * @param {string} resource
   * @returns {number}
   */
  getStock: function (resource) {
    const p = Memory.labPlanner;
    return p && p.stock ? p.stock[resource] || 0 : 0;
  },
};

module.exports = labsPlanner;
