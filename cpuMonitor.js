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
 * - Выводит отчёт каждые CPU.REPORT_INTERVAL тиков
 *
 * Управление через консоль игры:
 *   Memory.cpuMonitorEnabled = false  — выключить мониторинг
 *   Memory.cpuMonitorEnabled = true   — включить мониторинг
 *   delete Memory.cpuStats            — сбросить статистику
 *
 * Профилирование Room Manager (ТЗ №0, ВРЕМЕННЫЙ измерительный слой):
 *   Memory.cpuStats.profile                 — накопленные замеры по блокам
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
// Нагрузка на CPU: каждый тик значения roleCPU складываются в heap-окно
// (только сложение чисел, без обращений к Memory). Раз в
// CPU.PROFILE_REPORT_INTERVAL тиков окно переносится в
// Memory.cpuStats.profile и один раз печатается короткая сводка в консоль.
const PROFILE_ROOM_PREFIX = "room:";
const PROFILE_REPORT_INTERVAL = CPU.PROFILE_REPORT_INTERVAL || 100;

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
    this.startCPU = Game.cpu.getUsed();
    this.roleCPU = {};
    this.enabled = true;
  },
  trackRole(role, callback) {
    if (!this.enabled) {
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
    const bucket = Game.cpu.bucket;
    const creepCount = Object.keys(Game.creeps).length;
    if (!Memory.cpuStats) {
      Memory.cpuStats = { total: 0, count: 0, average: 0 };
    }
    Memory.cpuStats.total += totalUsed;
    Memory.cpuStats.count++;
    Memory.cpuStats.average = Memory.cpuStats.total / Memory.cpuStats.count;
    if (Memory.cpuStats.count >= CPU.AVERAGE_WINDOW) {
      Memory.cpuStats.total = 0;
      Memory.cpuStats.count = 0;
    }
    if (Game.time % CPU.REPORT_INTERVAL === 0) {
      const perCreep =
        creepCount > 0 ? (totalUsed / creepCount).toFixed(3) : "n/a";
      const bucketStatus =
        bucket < CPU.BUCKET_CRITICAL
          ? `⚠️ КРИТИЧНО: ${bucket}`
          : String(bucket);
      console.log(`================ [ TICK: ${Game.time} ] ================`);
      console.log(
        `CPU: ${totalUsed.toFixed(2)} | AVG(${
          CPU.AVERAGE_WINDOW
        }): ${Memory.cpuStats.average.toFixed(2)} | BKT: ${bucketStatus}`,
      );
      console.log(`Крипов: ${creepCount} | CPU/крип: ${perCreep}`);
      const sortedRoles = Object.entries(this.roleCPU)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      console.log(`--- TOP РОЛИ/ПОДСИСТЕМЫ ---`);
      for (const [role, used] of sortedRoles) {
        console.log(` ${role.padEnd(20)} ${used.toFixed(3)}`);
      }
      console.log(`-------------------------------------------------`);
    }

    // Профилирование Room Manager (ТЗ №0): копим замеры в heap каждый тик,
    // в Memory и в консоль сбрасываем раз в CPU.PROFILE_REPORT_INTERVAL тиков.
    this.accumulateProfile();
    if (
      CPU.PROFILE_ENABLED !== false &&
      Game.time % PROFILE_REPORT_INTERVAL === 0
    ) {
      this.flushProfile();
      this.reportProfile();
    }
  },

  /**
   * Складывает замеры текущего тика (this.roleCPU) в heap-окно профиля.
   * Обращений к Memory нет — стоимость близка к нулю.
   * Блоки вида "room:<имя>" учитываются отдельно (по комнатам).
   */
  accumulateProfile() {
    if (CPU.PROFILE_ENABLED === false) return;

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
   */
  flushProfile() {
    const window = this.profileWindow;
    if (!window || window.samples === 0) return;

    if (!Memory.cpuStats) {
      Memory.cpuStats = { total: 0, count: 0, average: 0 };
    }
    const cpuStats = /** @type {any} */ (Memory.cpuStats);
    if (!cpuStats.profile) {
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
        `taskGen ${at("taskManager")} | TaskSystem ${at("worker")} | spawn ${at("spawnManager")} | lab ${at("labManager")} | towers ${at("towers")} | link ${at("linkManager")} | factory ${at("factoryManager")} | powerSpawn ${at("powerSpawnManager")}\n` +
        `роли (топ-5): ${roleList || "нет данных"}\n` +
        `комнаты: ${roomList || "нет данных"}`,
    );
  },
};
