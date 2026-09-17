/**
 * ===================================================
 * ROLE.RESERVER.JS — Резервист контроллера
 * ===================================================
 * Задача: резервировать контроллер в соседней комнате.
 * Резервация не даёт контроллеру деградировать и не даёт
 * другим игрокам захватить комнату.
 *
 * Важно: reserveController работает только на ЧУЖИХ
 * (нейтральных) контроллерах, не на своих!
 * Максимум резервации: 5000 тиков.
 *
 * Управление через консоль:
 *   Memory.reserverConfig = {
 *     targetRooms: ["E35S38", "E36S37"]
 *   }
 * (по умолчанию используется список constants.REMOTE.ROOMS)
 *
 * Память крипа (creep.memory):
 * - targetRoom {string} — целевая комната
 *
 * Оптимизация CPU (замеры — docs/REMOTE-CPU-OPTIMIZATION.md):
 * вызов reserveController стоит ≈0.21 мс и раньше шёл каждый тик, даже когда
 * крип был далеко от контроллера (вызов возвращал ERR_NOT_IN_RANGE и ничего
 * не делал). Теперь сначала проверяется расстояние (isNearTo ≈0.001 мс), и
 * только рядом стоящий крип реально резервирует.
 * ===================================================
 */
const { REMOTE } = require("./constants");

module.exports = {
  run: function (creep) {
    /**
     * 1. ОПРЕДЕЛЕНИЕ ЦЕЛЕВОЙ КОМНАТЫ
     *
     * ИСПРАВЛЕНИЕ: читаем комнаты из Memory — можно менять через консоль.
     * Хэш имени крипа распределяет резервистов по комнатам равномерно.
     */
    if (!creep.memory.targetRoom) {
      const config = Memory.reserverConfig || {};
      const rooms = config.targetRooms || REMOTE.ROOMS;

      let hash = 0;
      for (let i = 0; i < creep.name.length; i++) {
        hash += creep.name.charCodeAt(i);
      }
      creep.memory.targetRoom = rooms[hash % rooms.length];
    }

    const targetRoom = creep.memory.targetRoom;

    /**
     * 2. ПЕРЕХОД В ЦЕЛЕВУЮ КОМНАТУ
     *
     * Путь кэширует сам Traveler (creep.memory._travel); при смене
     * комнаты кэш сбрасывается ниже, чтобы пережить границу.
     */
    if (creep.room.name !== targetRoom) {
      // Traveler сериализует путь только внутри комнаты, поэтому при
      // пересечении границы кэш пути сбрасывается — тот же приём, что
      // уже используется в remote.hauler и remote.miner.
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._travel;
      }
      creep.memory._lastRoom = creep.room.name;

      creep.travelTo(new RoomPosition(25, 25, targetRoom));
      return;
    }

    /**
     * 3. РАБОТА С КОНТРОЛЛЕРОМ
     *
     * ИСПРАВЛЕНИЕ: проверяем что контроллер не наш.
     * На своём контроллере reserveController не работает.
     *
     * ИСПРАВЛЕНИЕ: следим за остатком резервации.
     * Если тиков мало — говорим об этом (полезно для отладки).
     */
    const controller = creep.room.controller;

    if (!controller) {
      // В комнате нет контроллера — выбираем другую
      creep.say("❌ нет контроллера");
      delete creep.memory.targetRoom; // пересчитаем в следующем тике
      return;
    }

    // Не резервируем свои комнаты
    if (controller.my) {
      creep.say("🏠 своя комната");
      delete creep.memory.targetRoom;
      return;
    }

    /**
     * 4. РЕЗЕРВАЦИЯ КОНТРОЛЛЕРА
     *
     * Действие вызывается только когда крип уже рядом с контроллером:
     * вызов «издалека» возвращает ERR_NOT_IN_RANGE, ничего не делает, но
     * стоит как продуктивный (≈0.21 мс). Пока крип идёт — только travelTo.
     */
    if (!creep.pos.isNearTo(controller)) {
      creep.travelTo(controller);
      return;
    }

    creep.reserveController(controller);
  },
};
