/**
 * ===================================================
 * ROLE.RESERVER.JS — резервист контроллера удалённой комнаты
 * ===================================================
 * Задача: держать резервацию контроллера в нейтральной комнате. Резервация не
 * даёт контроллеру деградировать, не даёт другим игрокам захватить комнату и —
 * главное для экономики — поднимает ёмкость источника в комнате: в нейтральной
 * комнате SOURCE_ENERGY_NEUTRAL_CAPACITY 1500, после резервации источник отдаёт
 * 3000 (SOURCE_ENERGY_CAPACITY), то есть поток с него растёт с 5/тик до 10/тик.
 *
 * Целевую комнату назначает remote.manager (assignTargetRoom) — единая точка
 * назначения для всех дальних ролей; список комнат — REMOTE.ROOMS (constants.js).
 *
 * Память крипа:
 * - targetRoom     {string} — целевая комната (пишет ТОЛЬКО remote.manager);
 * - controllerPos  {Object} — запомненная позиция контроллера: по ней резервер
 *   идёт в комнату с любой стороны, не сворачивая к её центру (25,25).
 *
 * МЕХАНИКА ДЕЙСТВИЯ: reserveController добавляет 1 тик резервации за 1 CLAIM-часть
 * за вызов, потолок резервации — 5000 тиков (CONTROLLER_RESERVE_MAX). У резервера
 * 2 CLAIM (CREEP_BODIES.reserver), поэтому каждый вызов — +2 тика. Пока крип жив
 * (600 тиков с CLAIM-частями) вызовов хватает с запасом, но звать его надо
 * КАЖДЫЙ тик: пропуск не «догоняется» позже, а просто теряет тик резерва.
 *
 * ПОЧЕМУ РАССТОЯНИЕ ПРОВЕРЯЕТСЯ ЗАРАНЕЕ (замер старой ветки,
 * docs/REMOTE-CPU-OPTIMIZATION.md): reserveController стоит ≈0.21 мс и раньше
 * звался каждый тик, даже когда крип был далеко от контроллера — вызов
 * возвращал ERR_NOT_IN_RANGE и ничего не делал. Теперь сначала isNearTo
 * (≈0.001 мс), и только рядом стоящий крип реально резервирует.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: room.find, creep.say и печать в горячем пути (tests/rules.test.js
 * правила 3-4). Недопустимая конфигурация (свой контроллер, комнаты нет в
 * видимости) отмечается через log.warnThrottled — ключ ограничен ролью и
 * комнатой, в обычном тике это одно сравнение Game.time.
 * ===================================================
 */

const log = require("./log");

/**
 * Куда идти, пока контроллер не виден: запомненная позиция, иначе центр
 * комнаты. Центр (25,25) — только запасной вариант для первого захода.
 *
 * @param {Object} creep
 * @param {string} targetRoom
 * @returns {RoomPosition}
 */
function travelTarget(creep, targetRoom) {
  const known = creep.memory.controllerPos;

  if (known) return new RoomPosition(known.x, known.y, targetRoom);

  return new RoomPosition(25, 25, targetRoom);
}

module.exports = {
  run: function (creep) {
    // Спавнящийся крип не может действовать: интенты всё равно отбросятся.
    if (creep.spawning) return;

    // 1. ЦЕЛЕВАЯ КОМНАТА. Назначает ТОЛЬКО remote.manager (assignTargetRoom).
    // Пока свободного слота нет (пре-спавн поставил замену раньше смерти
    // предшественника, и оба слота ещё заняты), резервер ждёт и ничего не
    // делает — так же, как дальний майнер и хайлер.
    //
    // Хэш-fallback по имени в старой ветке был убран: он выдавал комнату
    // вслепую и мог закрепить обе замены за одной комнатой, а непустой
    // targetRoom в remote.manager больше не пересматривается — ошибка
    // оставалась на всю жизнь крипа, и вторая комната стояла без работника.
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) return;

    // 2. ПЕРЕХОД В ЦЕЛЕВУЮ КОМНАТУ. Идём к запомненной позиции контроллера, а не
    // к точке (25,25): иначе цель подменялась бы центром комнаты при каждом
    // пересечении границы и крип разворачивался бы на кромке (разбор общего
    // механизма — docs/REMOTE-BORDER-PING-PONG.md в старой ветке).
    //
    // Кэш пути сбрасывать вручную НЕ НУЖНО (отличие от старой ветки): Traveler
    // этого репозитория сам стирает путь, когда меняется цель
    // (traveler.js:249-259 — сравнение dest), а сам путь многотиковый и
    // межкомнатный, поэтому чистка при каждом переходе границы стоила бы
    // лишнего пересчёта (0.33-0.75 CPU за поиск, docs/pathfinding-measure.json).
    if (creep.room.name !== targetRoom) {
      creep.travelTo(travelTarget(creep, targetRoom));
      return;
    }

    // 3. РАБОТА С КОНТРОЛЛЕРОМ.
    // Свой контроллер резервировать нельзя: reserveController вернёт
    // ERR_INVALID_TARGET, а комната из REMOTE.ROOMS должна быть чужой.
    // targetRoom при этом НЕ сбрасываем: комнату раздаёт remote.manager из
    // константы, и сброс в горячем пути давал бы перезапись Memory каждый тик
    // (менеджер тут же выдал бы ту же комнату). Это ошибка конфигурации, о ней
    // говорит лог, а не сброс памяти.
    const controller = creep.room.controller;

    if (!controller) {
      log.warnThrottled(
        "reserver:noController:" + targetRoom,
        `[reserver] в ${targetRoom} нет контроллера — резервировать нечего`,
      );
      return;
    }

    if (controller.my) {
      log.warnThrottled(
        "reserver:ownController:" + targetRoom,
        `[reserver] ${targetRoom} — своя комната, резервация невозможна`,
      );
      return;
    }

    // Позиция контроллера запоминается ТОЛЬКО при изменении, чтобы не дёргать
    // сериализацию Memory каждый тик (правило 8 tests/rules.test.js).
    const known = creep.memory.controllerPos;

    if (!known || known.x !== controller.pos.x || known.y !== controller.pos.y) {
      creep.memory.controllerPos = { x: controller.pos.x, y: controller.pos.y };
    }

    // 4. РЕЗЕРВАЦИЯ — каждый тик, пока крип рядом. Вызов «издалека» вернул бы
    // ERR_NOT_IN_RANGE, ничего не сделав, но стоил бы как продуктивный.
    if (!creep.pos.isNearTo(controller)) {
      creep.travelTo(controller);
      return;
    }

    creep.reserveController(controller);
  },
};
