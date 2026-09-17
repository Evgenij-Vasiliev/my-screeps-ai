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

module.exports = {
  run: function (creep) {
    const HOME_ROOM = REMOTE.HOME_ROOM;

    // Целевую комнату назначает remote.manager (assignTargetRoom). Хэш по
    // имени — только fallback для крипов, которым менеджер комнату не дал
    // (например, дальних крипов больше, чем комнат).
    if (!creep.memory.targetRoom) {
      let sum = 0;
      for (let i = 0; i < creep.name.length; i++)
        sum += creep.name.charCodeAt(i);
      creep.memory.targetRoom = REMOTE.ROOMS[sum % REMOTE.ROOMS.length];
    }

    const targetRoom = creep.memory.targetRoom;

    // Переключение режима
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0)
      creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0)
      creep.memory.working = true;

    const currentGoal = creep.memory.working ? HOME_ROOM : targetRoom;

    // Переход между комнатами
    if (creep.room.name !== currentGoal) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._travel;
      }
      creep.memory._lastRoom = creep.room.name;
      creep.travelTo(new RoomPosition(25, 25, currentGoal));
      return;
    }

    creep.memory._lastRoom = creep.room.name;

    // Уходим с границы комнаты
    if (
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49
    ) {
      creep.travelTo(new RoomPosition(25, 25, creep.room.name));
      return;
    }

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

    let container = null;

    if (creep.memory.containerId) {
      container = Game.getObjectById(creep.memory.containerId);

      if (
        !container ||
        container.structureType !== STRUCTURE_CONTAINER ||
        container.room.name !== targetRoom ||
        container.store[RESOURCE_ENERGY] <= 0
      ) {
        // Контейнер исчез, опустел или это уже не тот контейнер — ищем заново
        container = null;
        delete creep.memory.containerId;
      }
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

    // Контейнер пуст — подбираем выпавшую энергию
    let dropped = null;

    if (creep.memory.droppedId) {
      dropped = Game.getObjectById(creep.memory.droppedId);
      if (!dropped || dropped.amount <= 20) {
        dropped = null;
        delete creep.memory.droppedId;
      }
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

    let source = null;

    if (creep.memory.waitSourceId) {
      source = Game.getObjectById(creep.memory.waitSourceId);
      if (!source) delete creep.memory.waitSourceId;
    }

    if (!source) {
      source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (source) creep.memory.waitSourceId = source.id;
    }

    if (source && creep.pos.getRangeTo(source) > 2) {
      creep.travelTo(source);
    }
  },
};
