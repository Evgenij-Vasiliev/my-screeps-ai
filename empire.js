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
const shardState = require("./shard.state");
const log = require("./log");
const { CPU } = require("./constants");

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
  // Heap-кэш суммарных хитов стен/валов на прошлом скане (detectAttack):
  // значение живёт между сканами TOWER.WALL_SCAN_INTERVAL, в Memory его
  // сериализовать незачем.
  if (!global._towerWallHits) global._towerWallHits = {};
  if (typeof global._taskIdSeq !== "number") global._taskIdSeq = 0;
}

/**
 * Ошибка подсистемы уровня империи. Печатается не чаще раза в
 * log.THROTTLE_INTERVAL тиков на подсистему: сломанный модуль бросает
 * исключение КАЖДЫЙ тик, а каждый console.log в Screeps стоит CPU. Раньше
 * здесь печатались две строки на тик, то есть ошибка сама себя усиливала.
 * @param {string} label
 * @param {Error} error
 */
function reportCatch(label, error) {
  log.warnThrottled(
    "empire:" + label,
    () => `[${label}] Ошибка: ${error.message}\n${error.stack}`,
  );
}

module.exports.run = function () {
  try {
    cpuMonitor.startTick();
  } catch (error) {
    reportCatch("cpuMonitor.startTick", error);
  }

  // 1. Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. Инициализация глобальных кэшей (самопосборка после Global Reset)
  initGlobalCaches();

  // 2.5. Состояние шарда в Memory (аудит п. 10 / задача 12): комнаты, ID
  // линков, клетки контейнеров, маршруты, обход обсервера, комнаты риска и
  // точка сбора. ensure() заполняет только ОТСУТСТВУЮЩИЕ ключи текущими
  // значениями из constants, поэтому правки владельца в Memory не затираются,
  // а первый тик после Global Reset восстанавливает прежнее поведение.
  try {
    shardState.ensure();
  } catch (error) {
    reportCatch("shardState.ensure", error);
  }

  // 3. Гейт по bucket: при критически низком запасе CPU необязательные
  // подсистемы (разведка, межкомнатная логистика, рынок) в этом тике не
  // запускаются. Их работу можно отложить, а ядро (комнаты, оборона,
  // ремоут) обязано отработать: иначе скрипт упрётся в CPU-лимит движка,
  // итерация оборвётся, а bucket просядет ещё глубже. Порог — существующая
  // константа CPU.BUCKET_CRITICAL (constants.js), по ней же cpuMonitor
  // помечает bucket как критичный.
  const bucketLow = Game.cpu.bucket < CPU.BUCKET_CRITICAL;
  if (bucketLow && Game.time % CPU.REPORT_INTERVAL === 0) {
    console.log(
      `[empire] bucket ${Game.cpu.bucket} < ${CPU.BUCKET_CRITICAL}: ` +
        "пропущены observerManager, terminalNetwork, marketManager",
    );
  }

  // 4. Уровень комнат — вся комнатная логика внутри roomManager
  try {
    cpuMonitor.trackRole("roomManager", () => roomManager.run());
  } catch (error) {
    reportCatch("roomManager", error);
  }

  // 5. Разведка (необязательная подсистема: пропуск при критичном bucket)
  if (!bucketLow) {
    try {
      cpuMonitor.trackRole("observerManager", () => observerManager.run());
    } catch (error) {
      reportCatch("observerManager", error);
    }
  }

  // 6. Оборона — защита ремоут-комнат
  try {
    cpuMonitor.trackRole("defenseManager", () => defenseManager.run());
  } catch (error) {
    reportCatch("defenseManager", error);
  }

  // 7. Дальняя добыча — резервер / дальний майнер / дальний хайлер
  try {
    cpuMonitor.trackRole("remoteManager", () => remoteManager.run());
  } catch (error) {
    reportCatch("remoteManager", error);
  }

  // 8. TerminalNetwork — межкомнатная балансировка ресурсов
  // (необязательная подсистема: пропуск при критичном bucket)
  if (!bucketLow) {
    try {
      cpuMonitor.trackRole("terminalNetwork", () => terminalNetwork.run());
    } catch (error) {
      reportCatch("terminalNetwork", error);
    }
  }

  // 9. Рынок империального уровня
  // (необязательная подсистема: пропуск при критичном bucket)
  if (!bucketLow) {
    try {
      cpuMonitor.trackRole("marketManager", () => marketManager.run());
    } catch (error) {
      reportCatch("marketManager", error);
    }
  }

  try {
    cpuMonitor.endTick();
  } catch (error) {
    reportCatch("cpuMonitor.endTick", error);
  }
};
