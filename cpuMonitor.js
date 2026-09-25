/**
 * ===================================================
 * CPUMONITOR.JS — Монитор потребления CPU
 * ===================================================
 * Screeps даёт лимит CPU в тик (обычно 20 единиц для новых аккаунтов).
 * Сверх лимита идёт в "bucket" — запас до 10000 единиц.
 * Если bucket опустеет — скрипт принудительно остановят.
 *
 * Этот модуль:
 * - Считает CPU за тик (общая строка каждые CPU.REPORT_INTERVAL тиков)
 * - Ведёт скользящее среднее за последние CPU.AVERAGE_WINDOW тиков
 * - Выводит разбор по подсистемам/комнатам каждые
 *   CPU.PROFILE_REPORT_INTERVAL тиков (средние за окно; замер идёт один тик из
 *   CPU.SAMPLE_INTERVAL — см. ниже)
 * - Выводит разбор по РОЛЯМ ОТДЕЛЬНО и только по запросу: ролевой замер —
 *   opt-in (`Memory.cpuMonitorRoles`), отчёт — раз в CPU.ROLE_REPORT_INTERVAL
 *   тиков (аудит п. 9: 2 × Game.cpu.getUsed() на каждого крипа каждого тика)
 *
 * Управление через консоль игры:
 *   Memory.cpuMonitorEnabled = false  — выключить мониторинг
 *   Memory.cpuMonitorEnabled = true   — включить мониторинг
 *   Memory.cpuMonitorRoles = true     — ВКЛЮЧИТЬ замер и отчёт по ролям
 *   Memory.cpuMonitorRoles = false    — выключить (по умолчанию)
 *   delete Memory.cpuStats            — сбросить статистику
 *
 * Профилирование Room Manager (ТЗ №0, ВРЕМЕННЫЙ измерительный слой):
 *   Memory.cpuStats.profile                 — замеры по подсистемам и комнатам
 *                                             (скользящее окно до
 *                                             CPU.PROFILE_MAX_SAMPLES тиков,
 *                                             дальше сбрасывается автоматически)
 *   Memory.cpuStats.roles                   — замеры по ролям (отдельное окно,
 *                                             пишется раз в CPU.ROLE_REPORT_INTERVAL
 *                                             тиков; только при включённых ролях)
 *   delete Memory.cpuStats.profile          — сбросить только замеры подсистем
 *   delete Memory.cpuStats.roles            — сбросить только замеры ролей
 *   require("cpuMonitor").reportProfile()   — напечатать сводку по подсистемам
 *   require("cpuMonitor").reportRoles()     — напечатать сводку по ролям
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
//   <роль>               — ролевая логика крипов (ОТДЕЛЬНОЕ окно, opt-in)
//
// Нагрузка на CPU:
//  * Замер подсистем идёт не каждый тик, а один тик из CPU.SAMPLE_INTERVAL
//    (см. constants.js): Game.cpu.getUsed() сам стоит ~0.2 мкс. На «незамерных»
//    тиках trackRole только вызывает callback.
//    Интервал 7 взаимно прост со всеми TASK_GEN_INTERVAL (1/2/3/5) и с
//    интервалами отчётов (10/50/100), поэтому периодические блоки попадают в
//    выборку равномерно и средние в профиле остаются несмещёнными.
//  * РОЛИ — opt-in (Memory.cpuMonitorRoles, по умолчанию выключено): ролевых
//    бакетов на живом shard3 ~50 за тик против ~10 подсистемных, и именно они
//    давали основной налог (~0.034 CPU/тик при замере каждый тик). Выключенные
//    роли не измеряются ВООБЩЕ — callback вызывается, но getUsed не трогается.
//  * Значения roleCPU складываются в heap-окно (только сложение чисел, без
//    обращений к Memory). Раз в CPU.PROFILE_REPORT_INTERVAL тиков окно
//    подсистем переносится в Memory.cpuStats.profile, раз в
//    CPU.ROLE_REPORT_INTERVAL тиков окно ролей — в Memory.cpuStats.roles;
//    каждое сопровождается одной строкой в консоли.
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

// ── РОЛИ: opt-in (аудит п. 9) ────────────────────────────────────────────
// Флаг читается на каждом startTick (не на каждом крипе), поэтому его смена
// из консоли игры действует со следующего тика и global reset не нужен.
const ROLE_REPORT_INTERVAL = Math.max(1, CPU.ROLE_REPORT_INTERVAL || 50);
const ROLE_MAX_SAMPLES = CPU.ROLE_MAX_SAMPLES || 1000;

// Блоки, которые в сводке печатаются отдельными колонками.
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
 * Подсистема ли это (а не роль). Нужно, чтобы при выключенном ролевом
 * мониторинге (Memory.cpuMonitorRoles) подсистемы продолжали замеряться:
 * trackRole не получает признак «роль», а имена ролей приходят из
 * creep.memory.role — то есть классификация идёт по имени бакета.
 * @param {string} name
 * @returns {boolean}
 */
function isSubsystemBlock(name) {
  return (
    name.indexOf(PROFILE_ROOM_PREFIX) === 0 ||
    PROFILE_MAIN_BLOCKS.indexOf(name) !== -1 ||
    PROFILE_EMPIRE_BLOCKS.indexOf(name) !== -1
  );
}

/**
 * Новое пустое окно накопления замеров (живёт в heap между тиками).
 * @param {number} [startTick] тик начала окна
 * @returns {{startTick: number, samples: number, blocks: Object, rooms: Object}}
 */
function emptyWindow(startTick) {
  return { startTick: startTick || 0, samples: 0, blocks: {}, rooms: {} };
}

/**
 * Новое пустое окно накопления замеров ПО РОЛЯМ. Отдельное окно от
 * профиля подсистем: оно переносится в Memory в 2 раза чаще
 * (CPU.ROLE_REPORT_INTERVAL против CPU.PROFILE_REPORT_INTERVAL) и печатается
 * своей строкой, поэтому его начало/сброс считаются независимо.
 * @param {number} [startTick] тик начала окна
 * @returns {{startTick: number, samples: number, roles: Object}}
 */
function emptyRoleWindow(startTick) {
  return { startTick: startTick || 0, samples: 0, roles: {} };
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
    // Ролевой замер — opt-in: флаг живёт в Memory (переживает global reset) и
    // читается один раз за тик, а не на каждого крипа. Проверяется он в
    // trackRole — для каждого ролевого бакета.
    this.roles =
      Memory.cpuMonitorRoles !== undefined
        ? Memory.cpuMonitorRoles === true
        : CPU.ROLE_ENABLED === true;
    this.startCPU = Game.cpu.getUsed();
    this.roleCPU = {};
  },
  /**
   * Измеряет блок и складывает его CPU в бакет роли/подсистемы.
   *
   * Роли — opt-in (`Memory.cpuMonitorRoles`): при выключенном ролевом
   * мониторинге ролевой бакет не измеряется вовсе — callback вызывается как
   * обычно, но Game.cpu.getUsed не трогается ни разу (ради этого гейт и
   * сделан: ролевых бакетов ~50 на тик против ~10 подсистемных).
   *
   * На «незамерных» тиках (или при выключенном профиле) не трогает
   * Game.cpu.getUsed вовсе — callback вызывается как обычно, результат
   * возвращается как есть.
   *
   * @param {string} role имя бакета: роль крипа (creep.memory.role),
   *   подсистема (PROFILE_*_BLOCKS) или комната ("room:<имя>")
   * @param {Function} callback
   * @param {boolean} [isRole] явный признак «это роль»; при undefined
   *   классификация идёт по имени (см. isSubsystemBlock)
   * @returns {*} результат callback
   */
  trackRole(role, callback, isRole) {
    // Роли и подсистемы различимы по имени бакета: подсистемы перечислены в
    // PROFILE_*_BLOCKS, комнаты идут с префиксом "room:", всё остальное — роль
    // (имя роли у крипа = имя бакета, см. room.manager.runCreepLogic). Третий
    // аргумент оставлен на случай вызова из места, где классификация по имени
    // неочевидна; для ролей гейт работает независимо от него.
    const roleBucket =
      isRole === true ||
      (isRole === undefined && !isSubsystemBlock(role));
    if (roleBucket && !this.roles) {
      // Роли выключены: callback выполняется как обычно, но НИ ОДНОГО
      // Game.cpu.getUsed() не вызывается — в этом и смысл opt-in.
      return callback();
    }
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
      // Одна строка вместо восьми: console.log сам стоит CPU. Разбор по
      // подсистемам печатает профиль (раз в PROFILE_REPORT_INTERVAL тиков),
      // разбор по ролям — отдельный отчёт reportRoles (только если роли
      // включены флагом Memory.cpuMonitorRoles).
      console.log(
        `[CPU] tick ${Game.time}: ${totalUsed.toFixed(2)} | AVG(${CPU.AVERAGE_WINDOW}): ` +
          `${average.toFixed(2)} | BKT: ${bucketStatus} | крипов: ${creepCount} | ` +
          `CPU/крип: ${perCreep}`,
      );
    }

    // Профилирование Room Manager (ТЗ №0): копим замеры в heap на замерных
    // тиках, в Memory и в консоль сбрасываем раз в CPU.PROFILE_REPORT_INTERVAL
    // тиков (подсистемы и комнаты) и раз в CPU.ROLE_REPORT_INTERVAL тиков
    // (роли — своё окно и своя строка, см. reportRoles).
    const roleBuckets = this.accumulateProfile();
    this.accumulateRoles(roleBuckets);
    if (PROFILE_ENABLED && Game.time % PROFILE_REPORT_INTERVAL === 0) {
      this.flushProfile();
      this.reportProfile();
    }
    // Ролевой отчёт — только при включённом opt-in: пока роли не замеряются,
    // ни окна, ни записи в Memory, ни строки в консоли нет.
    if (PROFILE_ENABLED && this.roles && Game.time % ROLE_REPORT_INTERVAL === 0) {
      this.flushRoles();
      this.reportRoles();
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
   * Складывает замеры текущего тика (this.roleCPU) в heap-окно ПОДСИСТЕМ.
   * Обращений к Memory нет — стоимость близка к нулю.
   * Блоки вида "room:<имя>" учитываются отдельно (по комнатам), роли сюда
   * НЕ попадают — у них своё окно (accumulateRoles): иначе роль попала бы
   * в Memory.cpuStats.profile как «подсистема».
   *
   * На «незамерных» тиках замеров нет вовсе, и такой тик в окно не попадает:
   * иначе средние (sum / samples) упали бы ровно в SAMPLE_INTERVAL раз.
   *
   * @returns {string[]} имена ролевых бакетов (классификация делается один
   *   раз за бакет и переиспользуется в accumulateRoles)
   */
  accumulateProfile() {
    if (!PROFILE_ENABLED) return [];
    if (!this.sampling) return [];

    if (!this.profileWindow) this.profileWindow = emptyWindow(Game.time);

    const window = this.profileWindow;
    window.samples++;

    const roleCPU = this.roleCPU || {};
    const roles = [];
    for (const name in roleCPU) {
      const used = roleCPU[name];
      if (name.indexOf(PROFILE_ROOM_PREFIX) === 0) {
        addUsed(window.rooms, name.slice(PROFILE_ROOM_PREFIX.length), used);
      } else if (isSubsystemBlock(name)) {
        addUsed(window.blocks, name, used);
      } else {
        roles.push(name);
      }
    }
    return roles;
  },

  /**
   * Складывает замеры ролей текущего тика в отдельное heap-окно (ролевой
   * отчёт переносится в Memory чаще профильного — CPU.ROLE_REPORT_INTERVAL).
   * Список ролей приходит из accumulateProfile, чтобы классификация не
   * повторялась (замерных тиков немного, но ролей на них ~50).
   *
   * @param {string[]} [roleNames] роли текущего тика; при отсутствии берётся
   *   this.roleCPU целиком (ручной вызов — классификации нет, потому что
   *   accumulateProfile уже отделил роли от подсистем)
   */
  accumulateRoles(roleNames) {
    if (!PROFILE_ENABLED || !this.roles || !this.sampling) return;

    const roleCPU = this.roleCPU || {};
    const names = roleNames || Object.keys(roleCPU);
    let window = null;
    for (const name of names) {
      if (roleCPU[name] === undefined) continue;
      if (!window) {
        if (!this.roleWindow) this.roleWindow = emptyRoleWindow(Game.time);
        window = this.roleWindow;
        window.samples++;
      }
      addUsed(window.roles, name, roleCPU[name]);
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
   * Переносит накопленное heap-окно РОЛЕЙ в Memory.cpuStats.roles.
   * Своё окно (не profile) — ролевой отчёт сбрасывается чаще
   * (CPU.ROLE_REPORT_INTERVAL) и удаляется отдельно:
   *   delete Memory.cpuStats.roles
   *
   * Как и profile, это ограниченное скользящее окно: при CPU.ROLE_MAX_SAMPLES
   * замеров (или при смене шапки окна) оно начинается заново, чтобы запись в
   * Memory не росла бессрочно.
   */
  flushRoles() {
    const window = this.roleWindow;
    if (!window || window.samples === 0) return;

    if (!Memory.cpuStats) {
      Memory.cpuStats = { total: 0, count: 0, average: 0 };
    }
    const cpuStats = /** @type {any} */ (Memory.cpuStats);
    const maxSamples = ROLE_MAX_SAMPLES || 0;
    if (
      !cpuStats.roles ||
      (maxSamples > 0 && cpuStats.roles.samples >= maxSamples)
    ) {
      cpuStats.roles = {
        startTick: window.startTick || Game.time,
        samples: 0,
        roles: {},
      };
    }
    const roles = cpuStats.roles;
    roles.samples += window.samples;
    mergeEntries(roles.roles, window.roles);

    this.roleWindow = emptyRoleWindow();
  },

  /**
   * Печатает короткую сводку профиля (одна строка console.log).
   * Вызывается раз в CPU.PROFILE_REPORT_INTERVAL тиков и вручную из консоли:
   *   require("cpuMonitor").reportProfile()
   * Значения — средний CPU за тик (sum / число замеров), максимумы лежат
   * в Memory.cpuStats.profile.*.max. Ролей здесь нет: они — opt-in и печатаются
   * отдельной строкой (reportRoles), чтобы выключенный ролевой замер не
   * оставлял в сводке пустую секцию.
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

    const roomList = Object.keys(rooms)
      .sort((a, b) => rooms[b].sum - rooms[a].sum)
      .map(name => `${name} ${avgPerTick(rooms[name], samples)}`)
      .join(" | ");

    console.log(
      `=== CPU PROFILE (ТЗ №0) | tick ${Game.time} | замеров: ${samples} | период: ${Game.time - profile.startTick + 1} тиков (с ${profile.startTick}) ===\n` +
        `roomManager ${at("roomManager")} | roomState ${at("roomState")}${roomStateShare}\n` +
        `taskGen ${at("taskManager")} | TaskSystem ${at("worker")} | spawn ${at("spawnManager")} | lab ${at("labManager")} | boost ${at("boostManager")} | towers ${at("towers")} | link ${at("linkManager")} | factory ${at("factoryManager")} | powerSpawn ${at("powerSpawnManager")}\n` +
        `комнаты: ${roomList || "нет данных"}`,
    );
  },

  /**
   * Печатает короткую сводку по РОЛЯМ (одна строка console.log).
   *
   * Вызывается раз в CPU.ROLE_REPORT_INTERVAL тиков, но ТОЛЬКО при включённом
   * opt-in (Memory.cpuMonitorRoles), и вручную из консоли:
   *   require("cpuMonitor").reportRoles()
   * Значения — средний CPU за тик (sum / число замерных тиков окна);
   * максимумы лежат в Memory.cpuStats.roles.roles.*.max.
   *
   * Печатается топ-6: цель отчёта — найти, кто съел CPU, а не перечислить
   * все роли (полный список лежит в Memory.cpuStats.roles).
   */
  reportRoles() {
    if (!Memory.cpuStats) return;
    const stored = /** @type {any} */ (Memory.cpuStats).roles;
    // Окно текущего (ещё не сброшенного) периода добавляется к тому, что уже
    // лежит в Memory, чтобы ручной вызов из консоли сразу после сброса не
    // показывал «нет данных».
    const pending = this.roleWindow;
    if ((!stored || !stored.samples) && (!pending || !pending.samples)) return;

    const roles = {};
    const samples = (stored ? stored.samples : 0) +
      (pending && pending.samples ? pending.samples : 0);
    if (stored) mergeEntries(roles, stored.roles || {});
    if (pending) mergeEntries(roles, pending.roles || {});
    if (samples === 0) return;

    const list = Object.keys(roles)
      .sort((a, b) => roles[b].sum - roles[a].sum)
      .slice(0, 6)
      .map(name => `${name} ${avgPerTick(roles[name], samples)}`)
      .join(" | ");

    const since = stored && stored.startTick ? stored.startTick : Game.time;
    console.log(
      `=== CPU ROLES | tick ${Game.time} | замеров: ${samples} | с ${since} ===\n` +
        `роли (топ-6, средний CPU/тик): ${list || "нет данных"}`,
    );
  },
};
