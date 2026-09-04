// scanner.js
// Модуль-сканер: строит и хранит кеш id структур/источников комнаты.

function ensureStructureCache(room) {
  if (!Memory.rooms) {
    Memory.rooms = {};
  }
  if (!Memory.rooms[room.name]) {
    Memory.rooms[room.name] = {};
  }

  const existing = Memory.rooms[room.name].structureCache;

  if (
    existing &&
    Array.isArray(existing.extensionIds) &&
    Array.isArray(existing.roadIds) &&
    Array.isArray(existing.wallIds) &&
    Array.isArray(existing.rampartIds)
  ) {
    return; // кэш уже полный, ничего не делаем
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
    observerId: null,
    extractorId: null,
    nukerId: null,
    storageId: room.storage ? room.storage.id : null,
    terminalId: room.terminal ? room.terminal.id : null,
    sourceIds: sources.map(s => s.id),
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

  Memory.rooms[room.name].structureCache = cache;
}

function getStructureCache(room) {
  ensureStructureCache(room);
  return Memory.rooms[room.name].structureCache;
}

module.exports = {
  ensureStructureCache,
  getStructureCache,
};
