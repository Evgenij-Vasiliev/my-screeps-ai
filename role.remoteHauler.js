/**
 * ===================================================
 * ROLE.REMOTEHAULER.JS — дальний перевозчик энергии
 * ===================================================
 * Забирает энергию из контейнера у источника в удалённой комнате и везёт её в
 * линк-приёмник у границы в HOME_ROOM. Линк мгновенно передаёт энергию в линк у
 * storage (linkManager), откуда её забирает домашний контур.
 *
 * Маршрут:
 *   удалённая комната → контейнер → рюкзак полон
 *   → HOME_ROOM → линк-приёмник → повтор
 *
 * Комната и привязка линка — REMOTE.ROOMS / REMOTE.ROOM_TO_LINK (constants.js).
 * Целевую комнату назначает ТОЛЬКО remote.manager (assignTargetRoom).
 *
 * ПЕРЕХОД МЕЖДУ КОМНАТАМИ (разбор — docs/REMOTE-BORDER-PING-PONG.md в старой
 * ветке): цель рейса (линк/storage при доставке, контейнер/источник при сборе)
 * выбирается СРАЗУ, ещё до входа в нужную комнату, и не подменяется точкой
 * (25,25) при пересечении границы. Центр комнаты — только запасной вариант для
 * первого рейса, когда цель ещё ни разу не видна. Ветка «стою на кромке — уйду в
 * центр» удалена: вместе с подменой цели она давала пинг-понг на границе.
 *
 * ОПТИМИЗАЦИЯ CPU (адресные замеры — docs/REMOTE-CPU-OPTIMIZATION.md старой ветки):
 *  - действие (transfer/withdraw/pickup) вызывается ТОЛЬКО когда крип уже в
 *    радиусе цели: раньше вызов шёл каждый тик и возвращал ERR_NOT_IN_RANGE
 *    (≈0.07-0.08 мс), теперь вместо него дешёвая проверка расстояния
 *    (isNearTo ≈0.001 мс) и travelTo;
 *  - если собирать нечего (контейнер пуст и на полу ничего нет), поиски
 *    findClosestByRange не повторяются каждый тик, а только раз в
 *    REMOTE.HAULER_SEARCH_INTERVAL тиков: иначе два обхода комнаты (структуры и
 *    дропнутые ресурсы) шли бы на каждом тике ожидания.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ origin/Новая-Империя:remote.hauler.js: сброс
 * creep.memory._travel при переходе границы убран — Traveler этого репозитория
 * сам стирает путь при смене цели (traveler.js:249-259), а путь у него
 * межкомнатный.
 * ===================================================
 */

const { REMOTE } = require("./constants");
const { roomScopedTarget } = require("./remote.targets");
const log = require("./log");

// Room-зависимые цели хайлера: всё, что он помнит об удалённой комнате.
const ROOM_TARGETS = ["containerId", "droppedId", "waitSourceId"];

/** Порог «на полу есть что подобрать»: мелочь по 1-20 энергии не стоит рейса. */
const DROPPED_MIN_AMOUNT = 20;

/**
 * Забывает цели, оставшиеся в покинутой комнате.
 *
 * Проверка на месте использования (roomScopedTarget) уже не даёт уйти по чужому
 * id, но если этот id в текущем тике не понадобился, он лежал бы в памяти до
 * следующего обращения. После переназначения targetRoom память о прежней комнате
 * недействительна целиком, поэтому чистим сразу.
 *
 * @param {Object} creep
 * @param {string} targetRoom
 */
function forgetForeignTargets(creep, targetRoom) {
  for (let i = 0; i < ROOM_TARGETS.length; i++) {
    roomScopedTarget(creep, ROOM_TARGETS[i], targetRoom);
  }
}

/**
 * Цель сбора в удалённой комнате, известная из прошлого рейса: контейнер,
 * выпавшая энергия, иначе источник (ждать рядом с ним). Пока крип вне целевой
 * комнаты, идти нужно к этой цели, а не к точке (25,25).
 *
 * Все три id — room-зависимые, поэтому берутся только через roomScopedTarget:
 * объект годится, лишь если существует И лежит в текущей targetRoom. Иначе
 * хайлер, которому remote.manager переназначил комнату, ушёл бы по старой памяти
 * в покинутую комнату и остался там (живой shard3 19.09.2026 в старой ветке).
 *
 * @param {Object} creep
 * @param {string} targetRoom
 * @returns {any} контейнер, ресурс, источник или null
 */
function knownHaulTarget(creep, targetRoom) {
  const container = roomScopedTarget(creep, "containerId", targetRoom);

  if (
    container &&
    container.structureType === STRUCTURE_CONTAINER &&
    container.store[RESOURCE_ENERGY] > 0
  ) {
    return container;
  }

  const dropped = roomScopedTarget(creep, "droppedId", targetRoom);
  if (dropped && dropped.amount > DROPPED_MIN_AMOUNT) return dropped;

  return roomScopedTarget(creep, "waitSourceId", targetRoom);
}

/**
 * Линк-приёмник удалённой комнаты (REMOTE.ROOM_TO_LINK).
 *
 * Невалидный id (линк снесли/перестроили) — предупреждение с ограниченным ключом
 * вместо тихого фолбэка: раньше перестройка линка молча уводила хайлера на
 * storage, и это выглядело как «хайлер почему-то не пользуется линком».
 * Ключ включает комнату и id, поэтому heap не растёт; warnThrottled печатает не
 * чаще, чем раз в log.THROTTLE_INTERVAL тиков.
 *
 * @param {string} targetRoom
 * @returns {any} линк или null
 */
function configuredLink(targetRoom) {
  const linkId = REMOTE.ROOM_TO_LINK[targetRoom];
  if (!linkId) return null;

  const link = Game.getObjectById(linkId);
  if (!link) {
    log.warnThrottled(
      "remoteLink:" + targetRoom,
      `[remoteHauler] линк-приёмник ${linkId} комнаты ${targetRoom} не найден — ` +
        "хайлер везёт в storage; поправьте REMOTE.ROOM_TO_LINK в constants.js",
    );
    return null;
  }

  return link;
}

/**
 * Storage домашней комнаты (запасной вариант доставки).
 * @returns {any} storage или null
 */
function homeStorage() {
  const home = Game.rooms[REMOTE.HOME_ROOM];
  return home ? home.storage : null;
}

/**
 * Цель доставки в HOME_ROOM: линк у границы (REMOTE.ROOM_TO_LINK), иначе
 * storage. Идём к ней напрямую с самого начала рейса — по той же причине, что и
 * в knownHaulTarget.
 *
 * @param {string} targetRoom
 * @returns {any} линк, storage или null
 */
function knownDeliverTarget(targetRoom) {
  const link = configuredLink(targetRoom);

  if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return link;

  return homeStorage();
}

/**
 * Ведёт крипа к цели и выполняет действие, когда он уже рядом.
 * Действие «издалека» вернуло бы ERR_NOT_IN_RANGE, но стоило бы как
 * продуктивное: поэтому сначала isNearTo, действие — только вплотную.
 *
 * @param {Object} creep
 * @param {any} target объект с pos или RoomPosition
 * @param {Function} act действие без аргументов
 * @returns {boolean} false — цели нет
 */
function goAct(creep, target, act) {
  if (!target) return false;

  if (creep.pos.isNearTo(target)) act();
  else creep.travelTo(target);

  return true;
}

module.exports = {
  run: function (creep) {
    // Спавнящийся крип не может действовать: интенты всё равно отбросятся.
    if (creep.spawning) return;

    // Целевую комнату назначает ТОЛЬКО remote.manager. Пока свободного слота нет
    // (пре-спавн поставил замену раньше смерти предшественника, и все слоты ещё
    // заняты), хайлер ждёт — так же, как ждут резервер и дальний майнер.
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) return;

    // remote.manager мог переназначить комнату живому крипу (лечение дубля после
    // пре-спавна) — память о прежней комнате недействительна целиком.
    forgetForeignTargets(creep, targetRoom);

    // Переключение режима: пустой рюкзак — собирать, полный — везти.
    // Запись только под условием со сверкой текущего значения (правило 8
    // tests/rules.test.js): безусловная запись — это сериализация Memory каждый тик.
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
    } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    const working = creep.memory.working;
    const goalRoom = working ? REMOTE.HOME_ROOM : targetRoom;

    // ── Переход между комнатами ────────────────────────────────────────────
    // Идём сразу к настоящей цели рейса — линку (или storage) при доставке и
    // контейнеру/источнику при сборе, а не к точке (25,25): подмена цели при
    // каждом пересечении границы возвращала крипа к центру комнаты и превращала
    // рейс в пинг-понг на кромке. Точка (25,25) — только запасной вариант, когда
    // цель ещё ни разу не видна (например, первый рейс).
    if (creep.room.name !== goalRoom) {
      const goalTarget = working
        ? knownDeliverTarget(targetRoom)
        : knownHaulTarget(creep, targetRoom);

      creep.travelTo(goalTarget || new RoomPosition(25, 25, goalRoom));
      return;
    }

    // ── РЕЖИМ ДОСТАВКИ: несём в линк-приёмник у границы ────────────────────
    if (working) {
      const link = configuredLink(targetRoom);

      if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        goAct(creep, link, () => creep.transfer(link, RESOURCE_ENERGY));
        return;
      }

      // Линк полный или недоступен — запасной вариант: storage домашней комнаты.
      const storage = creep.room.storage || homeStorage();

      if (goAct(creep, storage, () => creep.transfer(storage, RESOURCE_ENERGY)))
        return;

      // Ни линка с местом, ни storage: ждём у линка (или в центре домашней
      // комнаты), пока место не освободится.
      if (link) creep.travelTo(link);
      return;
    }

    // ── РЕЖИМ СБОРА: берём из контейнера в удалённой комнате ────────────────
    // Поиски (findClosestByRange) выполняются не каждый тик: когда добычи нет
    // вообще, хайлер ждёт — и тогда поиск повторяется раз в
    // REMOTE.HAULER_SEARCH_INTERVAL тиков.
    const canSearch =
      !creep.memory.nextHaulSearch || Game.time >= creep.memory.nextHaulSearch;

    // Контейнер — room-зависимая цель: годится, только если ещё существует и
    // лежит в текущей targetRoom.
    let container = roomScopedTarget(creep, "containerId", targetRoom);

    if (
      container &&
      (container.structureType !== STRUCTURE_CONTAINER ||
        container.store[RESOURCE_ENERGY] <= 0)
    ) {
      // Контейнер опустел или это уже не тот контейнер — ищем заново.
      container = null;
      delete creep.memory.containerId;
    }

    if (!container && canSearch) {
      container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (container) creep.memory.containerId = container.id;
    }

    if (container) {
      delete creep.memory.nextHaulSearch;
      goAct(creep, container, () =>
        creep.withdraw(container, RESOURCE_ENERGY),
      );
      return;
    }

    // Контейнер пуст — подбираем выпавшую энергию (тоже только в targetRoom).
    let dropped = roomScopedTarget(creep, "droppedId", targetRoom);

    if (dropped && dropped.amount <= DROPPED_MIN_AMOUNT) {
      dropped = null;
      delete creep.memory.droppedId;
    }

    if (!dropped && canSearch) {
      dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: r =>
          r.resourceType === RESOURCE_ENERGY && r.amount > DROPPED_MIN_AMOUNT,
      });

      if (dropped) creep.memory.droppedId = dropped.id;
    }

    if (dropped) {
      delete creep.memory.nextHaulSearch;
      goAct(creep, dropped, () => creep.pickup(dropped));
      return;
    }

    // Добычи нет: следующие поиски — не раньше, чем через
    // REMOTE.HAULER_SEARCH_INTERVAL тиков. TTL продлевается ТОЛЬКО когда поиск
    // реально выполнялся — иначе он «уезжал» бы вперёд на каждом тике ожидания.
    if (canSearch && creep.memory.nextHaulSearch !== Game.time + REMOTE.HAULER_SEARCH_INTERVAL) {
      creep.memory.nextHaulSearch = Game.time + REMOTE.HAULER_SEARCH_INTERVAL;
    }

    // Источник ожидания — тоже room-зависимая цель: после переназначения комнаты
    // он должен быть отброшен, иначе хайлер уйдёт к источнику покинутой комнаты
    // и останется там.
    let source = roomScopedTarget(creep, "waitSourceId", targetRoom);

    if (!source && canSearch) {
      source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (source) creep.memory.waitSourceId = source.id;
    }

    if (source) {
      const rangeToSource = creep.pos.getRangeTo(source);

      // Уже рядом с источником, но брать нечего: уходим на клетку ожидания,
      // чтобы не стоять на рабочем месте майнера (контейнере). Иначе хаулер,
      // опустошивший контейнер и оставшийся на его клетке, не даёт майнеру
      // встать на контейнер — роль майнера в этот тик только travelTo.
      if (rangeToSource <= 2) {
        const wait = REMOTE.ROOM_TO_WAIT_POS[targetRoom];

        if (wait) {
          const waitPos = new RoomPosition(wait.x, wait.y, targetRoom);
          if (!creep.pos.isEqualTo(waitPos)) creep.travelTo(waitPos);
        }
        return;
      }

      creep.travelTo(source);
    }
  },
};
