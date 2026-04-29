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
 *
 * Память крипа (creep.memory):
 * - targetRoom {string} — целевая комната
 * ===================================================
 */
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
      const rooms = config.targetRooms || ["E35S38", "E36S37"];

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
     * reusePath: 50 — путь между комнатами стабилен, кэшируем надолго.
     */
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50,
        visualizePathStyle: { stroke: "#00ff00" },
      });
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

    // Показываем остаток резервации каждые 20 тиков
    if (Game.time % 20 === 0) {
      const ticks = controller.reservation
        ? controller.reservation.ticksToEnd
        : 0;
      creep.say(`🔒 ${ticks}т`);
    }

    // Резервируем контроллер
    const result = creep.reserveController(controller);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, {
        reusePath: 20,
        visualizePathStyle: { stroke: "#00ff00" },
      });
    }
  },
};
