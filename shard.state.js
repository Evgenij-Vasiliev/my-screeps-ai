/**
 * ===================================================
 * SHARD.STATE.JS — игровое состояние шарда в Memory
 * ===================================================
 * Аудит, п. 10 / дорожная карта, задача 12: «вынести хардкод комнат/линков в
 * Memory с текущими значениями как defaults».
 *
 * ЧТО БЫЛО. Комнаты, ID линков, клетки контейнеров, маршруты дальних ролей,
 * список обхода обсервера, комнаты риска и точка сбора были захардкожены:
 * часть в constants.js (REMOTE), часть прямо в потребителях (observer.manager,
 * defense.manager, defense.attacker). Перестройка линка или добавление
 * удалённой комнаты требовала правки кода, а не Memory, и ломала поведение
 * МОЛЧА (перестройка линка уводила хайлера в storage-фолбэк без единой строки
 * в консоли).
 *
 * ЧТО СТАЛО. Единственный рантайм-источник правды — Memory.empire:
 *
 *   Memory.empire = {
 *     version: 1,
 *     homeRoom: "E35S37",
 *     remoteRooms: ["E35S38", "E36S37"],
 *     remoteLinks: { E36S37: "…", E35S38: "…" },
 *     remoteContainerPos: { E35S38: {x,y}, E36S37: {x,y} },
 *     remoteRouteTicks: { remoteMiner: {…}, remoteHauler: {…}, reserver: {…} },
 *     observerScanRooms: ["E36S37", "E35S38"],
 *     highRiskRooms: ["E36S37", "E35S38"],
 *     remoteScanRooms: ["E36S37", "E35S38"],
 *     rally: { room: "E35S37", x: 39, y: 45 },
 *     // hostileRooms ведёт Traveler (см. traveler.js) — не наше поле, не трогаем
 *   }
 *
 * Значения по умолчанию — ТЕКУЩИЕ значения из constants (REMOTE, EMPIRE), то
 * есть первый деплой поведения не меняет: empire.js вызывает ensure() каждый
 * тик, и на первом тике Memory.empire заполняется прежними числами. Дальше
 * значения правятся из консоли игры, без правки кода и деплоя.
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ. Модуль читает/инициализирует только СОСТОЯНИЕ
 * (что где стоит). Настройки-константы (интервалы проверок, ёмкости, safety
 * margin, ключи памяти крипа) остаются в constants/*: их правка — это правка
 * алгоритма, а не перестройка структур.
 *
 * УСТОЙЧИВОСТЬ. Все аксессоры защитные: Memory может быть не инициализирован
 * (первый тик / Global Reset), поле может отсутствовать или иметь неверный тип
 * (ручная правка) — тогда возвращается default, а не undefined. ensure() пишет
 * только ОТСУТСТВУЮЩИЕ ключи и никогда не перезаписывает правку владельца.
 * ===================================================
 */
const {
  REMOTE,
  EMPIRE,
  CREEP_BODIES,
  PRESPAWN_THRESHOLD,
} = require("./constants");
// Маршруты дальних ролей намеренно НЕ в barrel (tests/module.barrel.test.js),
// поэтому берём их из доменного модуля: это default для
// Memory.empire.remoteRouteTicks.
const { REMOTE_ROUTE_TICKS } = require("./constants/creeps");

/** Корень состояния в Memory (его же использует Traveler для hostileRooms). */
const STATE_KEY = "empire";

/** Версия схемы. Меняется при несовместимой правке структуры полей. */
const STATE_VERSION = 1;

/** Роли дальнего контура: их порог пре-спавна считается от удалённых комнат. */
const REMOTE_ROLES = {
  reserver: true,
  remoteMiner: true,
  remoteHauler: true,
};

/** Движок тратит столько тиков на одну часть тела (неизменная константа). */
const SPAWN_TICKS_PER_PART = 3;

// ── КОПИРОВАНИЕ DEFAULTS ─────────────────────────────────────────────────
// ensure() обязан отдать Memory КОПИИ, а не ссылки на объекты constants: иначе
// правка Memory.empire.remoteRooms.push(...) мутировала бы сам конфиг и
// «дефолт» переставал бы быть дефолтом.
/**
 * @param {Object} map
 * @returns {Object}
 */
function clonePositions(map) {
  const out = {};
  for (const room in map) out[room] = { x: map[room].x, y: map[room].y };
  return out;
}

/**
 * @param {Object} map
 * @returns {Object}
 */
function cloneRouteTicks(map) {
  const out = {};
  for (const role in map) {
    out[role] = {};
    for (const room in map[role]) out[role][room] = map[role][room];
  }
  return out;
}

/** @param {Object} value @returns {boolean} */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ── ЧТЕНИЕ MEMORY ────────────────────────────────────────────────────────
/**
 * Объект состояния из Memory или null (не инициализирован / битый тип).
 * @returns {Object|null}
 */
function state() {
  if (typeof Memory === "undefined" || !Memory) return null;
  const value = Memory[STATE_KEY];
  return isPlainObject(value) ? value : null;
}

// ── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────────────────────
/**
 * Заполняет отсутствующие ключи Memory.empire текущими значениями из constants.
 * Идемпотентна, вызывается каждый тик (empire.js); уже существующие значения
 * владельца НЕ перезаписываются.
 * @returns {Object|null} состояние
 */
function ensure() {
  if (typeof Memory === "undefined" || !Memory) return null;
  if (!isPlainObject(Memory[STATE_KEY])) Memory[STATE_KEY] = {};
  const s = Memory[STATE_KEY];

  if (s.version === undefined) s.version = STATE_VERSION;

  if (typeof s.homeRoom !== "string" || !s.homeRoom) {
    s.homeRoom = REMOTE.HOME_ROOM;
  }
  if (!Array.isArray(s.remoteRooms)) s.remoteRooms = REMOTE.ROOMS.slice();
  if (!isPlainObject(s.remoteLinks)) {
    s.remoteLinks = Object.assign({}, REMOTE.ROOM_TO_LINK);
  }
  if (!isPlainObject(s.remoteContainerPos)) {
    s.remoteContainerPos = clonePositions(REMOTE.ROOM_TO_CONTAINER_POS);
  }
  if (!isPlainObject(s.remoteRouteTicks)) {
    s.remoteRouteTicks = cloneRouteTicks(REMOTE_ROUTE_TICKS);
  }
  if (!Array.isArray(s.observerScanRooms)) {
    s.observerScanRooms = EMPIRE.OBSERVER_SCAN_ROOMS.slice();
  }
  if (!Array.isArray(s.highRiskRooms)) {
    s.highRiskRooms = EMPIRE.HIGH_RISK_ROOMS.slice();
  }
  if (!Array.isArray(s.remoteScanRooms)) {
    s.remoteScanRooms = EMPIRE.REMOTE_SCAN_ROOMS.slice();
  }
  if (!isPlainObject(s.rally)) {
    s.rally = {
      room: EMPIRE.RALLY.room,
      x: EMPIRE.RALLY.x,
      y: EMPIRE.RALLY.y,
    };
  }

  return s;
}

// ── АКСЕССОРЫ ────────────────────────────────────────────────────────────
/** @returns {string} домашняя комната империи */
function homeRoom() {
  const s = state();
  const value = s && s.homeRoom;
  return typeof value === "string" && value ? value : REMOTE.HOME_ROOM;
}

/** @returns {string[]} удалённые комнаты (пустой список допустим) */
function remoteRooms() {
  const s = state();
  return s && Array.isArray(s.remoteRooms) ? s.remoteRooms : REMOTE.ROOMS;
}

/**
 * ID линка у границы домашней комнаты для удалённой комнаты.
 * @param {string} targetRoom
 * @returns {string|null}
 */
function remoteLink(targetRoom) {
  const s = state();
  const map =
    s && isPlainObject(s.remoteLinks) ? s.remoteLinks : REMOTE.ROOM_TO_LINK;
  const id = map[targetRoom];
  return typeof id === "string" && id ? id : null;
}

/**
 * Настроенная клетка контейнера у источника в удалённой комнате.
 * @param {string} targetRoom
 * @returns {{x: number, y: number}|null}
 */
function remoteContainerPos(targetRoom) {
  const s = state();
  const map =
    s && isPlainObject(s.remoteContainerPos)
      ? s.remoteContainerPos
      : REMOTE.ROOM_TO_CONTAINER_POS;
  const cell = map[targetRoom];
  return cell && typeof cell.x === "number" && typeof cell.y === "number"
    ? cell
    : null;
}

/** @returns {Object} карта «роль → комната → тиков маршрута» */
function remoteRouteTicks() {
  const s = state();
  return s && isPlainObject(s.remoteRouteTicks)
    ? s.remoteRouteTicks
    : REMOTE_ROUTE_TICKS;
}

/** @returns {string[]} комнаты обхода обсервера */
function observerScanRooms() {
  const s = state();
  return s && Array.isArray(s.observerScanRooms)
    ? s.observerScanRooms
    : EMPIRE.OBSERVER_SCAN_ROOMS;
}

/** @returns {string[]} комнаты повышенного риска (проверяются первыми) */
function highRiskRooms() {
  const s = state();
  return s && Array.isArray(s.highRiskRooms)
    ? s.highRiskRooms
    : EMPIRE.HIGH_RISK_ROOMS;
}

/** @returns {string[]} удалённые комнаты, проверяемые обороной */
function remoteScanRooms() {
  const s = state();
  return s && Array.isArray(s.remoteScanRooms)
    ? s.remoteScanRooms
    : EMPIRE.REMOTE_SCAN_ROOMS;
}

/** @returns {{room: string, x: number, y: number}} точка сбора боевого крипа */
function rally() {
  const s = state();
  const value = s && s.rally;
  return isPlainObject(value) && value.room
    ? value
    : EMPIRE.RALLY;
}

// ── ПРОИЗВОДНЫЕ ЗНАЧЕНИЯ ─────────────────────────────────────────────────
/**
 * Время спавна тела роли в тиках.
 * @param {string} role
 * @returns {number}
 */
function spawnTimeOf(role) {
  const blueprint = CREEP_BODIES[role] || {};
  let parts = 0;
  for (const part in blueprint) parts += blueprint[part];
  return parts * SPAWN_TICKS_PER_PART;
}

/**
 * Самое долгое время хода роли до рабочей цели по НАСТРОЕННЫМ удалённым
 * комнатам. Комната без маршрута в Memory — конфигурационная ошибка: порог
 * пре-спавна окажется заниженным, поэтому предупреждаем один раз на роль и
 * комнату (warnOnce), а комнату в максимум не берём.
 * @param {string} role
 * @returns {number}
 */
function longestRemoteRoute(role) {
  const routes = remoteRouteTicks()[role] || {};
  const rooms = remoteRooms();
  let longest = 0;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const ticks = routes[room];
    if (typeof ticks === "number" && ticks > longest) longest = ticks;
    else if (ticks === undefined) {
      warnOnce(
        `route:${role}:${room}`,
        `[shard.state] нет маршрута в Memory.empire.remoteRouteTicks.${role}["${room}"] — ` +
          "порог пре-спавна роли занижен, до комнаты роль может не успеть",
      );
    }
  }

  return longest;
}

/**
 * Порог пре-спавна роли: спавн + дорога + запас.
 *
 * Для дальних ролей считается ОТ НАСТРОЙКИ в Memory (список комнат + маршруты),
 * поэтому добавление/смена удалённой комнаты не оставляет роль с заниженным
 * порогом. Для остальных ролей порог — плоская константа.
 * @param {string} role
 * @returns {number|undefined}
 */
function preSpawnThreshold(role) {
  if (REMOTE_ROLES[role] !== true) return PRESPAWN_THRESHOLD[role];
  return (
    spawnTimeOf(role) +
    longestRemoteRoute(role) +
    REMOTE.HANDOFF_SAFETY_MARGIN
  );
}

// ── ДИАГНОСТИКА ──────────────────────────────────────────────────────────
/**
 * Один явный лог на ключ за жизнь global (переживает тик, сбрасывается Global
 * Reset). Нужен там, где раньше был тихий фолбэк: невалидный ID линка,
 * отсутствующий маршрут. Без дедупа такие сообщения печатались бы каждый тик.
 * @param {string} key
 * @param {string} message
 */
function warnOnce(key, message) {
  if (!global._shardStateWarned) global._shardStateWarned = {};
  if (global._shardStateWarned[key]) return;
  global._shardStateWarned[key] = true;
  console.log(message);
}

module.exports = {
  STATE_KEY,
  STATE_VERSION,
  ensure,
  homeRoom,
  remoteRooms,
  remoteLink,
  remoteContainerPos,
  remoteRouteTicks,
  observerScanRooms,
  highRiskRooms,
  remoteScanRooms,
  rally,
  preSpawnThreshold,
  warnOnce,
};
