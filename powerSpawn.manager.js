/**
 * POWER SPAWN MANAGER
 * Прямой вызов действия структуры PowerSpawn — обработка power в GPL.
 * Не является задачей Worker'а (аналогично factory.manager.js).
 *
 * Задача 16 «Экономика»: подсистема выключена флагом TASK_CONFIG.powerSpawn.
 * GPL в проекте не потребляется (power creeps не используются), снабжение
 * PowerSpawn тоже выключено (TASK_CONFIG.fillPowerSpawnPower/Energy = false),
 * поэтому power — «мёртвый» запас: он продаётся на рынке (MARKET.SELL_RESOURCES),
 * резерв оставлен в MARKET.SELL_RESERVE.power.
 *
 * Пороги берутся из constants.POWER_SPAWN (раньше они были скопированы
 * магическими числами `> 0` и `>= 50` и не совпадали с конфигом).
 */
const { POWER_SPAWN } = require("./constants");

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const { powerSpawn } = roomState;

  if (!powerSpawn) return;

  if (powerSpawn.store[RESOURCE_POWER] < POWER_SPAWN.POWER_MIN) return;

  if (powerSpawn.store[RESOURCE_ENERGY] < POWER_SPAWN.ENERGY_MIN) return;

  const result = powerSpawn.processPower();
  if (result !== OK) {
    console.log(`[PowerSpawn] processPower() вернул ошибку ${result}`);
  }
}

module.exports = { run };
