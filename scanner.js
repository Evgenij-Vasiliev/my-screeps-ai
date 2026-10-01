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
 *
 * 3 (29.09.2026): добавлены damagedStats/damagedIds/damagedCount — числа
 * повреждённых владельческих структур. Версия поднята именно потому, что
 * старый кэш в heap переживает выгрузку кода: без перестройки башни до
 * первого обновления кэша не видели бы повреждённых spawn/tower/extension
 * вообще (полный список строится теперь только по числам).
 */
const CACHE_VERSION = 3;

/**
 * Владельческие типы структур, которые башни и генератор задач считают
 * кандидатами в ремонт. Порядок задаёт typeCode в damagedStats — менять его
 * можно только вместе с DAMAGED_TYPES.
 */
const DAMAGED_TYPE_NAMES = [
  STRUCTURE_SPAWN,
  STRUCTURE_TOWER,
  STRUCTURE_EXTENSION,
  STRUCTURE_LINK,
  STRUCTURE_LAB,
  STRUCTURE_FACTORY,
  STRUCTURE_POWER_SPAWN,
  STRUCTURE_OBSERVER,
  STRUCTURE_EXTRACTOR,
  STRUCTURE_NUKER,
];

/** typeCode -> structureType (плотный массив без дыр). */
const DAMAGED_TYPES = [];
/** structureType -> typeCode + 1 (0 означает «не кандидат»). */
const DAMAGED_TYPE_CODES = {};

for (let i = 0; i < DAMAGED_TYPE_NAMES.length; i++) {
  DAMAGED_TYPES.push(DAMAGED_TYPE_NAMES[i]);
  DAMAGED_TYPE_CODES[DAMAGED_TYPE_NAMES[i]] = i + 1;
}

/**
 * Все массивы id, без которых кэш нельзя использовать.
 */
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
  // Осиротевший кэш минерала: источником правды стал structureCache.
  if (roomMemory && roomMemory.mineral) {
    delete roomMemory.mineral;
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
    // Дороги с hits < hitsMax на момент сканирования (правка шага 2 плана).
    // Считается здесь, в уже существующем проходе по FIND_STRUCTURES: у
    // объекта структуры есть hits/hitsMax, поэтому лишних вызовов API нет.
    // room.manager резолвит только этот список, а не все дороги комнаты.
    //
    // Вместе с id сохраняются hits и hitsMax — теми же числами, что уже
    // прочитаны в проходе. Потребителю, которому нужны только числа
    // (порог ремонта 50 %, task.generators.js), резолв объектов по
    // Game.getObjectById больше не нужен: замер 29.09.2026 показал, что
    // перебор 752 дорог с резолвом стоит 0.15272 CPU/тик, а генератор
    // repair-задач — ещё 0.08158 CPU/тик при нуле найденных кандидатов
    // (docs/CPU-BASELINE.md, раздел 12).
    damagedRoadIds: [],
    // Те же дороги числами, для сравнений без резолва. Typed arrays вместо
    // обычных массивов: значения создаются один раз и только читаются,
    // а Int32Array не растит heap-мусор на каждом элементе (кэш живёт в heap
    // и не сериализуется, поэтому типы здесь допустимы: это не Memory).
    // Ёмкость — размер карты комнаты (50x50); дорог не может быть больше,
    // чем клеток, значит перевыделения не будет никогда.
    damagedRoadHits: new Int32Array(2500),
    damagedRoadHitsMax: new Int32Array(2500),
    damagedRoadCount: 0,
    // Повреждённые структуры ГРУПП (владельческие: spawn/tower/extension/
    // link/lab/factory/powerSpawn/observer/extractor/nuker), тоже числами.
    //
    // Замер 29.09.2026: резолв этих объектов стоил 0.12080 CPU/тик на империю
    // при нуле повреждённых среди них — 366 вызовов Game.getObjectById за тик
    // ради списка, из которого башни берут одну структуру раз в
    // TOWER.REPAIR_INTERVAL тиков (docs/CPU-BASELINE.md, разделы 12 и 13).
    // Теперь числа снимаются в том же проходе, что и всё остальное.
    //
    // Формат: плоский Int32Array по stride 3 — [typeCode, hits, hitsMax],
    // плюс обычный массив строк id в том же порядке. Числа в типизированном
    // массиве (одна аллокация на комнату, ноль объектов), id — строками: они
    // уходят в задачу как есть, и превращать их в числа незачем.
    damagedStats: new Int32Array(1400),
    damagedIds: [],
    damagedCount: 0,
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
        // Повреждённые — отдельным списком для room.manager (см. выше).
        // hits/hitsMax кладутся рядом с id в тот же слот, поэтому
        // потребитель чисел (генератор repair-задач) обходится без
        // Game.getObjectById на каждую дорогу.
        if (s.hits < s.hitsMax) {
          cache.damagedRoadIds.push(s.id);
          const n = cache.damagedRoadCount;
          cache.damagedRoadHits[n] = s.hits;
          cache.damagedRoadHitsMax[n] = s.hitsMax;
          cache.damagedRoadCount = n + 1;
        }
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

    // Повреждённые владельческие структуры — числами, в том же проходе.
    // Чужие и нейтральные не берём: прежний код собирал эти группы из
    // FIND_MY_STRUCTURES (своих) структур.
    if (s.hits < s.hitsMax && s.my) {
      const code = DAMAGED_TYPE_CODES[s.structureType];
      if (code) {
        const n = cache.damagedCount * 3;
        cache.damagedStats[n] = code;
        cache.damagedStats[n + 1] = s.hits;
        cache.damagedStats[n + 2] = s.hitsMax;
        cache.damagedIds.push(s.id);
        cache.damagedCount++;
      }
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

/**
 * Повреждённые владельческие структуры комнаты — по числам из кэша, без
 * резолва объектов.
 *
 * Замер 29.09.2026: резолв этих 366 объектов стоил 0.12080 CPU/тик на империю
 * при нуле повреждённых (docs/CPU-BASELINE.md, раздел 13). Здесь объекты не
 * резолвятся вовсе: числа (hits/hitsMax) сняты сканером в его проходе, а
 * структура нужна потребителю только как id.
 *
 * @param {Object} cache кэш сканера комнаты
 * @param {Array} out массив, в который складываются дескрипторы
 *   { id, structureType, hits, hitsMax }
 * @returns {void}
 */
function collectDamagedStructures(cache, out) {
  const stats = cache.damagedStats;
  const ids = cache.damagedIds;

  if (!stats || !ids || !cache.damagedCount) return;

  for (let i = 0; i < cache.damagedCount; i++) {
    const n = i * 3;
    // Дорога уже могла быть починена между сканами — но здесь только
    // структуры групп, их числа берутся как есть: возраст до
    // CACHE.REFRESH_INTERVAL тиков, как и у остального кэша.
    out.push({
      id: ids[i],
      structureType: DAMAGED_TYPES[stats[n] - 1],
      hits: stats[n + 1],
      hitsMax: stats[n + 2],
    });
  }
}

module.exports = {
  CACHE_VERSION,
  ensureStructureCache,
  getStructureCache,
  invalidateStructureCache,
  getSitesByRoom,
  // Детерминированная фаза комнаты (0 .. CACHE.REFRESH_INTERVAL-1) по имени.
  // Используется и для перестройки кэша, и для тика ремонта башен
  // (room.manager.isTowerRepairTick), чтобы периодические работы разных
  // комнат не сходились в один тик.
  rebuildStagger,
  // Числа повреждённых владельческих структур: потребитель (башни через
  // room.manager и генератор repair-задач) обходится без резолва объектов.
  collectDamagedStructures,
  DAMAGED_TYPES,
};
