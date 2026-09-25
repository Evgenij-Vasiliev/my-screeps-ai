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
 * Целевую комнату назначает remote.manager (assignTargetRoom) — единая точка
 * назначения для всех дальних ролей; список комнат — Memory.empire.remoteRooms.
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
module.exports = {
  run: function (creep) {
    /**
     * 1. ЦЕЛЕВАЯ КОМНАТА
     *
     * Назначает ТОЛЬКО remote.manager (assignTargetRoom) — единая точка
     * назначения для всех дальних ролей. Пока свободной комнаты нет
     * (пре-спавн поставил замену раньше смерти предшественника, и обе комнаты
     * ещё заняты), резервер ждёт и ничего не делает — так же, как remote.miner.
     *
     * Хэш-fallback по имени убран: он выдавал комнату вслепую и мог закрепить
     * обе замены за одной и той же комнатой, а непустой targetRoom в
     * remote.manager больше не пересматривается — ошибка оставалась на всю
     * жизнь крипа, и вторая удалённая комната стояла без работника.
     */
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) return;

    /**
     * 2. ПЕРЕХОД В ЦЕЛЕВУЮ КОМНАТУ
     *
     * Путь кэширует сам Traveler (creep.memory._travel); при смене
     * комнаты кэш сбрасывается ниже, чтобы пережить границу.
     *
     * Идём к запомненной позиции контроллера, а не к точке (25,25): иначе
     * цель подменялась бы центром комнаты при каждом пересечении границы и
     * крип разворачивался бы на кромке (разбор общего механизма —
     * docs/REMOTE-BORDER-PING-PONG.md).
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

      const controllerPos = creep.memory.controllerPos;

      creep.travelTo(
        controllerPos
          ? new RoomPosition(controllerPos.x, controllerPos.y, targetRoom)
          : new RoomPosition(25, 25, targetRoom),
      );
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

    // Позиция контроллера запоминается (только при изменении, чтобы не
    // дёргать сериализацию Memory каждый тик): по ней резервер идёт в
    // удалённую комнату с любой стороны, не сворачивая к её центру.
    const knownControllerPos = creep.memory.controllerPos;

    if (
      !knownControllerPos ||
      knownControllerPos.x !== controller.pos.x ||
      knownControllerPos.y !== controller.pos.y
    ) {
      creep.memory.controllerPos = {
        x: controller.pos.x,
        y: controller.pos.y,
      };
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
