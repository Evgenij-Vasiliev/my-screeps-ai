/**
 * ===================================================
 * LOGGER.JS — Центральный логгер империи
 * ===================================================
 * VERSION: 1.1
 *
 * ИЗМЕНЕНИЯ v1.1:
 * - Добавлена запись событий в Memory.events (история)
 * - Хранится 100 последних событий
 * - Метод getEvents() для чтения истории
 *
 * ИСПОЛЬЗОВАНИЕ:
 * const Logger = require('./logger');
 * Logger.info('Module', 'сообщение', { key: value });
 * Logger.warn('Module', 'предупреждение', { key: value });
 * Logger.error('Module', 'ошибка', { key: value });
 * Logger.diag('Module', 'отладка', { key: value });
 * Logger.event('factory_blocked', 'E37S37', 'store full');
 *
 * УПРАВЛЕНИЕ:
 * Logger.diagOn()
 * Logger.diagOff()
 * Logger.setThrottle(ticks)
 * Logger.clearHistory()
 * Logger.getEvents(roomName, limit)
 * ===================================================
 */

const LEVELS = {
  diag: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const PREFIX = {
  diag: "🔍 [DIAG]",
  info: "ℹ️  [INFO]",
  warn: "⚠️  [WARN]",
  error: "❌ [ERROR]",
};

const MEMORY_KEY = "logger";
const DEFAULT_THROTTLE = 50;
const MAX_HISTORY = 100;
const MAX_EVENTS = 100;

const Logger = {
  _init: function () {
    if (!Memory[MEMORY_KEY]) {
      Memory[MEMORY_KEY] = {
        diagEnabled: false,
        throttle: DEFAULT_THROTTLE,
        history: {},
      };
    }
    if (!Memory.events) {
      Memory.events = [];
    }
  },

  _cfg: function () {
    this._init();
    return Memory[MEMORY_KEY];
  },

  _canLog: function (key) {
    const cfg = this._cfg();
    const lastTick = cfg.history[key] || 0;
    if (Game.time - lastTick < cfg.throttle) return false;
    cfg.history[key] = Game.time;
    const keys = Object.keys(cfg.history);
    if (keys.length > MAX_HISTORY) {
      keys
        .sort((a, b) => cfg.history[a] - cfg.history[b])
        .slice(0, keys.length - MAX_HISTORY)
        .forEach(k => delete cfg.history[k]);
    }
    return true;
  },

  _formatCtx: function (ctx) {
    if (!ctx || typeof ctx !== "object") return "";
    return (
      " | " +
      Object.entries(ctx)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    );
  },

  _log: function (level, module, message, ctx, force) {
    const cfg = this._cfg();
    if (level === "diag" && !cfg.diagEnabled) return;
    const key = `${level}:${module}:${message}`;
    if (!force && !this._canLog(key)) return;
    const ctxStr = this._formatCtx(ctx);
    console.log(`${PREFIX[level]} [${module}] ${message}${ctxStr}`);
  },

  // ── ЛОГИРОВАНИЕ ────────────────────────────────────────────────────────

  diag: function (module, message, ctx) {
    this._log("diag", module, message, ctx);
  },

  info: function (module, message, ctx) {
    this._log("info", module, message, ctx);
  },

  warn: function (module, message, ctx) {
    this._log("warn", module, message, ctx);
  },

  error: function (module, message, ctx) {
    this._log("error", module, message, ctx, true);
  },

  // ── СОБЫТИЯ ────────────────────────────────────────────────────────────

  /**
   * Записывает событие в Memory.events.
   * Хранится 100 последних событий — старые удаляются.
   *
   * @param {string} type    — тип события (factory_blocked, stuck_creep и др.)
   * @param {string} room    — комната (или null если глобальное)
   * @param {string} message — описание
   * @param {Object} ctx     — доп. контекст (опционально)
   */
  event: function (type, room, message, ctx) {
    this._init();

    const entry = {
      tick: Game.time,
      room: room || null,
      type,
      message,
    };

    if (ctx) entry.ctx = ctx;

    Memory.events.push(entry);

    // Храним только последние MAX_EVENTS
    if (Memory.events.length > MAX_EVENTS) {
      Memory.events = Memory.events.slice(-MAX_EVENTS);
    }
  },

  /**
   * Получить историю событий.
   *
   * @param {string|null} roomName — фильтр по комнате (null = все)
   * @param {number} limit         — сколько последних (default 20)
   * @returns {Array}
   */
  getEvents: function (roomName, limit) {
    this._init();
    limit = limit || 20;

    let events = Memory.events || [];

    if (roomName) {
      events = events.filter(e => e.room === roomName);
    }

    return events.slice(-limit);
  },

  // ── УПРАВЛЕНИЕ ────────────────────────────────────────────────────────

  diagOn: function () {
    this._cfg().diagEnabled = true;
    console.log("🔍 [LOGGER] Диагностика ВКЛЮЧЕНА");
  },

  diagOff: function () {
    this._cfg().diagEnabled = false;
    console.log("🔍 [LOGGER] Диагностика ВЫКЛЮЧЕНА");
  },

  setThrottle: function (ticks) {
    this._cfg().throttle = ticks;
    console.log(`🔍 [LOGGER] Throttle: ${ticks} тиков`);
  },

  clearHistory: function () {
    this._cfg().history = {};
    console.log("🔍 [LOGGER] История очищена");
  },

  clearEvents: function () {
    Memory.events = [];
    console.log("🔍 [LOGGER] События очищены");
  },

  getConfig: function () {
    return this._cfg();
  },
};

module.exports = Logger;
