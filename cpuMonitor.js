/**
 * ===================================================
 * CPUMONITOR.JS — Монитор потребления CPU
 * ===================================================
 * Screeps даёт лимит CPU в тик (обычно 20 единиц для новых аккаунтов).
 * Сверх лимита идёт в "bucket" — запас до 10000 единиц.
 * Если bucket опустеет — скрипт принудительно остановят.
 *
 * Этот модуль:
 * - Считает CPU за тик и по ролям/подсистемам
 * - Ведёт скользящее среднее за последние CPU.AVERAGE_WINDOW тиков
 * - Выводит однострочный отчёт каждые CPU.REPORT_INTERVAL тиков
 * - Выводит разбор по ролям/подсистемам/комнатам каждые
 *   CPU.PROFILE_REPORT_INTERVAL тиков (средние за окно; замер идёт один тик из
 *   CPU.SAMPLE_INTERVAL — см. ниже)
 *
 * Управление через консоль игры:
 *   Memory.cpuMonitorEnabled = false  — выключить мониторинг
 *   Memory.cpuMonitorEnabled = true   — включить мониторинг
 *   delete Memory.cpuStats            — сбросить статистику
 *
 * Профилирование Room Manager (ТЗ №0, ВРЕМЕННЫЙ измерительный слой):
 *   Memory.cpuStats.profile                 — замеры по блокам (скользящее окно
 *                                             до CPU.PROFILE_MAX_SAMPLES тиков,
 *                                             дальше сбрасывается автоматически)
 *   delete Memory.cpuStats.profile          — сбросить только замеры
 *   require("cpuMonitor").reportProfile()   — напечатать сводку вручную
 * ===================================================
 */
const { CPU } = require("./constants");

// ── ПРОФИЛИРОВАНИЕ ROOM MANAGER (ТЗ №0) ──────────────────────────────────
// Второго независимого мониторинга CPU нет: room.manager.js помечает свои
// крупные блоки именами и измеряет их тем же trackRole-механизмом, что и
// остальные подсистемы, а этот блок только копит и агрегирует результат.
//
// Имена блоков, которые приходят из room.manager.js:
//   roomManager          — весь уровень комнат (ставится в empire.js)
//   roomState            — построение roomState (buildAllRoomStates) целиком
//   taskManager          — генерация задач (task.generators)
//   worker               — выполнение Task System (worker.runner + executors)
//   spawnManager / labManager / towers / linkManager / factoryManager /
//   powerSpawnManager    — соответствующие подсистемы комнаты
//   room:<имя комнаты>   — полная обработка одной комнаты (runRoom)
//   <роль>               — ролевая логика крипов (уже существующие бакеты)
//
// Нагрузка на CPU:
//  * Замер ролей и подсистем идёт не каждый тик, а один тик из
//    CPU.SAMPLE_INTERVAL (см. constants.js): Game.cpu.getUsed() сам стоит
//    ~0.2 мкс, а trackRole на живом shard3 вызывается ~80 раз за тик
//    (47-50 крипов + подсистемы 5 комнат) — это ~0.034 CPU/тик постоянного
//    налога. На «незамерных» тиках trackRole только вызывает callback.
//    Интервал 7 взаимно прост со всеми TASK_GEN_INTERVAL (1/2/3/5) и с
//    интервалами отчётов (10/100), поэтому периодические блоки попадают в
//    выборку равномерно и средние в профиле остаются несмещёнными.
//  * Значения roleCPU складываются в heap-окно (только сложение чисел, без
//    обращений к Memory). Раз в CPU.PROFILE_REPORT_INTERVAL тиков окно
//    переносится в Memory.cpuStats.profile и один раз печатается короткая
//    сводка в консоль.
//  * Memory.cpuStats (total/count/average) обновляется раз в
//    CPU.REPORT_INTERVAL тиков, а не каждый тик: запись в Memory помечает её
//    «грязной» и заставляет движок сериализовать её целиком (36 КБ на живом
//    shard3). Тиковый отчёт — одна строка консоли вместо восьми.
const PROFILE_ROOM_PREFIX = "room:";
const PROFILE_REPORT_INTERVAL = CPU.PROFILE_REPORT_INTERVAL || 100;
// PROFILE_ENABLED === false — измерительный слой выключен целиком: ни замеров
// getUsed, ни накопителей, ни профиля.
const PROFILE_ENABLED = CPU.PROFILE_ENABLED !== false;
// Один замерный тик на столько. 1 — «как раньше»: замер каждый тик.
const SAMPLE_INTERVAL = Math.max(1, CPU.SAMPLE_INTERVAL || 1);

// Блоки, которые в сводке печатаются отдельными колонками.
// Всё остальное (бакеты ролей) печатается как «роли».
const PROFILE_MAIN_BLOCKS = [
  "roomManager",
  "roomState",
  "spawnManager",
  "labManager",
  "taskManager",
  "towers",
  "linkManager",
  "factoryManager",
  "powerSpawnManager",
  // Бустирование крипов (boost.manager) — своя колонка, потому что это
  // единственная подсистема, которая подавляет действия крипов (см. room.manager).
  "boostManager",
];

// Блоки уровня империи (ставятся в empire.js) — не роли, в топ ролей не идут.
const PROFILE_EMPIRE_BLOCKS = [
  "observerManager",
  "defenseManager",
  "remoteManager",
  "terminalNetwork",
  "marketManager",
];

/**
 * Новое пустое окно накопления замеров (живёт в heap между тиками).
 * @param {number} [startTick] тик начала окна
 * @returns {{startTick: number, samples: number, blocks: Object, rooms: Object}}
 */
function emptyWindow(startTick) {
  return { startTick: startTick || 0, samples: 0, blocks: {}, rooms: {} };
}

/**
 * Добавляет одно значение в накопитель { sum, max, count }.
 * @param {Object} store
 * @param {string} key
 * @param {number} used
 */
function addUsed(store, key, used) {
  const entry = store[key] || (store[key] = { sum: 0, max: 0, count: 0 });
  entry.sum += used;
  entry.count++;
  if (used > entry.max) entry.max = used;
}

/**
 * Складывает накопители источника в накопители приёмника.
 * @param {Object} target
 * @param {Object} source
 */
function mergeEntries(target, source) {
  for (const key in source) {
    const from = source[key];
    const to = target[key] || (target[key] = { sum: 0, max: 0, count: 0 });
    to.sum += from.sum;
    to.count += from.count;
    if (from.max > to.max) to.max = from.max;
  }
}

/**
 * Среднее за тик: sum / число замеров (тики, когда блок не выполнялся,
 * учитываются как 0). Возвращает строку с 3 знаками.
 * @param {{sum: number}|undefined} entry
 * @param {number} samples
 * @returns {string}
 */
function avgPerTick(entry, samples) {
  return entry && samples > 0 ? (entry.sum / samples).toFixed(3) : "0.000";
}

module.exports = {
  startTick() {
    if (Memory.cpuMonitorEnabled === false) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
    // Замерный ли это тик (см. CPU.SAMPLE_INTERVAL). roleCPU заполняется
    // только на замерных тиках, но обнуляется каждый тик — иначе значения
    // прошлого замера попали бы в окно профиля ещё раз.
    this.sampling = PROFILE_ENABLED && Game.time % SAMPLE_INTERVAL === 0;
    this.startCPU = Game.cpu.getUsed();
    this.roleCPU = {};
  },
  /**
   * Измеряет блок и складывает его CPU в бакет роли/подсистемы. На «незамерных»
   * тиках (или при выключенном профиле) не трогает Game.cpu.getUsed вовсе —
   * callback вызывается как обычно, результат возвращается как есть.
   */
  trackRole(role, callback) {
    if (!this.enabled || !this.sampling) {
      return callback();
    }
    const before = Game.cpu.getUsed();
    const result = callback();
    const used = Game.cpu.getUsed() - before;
    this.roleCPU[role] = (this.roleCPU[role] || 0) + used;
    // Результат callback возвращается как есть (нужно room.manager.run(),
    // чтобы получить roomStates) — на поведение старых вызовов не влияет.
    return result;
  },
  endTick() {
    if (!this.enabled) return;
    const totalUsed = Game.cpu.getUsed() - this.startCPU;

    // Накопитель тикового CPU в heap: в Memory он переносится раз в
    // CPU.REPORT_INTERVAL тиков (см. flushStats). После Global Reset
    // накопитель пуст — окно продолжается от значений в Memory.
    this.windowTotal = (this.windowTotal || 0) + totalUsed;
    this.windowCount = (this.windowCount || 0) + 1;

    if (Game.time % CPU.REPORT_INTERVAL === 0) {
      this.flushStats();
      const creepCount = Object.keys(Game.creeps).length;
      const bucket = Game.cpu.bucket;
      const perCreep =
        creepCount > 0 ? (totalUsed / creepCount).toFixed(3) : "n/a";
      const bucketStatus =
        bucket < CPU.BUCKET_CRITICAL
          ? `⚠️ КРИТИЧНО: ${bucket}`
          : String(bucket);
      const stats = /** @type {any} */ (Memory.cpuStats);
      const average = stats && stats.average ? stats.average : totalUsed;
      // Одна строка вместо восьми: console.log сам стоит CPU, а разбор по
      // ролям/подсистемам печатает профиль (раз в PROFILE_REPORT_INTERVAL).
      console.log(
        `[CPU] tick ${Game.time}: ${totalUsed.toFixed(2)} | AVG(${CPU.AVERAGE_WINDOW}): ` +
          `${average.toFixed(2)} | BKT: ${bucketStatus} | крипов: ${creepCount} | ` +
          `CPU/крип: ${perCreep}`,
      );
    }

    // Профилирование Room Manager (ТЗ №0): копим замеры в heap на замерных
    // тиках, в Memory и в консоль сбрасываем раз в CPU.PROFILE_REPORT_INTERVAL
    // тиков.
    this.accumulateProfile();
    if (PROFILE_ENABLED && Game.time % PROFILE_REPORT_INTERVAL === 0) {
      this.flushProfile();
      this.reportProfile();
    }
  },

  /**
   * Переносит накопленные за тики значения тикового CPU в Memory.cpuStats.
   * Интерфейс полей не изменился (total/count/average — скользящее окно
   * CPU.AVERAGE_WINDOW тиков); изменилась только частота записи в Memory:
   * раз в CPU.REPORT_INTERVAL тиков вместо каждого тика.
   */
  flushStats() {
    const count = this.windowCount || 0;
    if (count === 0) return;

    if (!Memory.cpuStats) {
      Memory.cpuStats = { total: 0, count: 0, average: 0 };
    }
    const stats = /** @type {any} */ (Memory.cpuStats);
    stats.total += this.windowTotal;
    stats.count += count;
    stats.average = stats.total / stats.count;
    if (stats.count >= CPU.AVERAGE_WINDOW) {
      stats.total = 0;
      stats.count = 0;
    }
    this.windowTotal = 0;
    this.windowCount = 0;
  },

  /**
   * Складывает замеры текущего тика (this.roleCPU) в heap-окно профиля.
   * Обращений к Memory нет — стоимость близка к нулю.
   * Блоки вида "room:<имя>" учитываются отдельно (по комнатам).
   *
   * На «незамерных» тиках замеров нет вовсе, и такой тик в окно не попадает:
   * иначе средние (sum / samples) упали бы ровно в SAMPLE_INTERVAL раз.
   */
  accumulateProfile() {
    if (!PROFILE_ENABLED) return;
    if (!this.sampling) return;

    if (!this.profileWindow) this.profileWindow = emptyWindow(Game.time);

    const window = this.profileWindow;
    window.samples++;

    const roleCPU = this.roleCPU || {};
    for (const name in roleCPU) {
      const used = roleCPU[name];
      if (name.indexOf(PROFILE_ROOM_PREFIX) === 0) {
        addUsed(window.rooms, name.slice(PROFILE_ROOM_PREFIX.length), used);
      } else {
        addUsed(window.blocks, name, used);
      }
    }
  },

  /**
   * Переносит накопленное heap-окно в Memory.cpuStats.profile.
   * Существующие поля cpuStats (total/count/average) не изменяются:
   * profile — дополнительный подраздел, удаляется отдельно
   * через `delete Memory.cpuStats.profile`.
   *
   * Профиль — ограниченное скользящее окно: когда в нём набралось
   * CPU.PROFILE_MAX_SAMPLES замеров, он автоматически начинается заново
   * (суммы, счётчики и ключи комнат/блоков сбрасываются). Иначе Memory-запись
   * росла бы бессрочно, копя суммы за всю историю шарда и комнаты, которых
   * уже нет.
   */
  flushProfile() {
    const window = this.profileWindow;
    if (!window || window.samples === 0) return;

    if (!Memory.cpuStats) {
      Memory.cpuStats = { total: 0, count: 0, average: 0 };
    }
    const cpuStats = /** @type {any} */ (Memory.cpuStats);
    const maxSamples = CPU.PROFILE_MAX_SAMPLES || 0;
    if (
      !cpuStats.profile ||
      (maxSamples > 0 && cpuStats.profile.samples >= maxSamples)
    ) {
      cpuStats.profile = {
        // Тик начала сбора — от него считается период измерения.
        startTick: window.startTick || Game.time,
        samples: 0,
        blocks: {},
        rooms: {},
      };
    }
    const profile = cpuStats.profile;
    profile.samples += window.samples;
    mergeEntries(profile.blocks, window.blocks);
    mergeEntries(profile.rooms, window.rooms);

    this.profileWindow = emptyWindow();
  },

  /**
   * Печатает короткую сводку профиля (одна строка console.log).
   * Вызывается раз в CPU.PROFILE_REPORT_INTERVAL тиков и вручную из консоли:
   *   require("cpuMonitor").reportProfile()
   * Значения — средний CPU за тик (sum / число замеров), максимумы лежат
   * в Memory.cpuStats.profile.*.max.
   */
  reportProfile() {
    if (!Memory.cpuStats) return;
    const profile = /** @type {any} */ (Memory.cpuStats).profile;
    if (!profile || !profile.samples) return;

    const samples = profile.samples;
    const blocks = profile.blocks;
    const rooms = profile.rooms;
    const at = name => avgPerTick(blocks[name], samples);

    const roomManagerAvg = blocks.roomManager ? blocks.roomManager.sum : 0;
    const roomStateSum = blocks.roomState ? blocks.roomState.sum : 0;
    const roomStateShare =
      roomManagerAvg > 0
        ? ` (${((roomStateSum / roomManagerAvg) * 100).toFixed(1)}% от roomManager)`
        : "";

    const roleList = Object.keys(blocks)
      .filter(
        name =>
          PROFILE_MAIN_BLOCKS.indexOf(name) === -1 &&
          PROFILE_EMPIRE_BLOCKS.indexOf(name) === -1 &&
          name !== "worker",
      )
      .sort((a, b) => blocks[b].sum - blocks[a].sum)
      .slice(0, 5)
      .map(name => `${name} ${at(name)}`)
      .join(" | ");
    const roomList = Object.keys(rooms)
      .sort((a, b) => rooms[b].sum - rooms[a].sum)
      .map(name => `${name} ${avgPerTick(rooms[name], samples)}`)
      .join(" | ");

    console.log(
      `=== CPU PROFILE (ТЗ №0) | tick ${Game.time} | замеров: ${samples} | период: ${Game.time - profile.startTick + 1} тиков (с ${profile.startTick}) ===\n` +
        `roomManager ${at("roomManager")} | roomState ${at("roomState")}${roomStateShare}\n` +
        `taskGen ${at("taskManager")} | TaskSystem ${at("worker")} | spawn ${at("spawnManager")} | lab ${at("labManager")} | boost ${at("boostManager")} | towers ${at("towers")} | link ${at("linkManager")} | factory ${at("factoryManager")} | powerSpawn ${at("powerSpawnManager")}\n` +
        `роли (топ-5): ${roleList || "нет данных"}\n` +
        `комнаты: ${roomList || "нет данных"}`,
    );
  },
};
