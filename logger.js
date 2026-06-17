/**
 * ===================================================
 * LOGGER.JS — Центральный логгер империи
 * ===================================================
 * VERSION: 1.0
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const Logger = require("logger");
 *   Logger.info("Module", "сообщение");
 *   Logger.warn("Module", "предупреждение");
 *   Logger.error("Module", "ошибка");
 *   Logger.event("тип", "комната", "описание", { ctx });
 *
 * УПРАВЛЕНИЕ из консоли:
 *   require("logger").diagOn()           — включить отладку
 *   require("logger").diagOff()          — выключить отладку
 *   require("logger").setThrottle(50)    — интервал между одинаковыми логами
 *   require("logger").clearHistory()     — очистить историю throttle
 *   require("logger").clearEvents()      — очистить историю событий
 *   require("logger").getEvents(null,20) — последние N событий
 *   require("logger").getEvents("E35S37") — события конкретной комнаты
 * ===================================================
 */

const MEMORY_KEY = "logger";
const DEFAULT_THROTTLE = 50;
const MAX_HISTORY = 100;
const MAX_EVENTS = 100;

const PREFIX = {
  diag: "🔍 [DIAG]",
  info: "ℹ️  [INFO]",
  warn: "⚠️  [WARN]",
  error: "❌ [ERROR]",
};

const Logger = {
  // ── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────────────────────
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

  // ── THROTTLE ─────────────────────────────────────────────────────────────
  // Одинаковое сообщение не спамит чаще чем раз в throttle тиков
  _canLog: function (key) {
    const cfg = this._cfg();
    const lastTick = cfg.history[key] || 0;
    if (Game.time - lastTick < cfg.throttle) return false;
    cfg.history[key] = Game.time;
    // Чистим старые записи если история разрослась
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
        .map(([k, v]) => k + "=" + v)
        .join(" ")
    );
  },

  _log: function (level, module, message, ctx, force) {
    const cfg = this._cfg();
    if (level === "diag" && !cfg.diagEnabled) return;
    const key = level + ":" + module + ":" + message;
    if (!force && !this._canLog(key)) return;
    console.log(
      PREFIX[level] + " [" + module + "] " + message + this._formatCtx(ctx),
    );
  },

  // ── ЛОГИРОВАНИЕ ──────────────────────────────────────────────────────────
  diag: function (module, message, ctx) {
    this._log("diag", module, message, ctx);
  },

  info: function (module, message, ctx) {
    this._log("info", module, message, ctx);
  },

  warn: function (module, message, ctx) {
    this._log("warn", module, message, ctx);
  },

  // Ошибки всегда выводятся без throttle
  error: function (module, message, ctx) {
    this._log("error", module, message, ctx, true);
  },

  // ── СОБЫТИЯ ──────────────────────────────────────────────────────────────
  /**
   * Записывает событие в Memory.events (история последних MAX_EVENTS).
   * @param {string} type    — тип события (resource_imbalance, transfer_completed и др.)
   * @param {string} room    — комната или null если глобальное
   * @param {string} message — описание
   * @param {Object} ctx     — доп. контекст (опционально)
   */
  event: function (type, room, message, ctx) {
    this._init();
    const entry = { tick: Game.time, type, room: room || null, message };
    if (ctx) entry.ctx = ctx;
    Memory.events.push(entry);
    if (Memory.events.length > MAX_EVENTS) {
      Memory.events = Memory.events.slice(-MAX_EVENTS);
    }
  },

  /**
   * Получить историю событий.
   * @param {string|null} roomName — фильтр по комнате (null = все)
   * @param {number} limit         — сколько последних (default 20)
   */
  getEvents: function (roomName, limit) {
    this._init();
    limit = limit || 20;
    let events = Memory.events || [];
    if (roomName) events = events.filter(e => e.room === roomName);
    return events.slice(-limit);
  },

  // ── УПРАВЛЕНИЕ ───────────────────────────────────────────────────────────
  diagOn: function () {
    this._cfg().diagEnabled = true;
    return "🔍 Диагностика ВКЛЮЧЕНА";
  },

  diagOff: function () {
    this._cfg().diagEnabled = false;
    return "🔍 Диагностика ВЫКЛЮЧЕНА";
  },

  setThrottle: function (ticks) {
    this._cfg().throttle = ticks;
    return "🔍 Throttle: " + ticks + " тиков";
  },

  clearHistory: function () {
    this._cfg().history = {};
    return "🔍 История throttle очищена";
  },

  clearEvents: function () {
    Memory.events = [];
    return "🔍 История событий очищена";
  },

  getConfig: function () {
    const cfg = this._cfg();
    return (
      "diagEnabled:" +
      cfg.diagEnabled +
      "  throttle:" +
      cfg.throttle +
      "  history keys:" +
      Object.keys(cfg.history).length +
      "  events:" +
      (Memory.events || []).length
    );
  },
};

module.exports = Logger;
