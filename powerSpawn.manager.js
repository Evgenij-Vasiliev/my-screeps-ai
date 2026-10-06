/**
 * POWER SPAWN MANAGER
 * Прямой вызов действия структуры PowerSpawn — обработка power в GPL.
 * Не является задачей Worker'а (аналогично factory.manager.js).
 *
 * ── ГРАНИЦА ОТВЕТСТВЕННОСТИ (правка 05.10.2026 по указанию владельца) ────
 * Тот же принцип, что у фабрики: «такой же принцип и наполнения powerSpawn».
 * Структура ничего не знает ни о хранилище, ни о терминале — она просто
 * работает, если у неё есть power и 50 энергии (POWER_SPAWN_ENERGY_RATIO,
 * engine power-spawns/process-power.js). Регулирует расход СИСТЕМА ЗАДАЧ:
 * задача fillPowerSpawnEnergy ставится, только когда энергия комнаты РАСТЁТ
 * (сальдо склада и терминала положительное — econ.roomGrowth).
 *
 * Здесь стояли интервал PROCESS_INTERVAL и проверка роста империи — убраны
 * вместе с остальными «знаниями структуры о складе»: у powerSpawn один
 * владелец расхода, и это очередь задач.
 */
function run(roomState) {
  const { powerSpawn } = roomState;

  if (!powerSpawn) return;

  if (
    powerSpawn.store[RESOURCE_POWER] > 0 &&
    powerSpawn.store[RESOURCE_ENERGY] >= 50
  ) {
    powerSpawn.processPower();
  }
}

module.exports = { run };
