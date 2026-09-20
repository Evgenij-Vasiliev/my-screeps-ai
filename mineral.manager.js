const scanner = require("scanner");

// ── КЕШ СОСТОЯНИЯ МИНЕРАЛА (heap) ───────────────────────────────────────
// global._mineralCache[roomName] хранит:
//   id / mineralType / extractorId — стабильные данные комнаты;
//   none: true                     — в комнате нет минерала (лог один раз);
//   resolvedTick / state           — результат разыменования на текущий тик.
//
// Состояние несёт уже разрешённые объекты движка (mineral/extractor), поэтому
// потребители (role.mineralMiner, spawn.manager) больше не вызывают
// Game.getObjectById по каждому крипу и каждой проверке квоты — объект тот же
// самый, что уже разрешён для roomState.
//
// Разрешение кешируется ТОЛЬКО на тик: в пределах тика объекты движка
// неизменны, а между тиками ссылку на них держать нельзя (данные устаревают —
// mineralAmount меняется, экстрактор может быть уничтожен).
function toMineralState(mineral, extractorId, extractor) {
  return {
    id: mineral.id,
    mineralType: mineral.mineralType,
    amount: mineral.mineralAmount,
    extractorId: extractorId || null,
    // Разрешённые объекты для потребителей (см. выше). Внешний вид состояния
    // не изменился: id/mineralType/amount/extractorId остались на месте.
    mineral,
    extractor: extractor || null,
  };
}

/**
 * Запоминает состояние в heap-кеше вместе с меткой тика.
 * @param {string} roomName
 * @param {Object|null} state
 * @returns {Object|null}
 */
function rememberState(roomName, state) {
  const cache = global._mineralCache[roomName];
  cache.resolvedTick = Game.time;
  cache.state = state;
  return state;
}

function rebuildMineralState(room) {
  const roomName = room.name;
  const structureCache = scanner.getStructureCache(room);
  const mineralId = structureCache.mineralId;

  // Кэш в heap — не сериализуется в Memory
  if (!global._mineralCache) global._mineralCache = {};

  if (!mineralId) {
    if (!room.memory._mineralNoneLogged) {
      console.log(`[Mineral] ${roomName} : no mineral source`);
      room.memory._mineralNoneLogged = true;
    }
    global._mineralCache[roomName] = { none: true };
    return rememberState(roomName, null);
  }

  const mineral = Game.getObjectById(mineralId);
  const structures = mineral.pos.lookFor(LOOK_STRUCTURES);
  const extractor = structures.find(
    s => s.structureType === STRUCTURE_EXTRACTOR,
  );
  const extractorId = extractor ? extractor.id : null;

  global._mineralCache[roomName] = {
    id: mineral.id,
    mineralType: mineral.mineralType,
    extractorId,
  };

  return rememberState(
    roomName,
    toMineralState(mineral, extractorId, extractor),
  );
}

function buildMineralState(room) {
  const roomName = room.name;
  // Инициализация глобального кэша (самопосборка после Global Reset)
  if (!global._mineralCache) global._mineralCache = {};

  const cache = global._mineralCache[roomName];

  // Уже разрешено в этом тике — повторных Game.getObjectById не делаем
  // (roomState комнаты строится один раз за тик, но потребители состояния
  // обращаются к минералу ещё и по каждому крипу/проверке квоты).
  if (cache && cache.resolvedTick === Game.time) {
    return cache.state;
  }

  if (!cache || typeof cache !== "object" || cache.none || !cache.id) {
    return rebuildMineralState(room);
  }

  const mineral = Game.getObjectById(cache.id);
  if (!mineral) {
    return rebuildMineralState(room);
  }

  if (cache.extractorId) {
    const extractor = Game.getObjectById(cache.extractorId);
    if (!extractor) {
      return rebuildMineralState(room);
    }
    return rememberState(
      roomName,
      toMineralState(mineral, extractor.id, extractor),
    );
  }

  return rememberState(roomName, toMineralState(mineral, null, null));
}

module.exports = { buildMineralState };
