/**
 * POWER SPAWN MANAGER
 * Прямой вызов действия структуры PowerSpawn — обработка power в прогресс GPL.
 * Не является задачей Worker'а (аналогично factory.manager.js): сама структура
 * ничего не «везёт», её только снабжают задачи fillPowerSpawnPower /
 * fillPowerSpawnEnergy (Task System), а обработку запускает этот менеджер.
 *
 * МЕХАНИКА. Game.gpl — прогресс «глобального уровня силы» аккаунта.
 * processPower() съедает 1 power + 50 энергии и добавляет 1 единицу прогресса,
 * после чего структура уходит в cooldown на 50 тиков. Значит вызов имеет смысл
 * только когда сырья хватает НА ВЫЗОВ и структура не в откате — иначе движок
 * вернёт ERR_NOT_ENOUGH_RESOURCES / ERR_TIRED, то есть чистый расход CPU.
 *
 * ПОЧЕМУ ПОДСИСТЕМА БЫЛА МЁРТВОЙ. Флаг TASK_CONFIG.powerSpawn стоял false,
 * поэтому run() не вызывался вовсе: в пяти RCL8-комнатах shard3 (24.09.2026) в
 * PowerSpawn лежало 20–62 power и 530–952 энергии, cooldown был 0 — то есть
 * структура была готова к работе, а processPower() не вызывался ни разу, и GPL
 * стоял на месте при 200k power на складах империи.
 *
 * ЕДИНОЕ УСЛОВИЕ РАБОТЫ. И генераторы задач, и менеджер спрашивают одну и ту же
 * функцию isProductionComplete(): как только цель POWER_SPAWN.TARGET_GPL_PROGRESS
 * достигнута, снабжение PowerSpawn прекращается, а processPower() больше не
 * вызывается. Так включённая подсистема не превращается в бессмысленный вечный
 * цикл «подвезли → обработали → снова подвезли».
 *
 * Пороги берутся из constants.POWER_SPAWN (раньше они были скопированы
 * магическими числами `> 0` и `>= 50` и не совпадали с конфигом).
 */
const { POWER_SPAWN } = require("./constants");

/**
 * Достигнута ли цель производства: обрабатывать power больше не нужно.
 *
 * Считается по Game.gpl.progress — прогрессу ТЕКУЩЕГО уровня GPL (движок
 * сбрасывает его при переходе на новый уровень, и тогда производство снова
 * открывается). На приватных серверах Game.gpl может отсутствовать — тогда
 * считаем, что цель не достигнута, и подсистема работает как раньше.
 *
 * @returns {boolean}
 */
function isProductionComplete() {
  const gpl = Game.gpl;
  if (!gpl || typeof gpl.progress !== "number") return false;

  return gpl.progress >= POWER_SPAWN.TARGET_GPL_PROGRESS;
}

/**
 * Есть ли в структуре сырьё на один processPower().
 * @param {Object} powerSpawn
 * @returns {boolean}
 */
function hasResources(powerSpawn) {
  return (
    (powerSpawn.store[RESOURCE_POWER] || 0) >= POWER_SPAWN.POWER_MIN &&
    (powerSpawn.store[RESOURCE_ENERGY] || 0) >= POWER_SPAWN.ENERGY_MIN
  );
}

/**
 * Достаточно ли в комнате энергии, чтобы снабжать PowerSpawn.
 *
 * Правило то же, что у остальных потребителей энергии (energySource.
 * withdrawFromStorage): из storage можно брать, пока он ВЫШЕ резерва, иначе —
 * из терминала (с собственным запасом на комиссии и буфер комнаты).
 *
 * Почему не «storage минус 10 %»: трата PowerSpawn ограничена механикой (50
 * энергии на processPower() при cooldown 50 тиков, то есть ≈1 энергия за тик на
 * комнату), а живые RCL8-комнаты держат storage ровно у резерва — прежняя
 * надбавка делала подвоз недостижимым и подсистема застывала (разбор — в
 * constants.POWER_SPAWN).
 *
 * @param {Object} roomState
 * @returns {boolean}
 */
function hasEnergySupply(roomState) {
  const { storage, terminal } = roomState;
  const storageEnergy = storage ? storage.store[RESOURCE_ENERGY] || 0 : 0;

  if (storageEnergy > POWER_SPAWN.ENERGY_STORAGE_FLOOR) return true;

  const terminalEnergy = terminal ? terminal.store[RESOURCE_ENERGY] || 0 : 0;
  return terminalEnergy > POWER_SPAWN.ENERGY_TERMINAL_FLOOR;
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const { powerSpawn } = roomState;

  if (!powerSpawn) return;

  // Цель производства достигнута — не тратим ни сырьё, ни CPU.
  if (isProductionComplete()) return;

  // Откат после предыдущей обработки. Проверяем ДО сырья: вызов в откате
  // вернул бы ERR_TIRED (то же «вхолостую», что и без сырья).
  if (powerSpawn.cooldown > 0) return;

  if (!hasResources(powerSpawn)) return;

  // Сырьё и cooldown проверены выше, поэтому ненулевой код возврата здесь —
  // редкая гонка состояния. Раньше он печатался каждый тик: строка в консоли
  // в горячем пути стоит CPU, а действия всё равно нет.
  powerSpawn.processPower();
}

module.exports = { run, isProductionComplete, hasResources, hasEnergySupply };
