/**
 * EMPIRE KERNEL (Ядро Империи)
 * Уровень империи: очистка памяти, делегирование всей комнатной
 * логики Room Manager'у, запуск глобального рынка.
 */
const observerManager = require("observer.manager");
const roomManager = require("room.manager");
const marketManager = require("market.manager");
const cpuMonitor = require("cpuMonitor");
const terminalNetwork = require("terminalNetwork");
const defenseManager = require("defense.manager");
const remoteManager = require("remote.manager");

// ── ИНИЦИАЛИЗАЦИЯ ГЛОБАЛЬНЫХ КЭШЕВ (heap) ─────────────────────────────────
// Все кэши живут в global (не сериализуются в Memory, переживают тик).
// После Global Reset global пуст — кэши пересобираются при первом обращении.
function initGlobalCaches() {
  if (!global._structureCache) global._structureCache = {};
  if (!global._mineralCache) global._mineralCache = {};
  if (!global._defenseCache) global._defenseCache = {};
  if (!global._remoteRoleCache) {
    global._remoteRoleCache = { reservers: [], remoteMiners: [], remoteHaulers: [] };
    global._remoteRoleCacheCount = 0;
    global._remoteRoleCacheUpdatedAt = 0;
  }
  if (!global._attackerNamesCache) {
    global._attackerNamesCache = [];
    global._attackerNamesCacheCount = 0;
    global._attackerNamesCacheUpdatedAt = 0;
  }
  if (!global._towerState) global._towerState = {};
  if (typeof global._taskIdSeq !== "number") global._taskIdSeq = 0;
}

module.exports.run = function () {
  try {
    cpuMonitor.startTick();
  } catch (error) {
    console.log(`[cpuMonitor.startTick] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  // 1. Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. Инициализация глобальных кэшей (самопосборка после Global Reset)
  initGlobalCaches();

  // 3. Уровень комнат — вся комнатная логика внутри roomManager
  try {
    cpuMonitor.trackRole("roomManager", () => roomManager.run());
  } catch (error) {
    console.log(`[roomManager] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  // 4. Разведка
  try {
    cpuMonitor.trackRole("observerManager", () => observerManager.run());
  } catch (error) {
    console.log(`[observerManager] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  // 4. Оборона — защита ремоут-комнат
  try {
    cpuMonitor.trackRole("defenseManager", () => defenseManager.run());
  } catch (error) {
    console.log(`[defenseManager] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  // 5. Дальняя добыча — резервер / дальний майнер / дальний хайлер
  try {
    cpuMonitor.trackRole("remoteManager", () => remoteManager.run());
  } catch (error) {
    console.log(`[remoteManager] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  // 6. TerminalNetwork — межкомнатная балансировка ресурсов
  try {
    cpuMonitor.trackRole("terminalNetwork", () => terminalNetwork.run());
  } catch (error) {
    console.log(`[terminalNetwork] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  // 7. Рынок империального уровня
  try {
    cpuMonitor.trackRole("marketManager", () => marketManager.run());
  } catch (error) {
    console.log(`[marketManager] Ошибка: ${error.message}`);
    console.log(error.stack);
  }

  try {
    cpuMonitor.endTick();
  } catch (error) {
    console.log(`[cpuMonitor.endTick] Ошибка: ${error.message}`);
    console.log(error.stack);
  }
};
