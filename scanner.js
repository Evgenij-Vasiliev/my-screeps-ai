// scanner.js
// Модуль-сканер: строит и хранит кеш id структур/источников комнаты.
//
// ИНВАЛИДАЦИЯ КЭША (задание 4 плана docs/CPU-OPTIMIZATION-PLAN.md).
// Раньше кэш строился один раз и больше НИКОГДА не обновлялся: проверялось
// лишь наличие четырёх массивов. Из-за этого построенные позже extensions,
// roads, walls и towers навсегда выпадали из roomState — спавн их не
// заполнял, ремонт не видел, башни не чинили.
//
// Теперь кэш перестраивается:
//   1) по возрасту — не реже, чем раз в CACHE.REFRESH_INTERVAL тиков;
//   2) немедленно — при смене уровня контроллера;
//   3) немедленно — при смене схемы (CACHE_VERSION) или неполном кэше.
//
// Отдельного события «стройка завершена» не требуется: возрастной порог
// и так ограничивает устаревание 20 тиками (~30 секунд).
//
// ХРАНЕНИЕ (задание 5 плана docs/CPU-OPTIMIZATION-PLAN.md).
// Кэш живёт в heap (global), а не в Memory. Массивы id стен/валов/дорог —
// это десятки килобайт, которые не меняются тиками, но сериализовались
// в Memory КАЖДЫЙ тик. В Memory кэш не нужен: он полностью
// восстанавливается из комнаты за один room.find.
//
// Пересканирование подешевело: вместо четырёх room.find(FIND_STRUCTURES)
// с фильтрами (roads/walls/ramparts) и отдельного FIND_MY_STRUCTURES —
// один проход room.find(FIND_STRUCTURES) с разбором по structureType.

const { CACHE } = require("./constants");

/**
 * Версия схемы кэша. Меняется при изменении набора полей — старый кэш
 * после этого перестраивается, а не роняет buildRoomState на undefined.
 */
const CACHE_VERSION = 2;

/** Все массивы id, без которых кэш нельзя использовать. */
const REQUIRED_ARRAYS = [
  "spawnIds",
  "towerIds",
  "linkIds",
  "labIds",
  "extensionIds",
  "roadIds",
  "wallIds",
  "rampartIds",
  "sourceIds",
];

/** @param {Object} cache */
function isCacheUsable(cache) {
  if (!cache || cache.v !== CACHE_VERSION) return false;

  for (let i = 0; i < REQUIRED_ARRAYS.length; i++) {
    if (!Array.isArray(cache[REQUIRED_ARRAYS[i]])) return false;
  }

  return true;
}

/**
 * Сдвиг порога перестройки для комнаты.
 *
 * Без него все комнаты получают updatedAt в один и тот же тик и потом
 * перестраиваются тоже в один тик — периодический пик CPU на всю Империю.
 * Детерминированный сдвиг по имени комнаты разносит перестройки по тикам.
 *
 * @param {string} roomName
 * @returns {number} 0 .. CACHE.REFRESH_INTERVAL-1
 */
function rebuildStagger(roomName) {
  let h = 0;
  for (let i = 0; i < roomName.length; i++) {
    h = (h * 31 + roomName.charCodeAt(i)) % 9973;
  }
  return h % CACHE.REFRESH_INTERVAL;
}

/**
 * Нужно ли перестроить кэш.
 * @param {Object|undefined} cache
 * @param {Room} room
 */
function needsRebuild(cache, room) {
  if (!isCacheUsable(cache)) return true;

  // Возрастной порог: гарантирует свежесть даже без событий.
  const age = Game.time - (cache.updatedAt || 0);
  if (age < 0) return true;
  if (age >= CACHE.REFRESH_INTERVAL + rebuildStagger(room.name)) return true;

  // Смена уровня контроллера — почти всегда новая застройка.
  const level = room.controller ? room.controller.level : null;
  if (cache.controllerLevel !== level) return true;

  return false;
}

/** Хранилище кэшей в heap: roomName -> cache. */
function heapCache() {
  if (!global.__structureCache) global.__structureCache = {};
  return global.__structureCache;
}

function ensureStructureCache(room) {
  const store = heapCache();
  const existing = store[room.name];

  if (!needsRebuild(existing, room)) {
    return;
  }

  // Разовая уборка: кэш прежних версий лежал в Memory и только раздувал
  // сериализацию. Удаляем его при первой же перестройке.
  const roomMemory = Memory.rooms && Memory.rooms[room.name];
  if (roomMemory && roomMemory.structureCache) {
    delete roomMemory.structureCache;
  }

  // Один проход по всем структурам вместо четырёх выборок с фильтрами.
  const structures = room.find(FIND_STRUCTURES);
  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);

  const cache = {
    v: CACHE_VERSION,
    updatedAt: Game.time,
    controllerLevel: room.controller ? room.controller.level : null,
    spawnIds: [],
    towerIds: [],
    linkIds: [],
    labIds: [],
    extensionIds: [],
    roadIds: [],
    wallIds: [],
    rampartIds: [],
    factoryId: null,
    powerSpawnId: null,
    observerId: null,
    extractorId: null,
    nukerId: null,
    storageId: room.storage ? room.storage.id : null,
    terminalId: room.terminal ? room.terminal.id : null,
    sourceIds: sources.map(s => s.id),
    mineralId: minerals[0] ? minerals[0].id : null,
  };

  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];

    switch (s.structureType) {
      // Дороги/стены/валы не имеют владельца — берём как есть,
      // как и прежний room.find(FIND_STRUCTURES, {filter}).
      case STRUCTURE_ROAD:
        cache.roadIds.push(s.id);
        break;
      case STRUCTURE_WALL:
        cache.wallIds.push(s.id);
        break;
      case STRUCTURE_RAMPART:
        cache.rampartIds.push(s.id);
        break;

      // Остальное должно быть своим: прежний код брал их из
      // FIND_MY_STRUCTURES, то есть чужие и нейтральные не попадали.
      case STRUCTURE_SPAWN:
        if (s.my) cache.spawnIds.push(s.id);
        break;
      case STRUCTURE_TOWER:
        if (s.my) cache.towerIds.push(s.id);
        break;
      case STRUCTURE_LINK:
        if (s.my) cache.linkIds.push(s.id);
        break;
      case STRUCTURE_LAB:
        if (s.my) cache.labIds.push(s.id);
        break;
      case STRUCTURE_EXTENSION:
        if (s.my) cache.extensionIds.push(s.id);
        break;
      case STRUCTURE_FACTORY:
        if (s.my) cache.factoryId = s.id;
        break;
      case STRUCTURE_POWER_SPAWN:
        if (s.my) cache.powerSpawnId = s.id;
        break;
      case STRUCTURE_OBSERVER:
        if (s.my) cache.observerId = s.id;
        break;
      case STRUCTURE_EXTRACTOR:
        if (s.my) cache.extractorId = s.id;
        break;
      case STRUCTURE_NUKER:
        if (s.my) cache.nukerId = s.id;
        break;
    }
  }

  store[room.name] = cache;
}

function getStructureCache(room) {
  ensureStructureCache(room);
  return heapCache()[room.name];
}

/**
 * Принудительно устаревает кэш комнаты — например, сразу после завершения
 * стройки или захвата комнаты, не дожидаясь возрастного порога.
 * @param {string} roomName
 */
function invalidateStructureCache(roomName) {
  const cache = heapCache()[roomName];
  if (cache) cache.updatedAt = -Infinity;
}

/**
 * Индекс стройплощадок по комнатам (задание 6 плана).
 *
 * Раньше и role.builder, и generateBuildStructures перебирали
 * Object.values(Game.constructionSites) целиком — Object.values на
 * каждую комнату и на каждого строителя, то есть O(B x S) с аллокацией
 * массива на каждый вызов.
 *
 * Индекс строится один раз за тик и живёт в heap. Ключ — Game.time:
 * объекты площадок валидны только в пределах тика, поэтому переживать
 * тик кэш не должен.
 *
 * @returns {Object} roomName -> ConstructionSite[]
 */
function getSitesByRoom() {
  const tick = Game.time;
  const cached = global.__sitesByRoom;

  if (cached && cached.tick === tick) return cached.byRoom;

  const byRoom = {};
  // for...in вместо Object.values: без массива всех площадок Империи.
  for (const id in Game.constructionSites) {
    const site = Game.constructionSites[id];
    if (!site) continue;
    const roomName = site.pos.roomName;
    (byRoom[roomName] = byRoom[roomName] || []).push(site);
  }

  global.__sitesByRoom = { tick, byRoom };
  return byRoom;
}

module.exports = {
  CACHE_VERSION,
  ensureStructureCache,
  getStructureCache,
  invalidateStructureCache,
  getSitesByRoom,
};
