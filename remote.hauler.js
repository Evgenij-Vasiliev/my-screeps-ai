/**
 * ===================================================
 * ROLE.REMOTEHAULER.JS — Дальний перевозчик энергии
 * ===================================================
 * Забирает энергию из контейнеров в удалённых комнатах и везёт её к линку
 * у границы в HOME_ROOM. Линк мгновенно передаёт энергию в линк у Storage.
 *
 * Маршрут:
 *   Удалённая комната → контейнер → рюкзак полон
 *   → идём в HOME_ROOM → передаём в линк у границы → повтор
 *
 * Комнаты и привязка линков — в constants.REMOTE (ROOMS / HOME_ROOM /
 * ROOM_TO_LINK), чтобы не было второго списка комнат в коде.
 *
 * Переход между комнатами (правка 18.09.2026, docs/REMOTE-BORDER-PING-PONG.md):
 *  - цель рейса (линк/storage при доставке, контейнер/источник при сборе)
 *    выбирается СРАЗУ, ещё до входа в нужную комнату, и не подменяется точкой
 *    (25,25) при пересечении границы; центр комнаты — только запасной вариант
 *    для первого рейса, когда цель ещё ни разу не видна;
 *  - ветка «стою на кромке — уйду в центр» удалена: вместе с подменой цели она
 *    давала пинг-понг на границе (путь к источнику E35S38 дешевле через дороги
 *    домашней комнаты, и крип, выйдя из комнаты, разворачивался к её центру).
 *
 * Оптимизация CPU (адресные замеры — docs/REMOTE-CPU-OPTIMIZATION.md):
 *  - действие (transfer/withdraw/pickup) вызывается ТОЛЬКО когда крип уже
 *    в радиусе цели: раньше вызов шёл каждый тик и возвращал
 *    ERR_NOT_IN_RANGE (≈0.07–0.08 мс), теперь вместо него дешёвая проверка
 *    расстояния (isNearTo ≈0.001 мс) и travelTo;
 *  - если собирать нечего (контейнер пуст и на полу ничего нет), поиски
 *    findClosestByRange не повторяются каждый тик, а только раз в
 *    REMOTE.HAULER_SEARCH_INTERVAL тиков: иначе два обхода комнаты
 *    (структуры и дропнутые ресурсы) шли на каждом тике ожидания.
 */
const { REMOTE } = require("./constants");
const { roomScopedTarget } = require("./remote.targets");

// Room-зависимые цели хайлера: всё, что он помнит об удалённой комнате.
const ROOM_TARGETS = ["containerId", "droppedId", "waitSourceId"];

/**
 * Забывает цели, оставшиеся в покинутой комнате.
 *
 * Проверка на месте использования (roomScopedTarget в knownHaulTarget и в
 * ветке сбора) уже не даёт уйти по чужому ID, но если этот ID в текущем тике
 * не понадобился, он так и лежал бы в памяти до следующего обращения. После
 * переназначения targetRoom память о прежней комнате недействительна целиком,
 * поэтому её вычищаем сразу.
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
 * выпавшая энергия, иначе источник (ждать рядом с ним). Пока крип вне
 * целевой комнаты, идти нужно к этой цели, а не к точке (25,25): подмена
 * цели на каждом переходе границы превращала рейс в пинг-понг на кромке
 * (разбор — docs/REMOTE-BORDER-PING-PONG.md).
 *
 * ВАЖНО: все три ID — room-зависимые, поэтому берутся только через
 * roomScopedTarget: объект годится, лишь если он существует И лежит в текущей
 * targetRoom. Иначе хайлер, которому remote.manager переназначил комнату,
 * ушёл бы по старой памяти в покинутую комнату и остался там (живой shard3,
 * 19.09.2026: remoteHauler_E35S37_83084919 с targetRoom E35S38 стоял у
 * источника E36S37 и в новую комнату не шёл).
 *
 * @param {Creep} creep
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
  if (dropped && dropped.amount > 20) return dropped;

  const source = roomScopedTarget(creep, "waitSourceId", targetRoom);
  if (source) return source;

  return null;
}

/**
 * Цель доставки в HOME_ROOM: линк у границы (REMOTE.ROOM_TO_LINK), иначе
 * storage. Идём к ней напрямую с самого начала рейса — по той же причине,
 * что и в knownHaulTarget.
 *
 * @param {string} targetRoom
 * @returns {any} линк, storage или null
 */
function knownDeliverTarget(targetRoom) {
  const linkId = REMOTE.ROOM_TO_LINK[targetRoom];
  const link = linkId ? Game.getObjectById(linkId) : null;

  if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return link;

  const home = Game.rooms[REMOTE.HOME_ROOM];
  return home ? home.storage : null;
}

module.exports = {
  run: function (creep) {
    const HOME_ROOM = REMOTE.HOME_ROOM;

    // Целевую комнату назначает ТОЛЬКО remote.manager (assignTargetRoom) —
    // единая точка назначения для всех дальних ролей. Пока свободной комнаты
    // нет (пре-спавн поставил замену раньше смерти предшественника, и обе
    // комнаты ещё заняты), хайлер просто ждёт — так же, как ждёт remote.miner.
    //
    // Хэш-fallback по имени убран: он выдавал комнату вслепую и мог закрепить
    // обе замены за одной и той же комнатой, а непустой targetRoom в
    // remote.manager больше не пересматривается — ошибка оставалась на всю
    // жизнь крипа, и вторая удалённая комната стояла без работника.
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) return;

    // remote.manager мог переназначить комнату живому крипу (лечение дубля
    // после pre-spawn) — память о прежней комнате недействительна целиком.
    forgetForeignTargets(creep, targetRoom);

    // Переключение режима
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0)
      creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0)
      creep.memory.working = true;

    const currentGoal = creep.memory.working ? HOME_ROOM : targetRoom;

    // Переход между комнатами. Идём сразу к настоящей цели рейса — линку
    // (или storage) при доставке и контейнеру/источнику при сборе, а не к
    // точке (25,25): подмена цели при каждом пересечении границы возвращала
    // крипа к центру комнаты и превращала рейс в пинг-понг на кромке
    // (docs/REMOTE-BORDER-PING-PONG.md). Точка (25,25) — только запасной
    // вариант, когда цель ещё ни разу не видна (например, первый рейс).
    if (creep.room.name !== currentGoal) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._travel;
      }
      creep.memory._lastRoom = creep.room.name;

      const goalTarget = creep.memory.working
        ? knownDeliverTarget(targetRoom)
        : knownHaulTarget(creep, targetRoom);

      creep.travelTo(goalTarget || new RoomPosition(25, 25, currentGoal));
      return;
    }

    creep.memory._lastRoom = creep.room.name;

    if (creep.memory.working) {
      // === РЕЖИМ ДОСТАВКИ: несём в линк у границы ===
      const linkId = REMOTE.ROOM_TO_LINK[targetRoom];
      const link = linkId ? Game.getObjectById(linkId) : null;

      if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        // Есть линк и в нём есть место — идём к нему. Действие вызываем
        // только рядом: вызов вдали вернул бы ERR_NOT_IN_RANGE, но стоил бы
        // как продуктивный (≈0.08 мс).
        if (creep.pos.isNearTo(link)) {
          creep.transfer(link, RESOURCE_ENERGY);
        } else {
          creep.travelTo(link);
        }
      } else {
        // Линк полный или недоступен — запасной вариант: Storage
        const target = creep.room.storage;
        if (target) {
          if (creep.pos.isNearTo(target)) {
            creep.transfer(target, RESOURCE_ENERGY);
          } else {
            creep.travelTo(target);
          }
        }
      }
      return;
    }

    // === РЕЖИМ СБОРА: берём из контейнера в удалённой комнате ===
    // Поиски (findClosestByRange) выполняются не каждый тик: когда добычи нет
    // вообще, хайлер ждёт — и тогда поиск повторяется раз в
    // REMOTE.HAULER_SEARCH_INTERVAL тиков.
    const canSearch =
      !creep.memory.nextHaulSearch || Game.time >= creep.memory.nextHaulSearch;

    // Контейнер — room-зависимая цель: годится, только если ещё существует и
    // лежит в текущей targetRoom (иначе после переназначения комнаты крип
    // пошёл бы к контейнеру покинутой комнаты).
    let container = roomScopedTarget(creep, "containerId", targetRoom);

    if (
      container &&
      (container.structureType !== STRUCTURE_CONTAINER ||
        container.store[RESOURCE_ENERGY] <= 0)
    ) {
      // Контейнер опустел или это уже не тот контейнер — ищем заново
      container = null;
      delete creep.memory.containerId;
    }

    if (!container && canSearch) {
      container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.room.name === targetRoom &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (container) {
        creep.memory.containerId = container.id;
      }
    }

    if (container) {
      delete creep.memory.nextHaulSearch;

      if (creep.pos.isNearTo(container)) {
        creep.withdraw(container, RESOURCE_ENERGY);
      } else {
        creep.travelTo(container);
      }
      return;
    }

    // Контейнер пуст — подбираем выпавшую энергию (тоже только в targetRoom)
    let dropped = roomScopedTarget(creep, "droppedId", targetRoom);

    if (dropped && dropped.amount <= 20) {
      dropped = null;
      delete creep.memory.droppedId;
    }

    if (!dropped && canSearch) {
      dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 20,
      });
      if (dropped) {
        creep.memory.droppedId = dropped.id;
      }
    }

    if (dropped) {
      delete creep.memory.nextHaulSearch;

      if (creep.pos.isNearTo(dropped)) {
        creep.pickup(dropped);
      } else {
        creep.travelTo(dropped);
      }
      return;
    }

    // Добычи нет: следующие поиски — не раньше, чем через
    // REMOTE.HAULER_SEARCH_INTERVAL тиков. Ждём у источника.
    // (TTL продлевается только когда поиск реально выполнялся — иначе он
    // «уезжал» бы вперёд на каждом тике ожидания.)
    if (canSearch) {
      creep.memory.nextHaulSearch = Game.time + REMOTE.HAULER_SEARCH_INTERVAL;
    }

    // Источник ожидания — тоже room-зависимая цель: после переназначения
    // комнаты он должен быть отброшен, иначе хайлер уйдёт к источнику
    // покинутой комнаты и останется там.
    let source = roomScopedTarget(creep, "waitSourceId", targetRoom);

    if (!source) {
      source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (source) creep.memory.waitSourceId = source.id;
    }

    if (source && creep.pos.getRangeTo(source) > 2) {
      creep.travelTo(source);
    }
  },
};
