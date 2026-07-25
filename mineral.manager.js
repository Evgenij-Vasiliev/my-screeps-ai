function toMineralState(mineral, extractorId) {
  return {
    id: mineral.id,
    mineralType: mineral.mineralType,
    amount: mineral.mineralAmount,
    extractor: extractorId || null,
  };
}

function rebuildMineralState(room) {
  const roomName = room.name;
  const minerals = room.find(FIND_MINERALS);

  if (minerals.length === 0) {
    if (!room.memory._mineralNoneLogged) {
      console.log(`[Mineral] ${roomName} : no mineral source`);
      room.memory._mineralNoneLogged = true;
    }
    Memory.rooms[roomName].mineral = { none: true };
    return null;
  }

  const mineral = minerals[0];
  const structures = mineral.pos.lookFor(LOOK_STRUCTURES);
  const extractor = structures.find(
    s => s.structureType === STRUCTURE_EXTRACTOR,
  );
  const extractorId = extractor ? extractor.id : null;

  Memory.rooms[roomName].mineral = {
    id: mineral.id,
    mineralType: mineral.mineralType,
    extractorId,
  };

  return toMineralState(mineral, extractorId);
}

function buildMineralState(room) {
  const roomName = room.name;
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const cache = Memory.rooms[roomName].mineral;

  if (!cache || typeof cache !== "object") {
    return rebuildMineralState(room);
  }

  if (cache.none) {
    return null;
  }

  if (!cache.id) {
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
    return toMineralState(mineral, extractor.id);
  }

  return toMineralState(mineral, null);
}

module.exports = { buildMineralState };
