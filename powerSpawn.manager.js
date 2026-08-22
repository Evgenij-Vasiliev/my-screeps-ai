/**
 * POWER SPAWN MANAGER
 * Прямой вызов действия структуры PowerSpawn — обработка power в GPL.
 * Не является задачей Worker'а (аналогично factory.manager.js).
 */
function run(roomState) {
  const { powerSpawn, roomName } = roomState;

  if (!powerSpawn) return;

  if (
    powerSpawn.store[RESOURCE_POWER] > 0 &&
    powerSpawn.store[RESOURCE_ENERGY] >= 50
  ) {
    powerSpawn.processPower();
  }
}

module.exports = { run };
