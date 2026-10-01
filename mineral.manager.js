const scanner = require("scanner");

/**
 * Состояние минерала комнаты (задание 10 плана).
 *
 * extractorId берётся из structureCache — он там уже есть и обновляется
 * вместе с кэшем структур. Раньше здесь был отдельный кэш в
 * Memory.rooms[name].mineral, который каждый тик резолвил экстрактор
 * через Game.getObjectById только чтобы проверить его существование,
 * а результат никуда не использовался.
 *
 * Поле object отдаётся потребителям (spawn.manager, role.mineralMiner),
 * чтобы они не резолвили минерал повторно.
 *
 * @param {Room} room
 * @returns {Object|null} { id, mineralType, amount, extractorId, object }
 */
function buildMineralState(room) {
  const structureCache = scanner.getStructureCache(room);
  const mineralId = structureCache.mineralId;

  if (!mineralId) return null;

  const mineral = Game.getObjectById(mineralId);
  if (!mineral) return null;

  return {
    id: mineral.id,
    mineralType: mineral.mineralType,
    amount: mineral.mineralAmount,
    extractorId: structureCache.extractorId || null,
    object: mineral,
  };
}

module.exports = { buildMineralState };
