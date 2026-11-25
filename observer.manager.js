"use strict";

/**
 * ===================================================
 * OBSERVER.MANAGER.JS — разведка дальних комнат обсервером
 * ===================================================
 * Перенесено из origin/Новая-Империя:observer.manager.js с одной адаптацией:
 * списка комнат берётся из constants.js (DEFENSE.OBSERVER_SCAN_ROOMS), а не из
 * Memory.empire — в текущей ветке нет дальнего контура, которому нужно
 * состояние в Memory.
 *
 * Зачем нужен обсервер. Зрение удалённой комнаты живёт один тик, а
 * defense.manager проверяет угрозы через Game.rooms[name]. Без observeRoom
 * E36S37/E35S38 видны только тогда, когда там стоит наш крип. Обход по кругу
 * (одна комната за тик) — прежняя частота из рабочей ветки: она даёт каждую
 * комнату раз в 2 тика и не режет покрытие.
 *
 * Почему не Game.structures. В текущей ветке уже есть кэш структур scanner.js
 * (heap, TTL CACHE.REFRESH_INTERVAL). Полный обход Game.structures ради одной
 * структуры обходил бы все дороги, стены и валы империи; здесь берём
 * observerId из готового кэша. Найденный id запоминается в heap и проверяется
 * одним Game.getObjectById за тик; уничтоженный обсервер сбрасывает кэш.
 * ===================================================
 */

const scanner = require("scanner");
const { DEFENSE } = require("./constants");

/**
 * Обсервер из кэша структур своих комнат (без обхода Game.structures).
 * @returns {StructureObserver|null}
 */
function findObserver() {
  const cachedId = global._observerId;
  if (cachedId) {
    const live = Game.getObjectById(cachedId);
    if (live) return live;
    // Обсервер уничтожен или id устарел после перестройки — ищем заново.
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

    // Пустой список = разведка выключена владельцем; деление по модулю на
    // ноль недопустимо.
    const rooms = DEFENSE.OBSERVER_SCAN_ROOMS;
    if (!Array.isArray(rooms) || rooms.length === 0) return;

    const roomName = rooms[Game.time % rooms.length];
    if (!roomName) return;

    observer.observeRoom(roomName);
  },
};
