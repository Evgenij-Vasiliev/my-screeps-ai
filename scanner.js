// scanner.js
// Модуль-сканер: строит и хранит кэш id структур/источников комнаты в heap-памяти (global).
// Это исключает тяжелую JSON-сериализацию/десериализацию сотен ID стен, дорог
// и расширений через Memory в каждом тике, экономя значительную долю CPU на Shard3.

if (!global._structureCache) {
  global._structureCache = {};
}

// Период принудительного обновления кэша (тиков) для учета постройки/разрушения дорог/структур
const STRUCTURE_CACHE_TTL = 1000;

function ensureStructureCache(room) {
  const roomName = room.name;

  // Очистка устаревшего кэша из Memory для освобождения размера Memory и снижения CPU
  if (
    Memory.rooms &&
    Memory.rooms[roomName] &&
    Memory.rooms[roomName].structureCache
  ) {
    delete Memory.rooms[roomName].structureCache;
  }

  const existing = global._structureCache[roomName];

  if (
    existing &&
    existing._updatedAt &&
    Game.time - existing._updatedAt < STRUCTURE_CACHE_TTL &&
    Array.isArray(existing.extensionIds) &&
    Array.isArray(existing.roadIds) &&
    Array.isArray(existing.wallIds) &&
    Array.isArray(existing.rampartIds)
  ) {
    return; // кэш в heap актуален, ничего не делаем
  }

  const structures = room.find(FIND_MY_STRUCTURES);
  const roads = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_ROAD,
  });
  const walls = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_WALL,
  });
  const ramparts = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_RAMPART,
  });

  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);

  const cache = {
    _updatedAt: Game.time,
    spawnIds: [],
    towerIds: [],
    linkIds: [],
    labIds: [],
    extensionIds: [],
    roadIds: roads.map(r => r.id),
    wallIds: walls.map(w => w.id),
    rampartIds: ramparts.map(r => r.id),
    factoryId: null,
    powerSpawnId: null,
    invaderCoreId: null,
    observerId: null,
    extractorId: null,
    nukerId: null,
    storageId: room.storage ? room.storage.id : null,
    terminalId: room.terminal ? room.terminal.id : null,
    sourceIds: sources.map(s => s.id),
    sourcePositions: sources.map(s => ({
      x: s.pos.x,
      y: s.pos.y,
    })),
    mineralId: minerals[0] ? minerals[0].id : null,
  };

  for (const s of structures) {
    switch (s.structureType) {
      case STRUCTURE_SPAWN:
        cache.spawnIds.push(s.id);
        break;
      case STRUCTURE_TOWER:
        cache.towerIds.push(s.id);
        break;
      case STRUCTURE_LINK:
        cache.linkIds.push(s.id);
        break;
      case STRUCTURE_LAB:
        cache.labIds.push(s.id);
        break;
      case STRUCTURE_EXTENSION:
        cache.extensionIds.push(s.id);
        break;
      case STRUCTURE_FACTORY:
        cache.factoryId = s.id;
        break;
      case STRUCTURE_POWER_SPAWN:
        cache.powerSpawnId = s.id;
        break;
      case STRUCTURE_OBSERVER:
        cache.observerId = s.id;
        break;
      case STRUCTURE_EXTRACTOR:
        cache.extractorId = s.id;
        break;
      case STRUCTURE_NUKER:
        cache.nukerId = s.id;
        break;
    }
  }

  global._structureCache[roomName] = cache;
}

function getStructureCache(room) {
  ensureStructureCache(room);
  return global._structureCache[room.name];
}

/**
 * Ручной сброс кэша (например, после завершения стройки или через консоль игры)
 * @param {string} [roomName] - имя комнаты (если не указано, сбрасываются все)
 */
function clearStructureCache(roomName) {
  if (roomName) {
    if (global._structureCache) delete global._structureCache[roomName];
    if (Memory.rooms && Memory.rooms[roomName]) {
      delete Memory.rooms[roomName].structureCache;
    }
  } else {
    global._structureCache = {};
  }
}

module.exports = {
  ensureStructureCache,
  getStructureCache,
  clearStructureCache,
};

