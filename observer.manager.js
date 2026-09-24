"use strict";

/**
 * РАЗВЕДКА: обсервер по очереди смотрит удалённые комнаты.
 *
 * Зачем это нужно (не «слепое» использование): зрение удалённой комнаты живёт
 * один тик, а defense.manager проверяет угрозы в E36S37/E35S38 через
 * Game.rooms[name] (defense.manager.js: REMOTE_SCAN_ROOMS). Без observeRoom эти
 * комнаты видны только когда там стоит наш крип, поэтому обход по кругу
 * (ROOMS[Game.time % ROOMS.length]) оставлен как есть — менять его частоту
 * значило бы резать покрытие обнаружения угроз.
 *
 * ЧТО ОПТИМИЗИРОВАНО (CPU). Прежняя реализация каждый тик строила
 * `Object.values(Game.structures).filter(s => s.structureType === OBSERVER)` —
 * это полный обход ВСЕХ наших структур во всех видимых комнатах (включая
 * сотни дорог, стен и валов) ради одной структуры. Живой замер shard3: бакет
 * observerManager 0.397 мс/тик (max 0.679) при полезной работе — одном вызове
 * observeRoom раз в 2 тика.
 *
 * Теперь обсервер берётся из УЖЕ существующего кэша структур (scanner.js,
 * global._structureCache, TTL 1000 тиков, поле observerId). Кэш к этому моменту
 * гарантированно построен: empire.js вызывает roomManager.run() (шаг 3) раньше
 * observerManager (шаг 4), а roomState каждой своей комнаты строит кэш через
 * scanner.ensureStructureCache. Нового кэша не заводим — только повторно
 * используем существующий.
 *
 * Найденный id запоминается в heap и проверяется одним Game.getObjectById за
 * тик: если обсервер уничтожили, запись сбрасывается и поиск повторяется.
 */

const scanner = require("./scanner");

const ROOMS = ["E36S37", "E35S38"];

/**
 * Обсервер из кэша структур комнат (без обхода Game.structures).
 * @returns {Object|null}
 */
function findObserver() {
  const cachedId = global._observerId;
  if (cachedId) {
    const live = Game.getObjectById(cachedId);
    if (live) return live;
    // Обсервер уничтожен (или id устарел после правки структур) — ищем заново.
    global._observerId = null;
  }

  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (!room.controller || !room.controller.my) continue;

    const cache = scanner.getStructureCache(room);
    if (!cache || !cache.observerId) continue;

    const observer = Game.getObjectById(cache.observerId);
    if (observer) {
      global._observerId = cache.observerId;
      return observer;
    }
  }

  return null;
}

module.exports = {
  run: function () {
    const observer = findObserver();
    if (!observer) return;

    const roomName = ROOMS[Game.time % ROOMS.length];

    /** @type {any} */ (observer).observeRoom(roomName);
  },
};
