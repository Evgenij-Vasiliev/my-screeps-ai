/**
 * ===================================================
 * CPUMONITOR.JS — Монитор потребления CPU
 * ===================================================
 * Screeps даёт лимит CPU в тик (обычно 20 единиц для новых аккаунтов).
 * Сверх лимита идёт в "bucket" — запас до 10000 единиц.
 * Если bucket опустеет — скрипт принудительно остановят.
 *
 * Этот модуль:
 * - считает CPU за тик и по подсистемам (trackRole);
 * - ведёт скользящее среднее за CPU.AVERAGE_WINDOW тиков;
 * - раз в CPU.REPORT_INTERVAL тиков пишет срез в Memory и печатает отчёт.
 *
 * ЭКОНОМИЯ (задание 3 плана docs/CPU-OPTIMIZATION-PLAN.md):
 * - накопители живут в heap (global), а не в Memory: Memory трогается
 *   один раз за CPU.REPORT_INTERVAL тиков, а не каждый тик;
 * - Object.keys(Game.creeps) (замерено ~0.0035 CPU на вызов) считается
 *   только в тик отчёта;
 * - подробный замер ПО КАЖДОМУ КРИПУ выключен по умолчанию и включается
 *   флагом Memory.cpuMonitorVerbose — иначе на каждого крипа тратились
 *   два Game.cpu.getUsed() и замыкание.
 *
 * ПРОФИЛИРОВАНИЕ ПО ТРЕБОВАНИЮ (Шаг 7, два замера shard3 29.09.2026):
 * замер внутри trackRole стоит 0.0007-0.0017 CPU за вызов
 * (scripts/profiling.measure.js, docs/PROFILING-ON-DEMAND.md), при 27 вызовах
 * за тик — 0.019-0.046 CPU/тик. Поэтому подробная разбивка по подсистемам
 * собирается НЕ всегда:
 *   - если средний расход ПРОШЛОГО тика выше CPU.DETAIL_GATE_PCT (0.8) от
 *     Game.cpu.limit ИЛИ bucket не полон, trackRole работает как «грубый
 *     таймер»: один вызов колбэка без замеров (при лимите 20 порог 16 CPU);
 *   - при полном bucket раз в CPU.VERBOSE_INTERVAL тиков включается и
 *     поролевой профиль по крипам (без ручного флага).
 *
 * Управление через консоль игры:
 *   Memory.cpuMonitorEnabled = false  — выключить мониторинг целиком
 *   Memory.cpuMonitorEnabled = true   — включить
 *   Memory.cpuMonitorVerbose = true   — подробный замер по каждому крипу
 *   Memory.cpuMonitorVerbose = false  — запретить и автозамер тоже
 *   delete Memory.cpuStats            — сбросить статистику
 * ===================================================
 */
const { CPU } = require("./constants");

/**
 * Состояние монитора в heap.
 * global переживает тики, но не рестарт симулятора — поэтому всё, что
 * должно пережить рестарт, по-прежнему пишется в Memory (но редко).
 */
function heap() {
  if (!global.__cpuMonitor) {
    global.__cpuMonitor = {
      enabled: true,
      startCPU: 0,
      roleCPU: {},
      // Решение текущего тика: собирать ли подробную разбивку по подсистемам.
      detail: false,
      // Сколько тиков текущего окна реально профилировалось — это знаменатель
      // отчёта: делить сумму подробных замеров на всё окно нельзя.
      profiledTicks: 0,
      // Обратный отсчёт до автоматического поролевого профиля.
      verboseIn: CPU.VERBOSE_INTERVAL,
      // Накопители текущего окна AVERAGE_WINDOW тиков.
      stats: { total: 0, count: 0 },
      // Накопители по подсистемам за то же окно.
      roleStats: {},
      // Последнее посчитанное среднее — чтобы писать его в Memory без пересчёта.
      average: 0,
      creeps: 0,
    };
  }
  return global.__cpuMonitor;
}

/** Число крипов империи. Дорогой вызов — только в тик отчёта. */
function countCreeps() {
  const creeps = Game.creeps;
  let n = 0;
  for (const name in creeps) {
    if (creeps[name]) n++;
  }
  return n;
}

module.exports = {
  startTick() {
    const g = heap();

    if (Memory.cpuMonitorEnabled === false) {
      g.enabled = false;
      return;
    }

    // Сигнал гейта — средний расход ПРОШЛОГО тика (g.average, обновляется в
    // endTick). Счётчик текущего тика для этого не годится: startTick вызван
    // первой строкой loop (empire.js:12), где getUsed() показывает цену
    // запуска VM (~0.0003 CPU), а не цену тика, поэтому порог не достигался
    // бы никогда (docs/PROFILING-ON-DEMAND.md, раздел 4a).
    //
    // Условие — «bucket полон И загрузка ниже порога»: пока запас есть, меряем
    // (сегодня 4-5 CPU при лимите 20); когда бюджет уходит в работу, замер
    // замолкает и экономит 0.019-0.046 CPU/тик. Решение принимается ОДИН раз
    // на тик и живёт в heap: вызовы trackRole внутри тика не расходятся.
    const avg = g.average;
    const bucket = Game.cpu.bucket;

    g.enabled = true;
    g.startCPU = Game.cpu.getUsed();
    g.roleCPU = {};
    g.detail =
      avg <= Game.cpu.limit * CPU.DETAIL_GATE_PCT && bucket === CPU.FULL_BUCKET;

    // Поролевой профиль — по требованию. Ручной флаг главнее:
    //   true  — мерить каждый тик (счётчик не трогаем);
    //   false — запретить и автозамер;
    //   не задан — раз в CPU.VERBOSE_INTERVAL тиков при полном bucket.
    const manual = Memory.cpuMonitorVerbose;
    let autoDue = false;
    if (manual !== true && manual !== false) {
      g.verboseIn = (g.verboseIn === undefined ? CPU.VERBOSE_INTERVAL : g.verboseIn) - 1;
      if (g.verboseIn <= 0) {
        g.verboseIn = CPU.VERBOSE_INTERVAL;
        autoDue = true;
      }
    }

    g.verboseNow =
      g.detail && bucket === CPU.FULL_BUCKET && (manual === true || autoDue);
  },

  /**
   * Замер подсистемы. Вызывается на границах подсистем (спавн, задачи,
   * башни, линки, рынок), но НЕ на каждом крипе — для крипов есть
   * подробный режим в runCreepLogic под флагом cpuMonitorVerbose.
   *
   * Если загрузка выше порога или bucket не полон (решение принято в
   * startTick, см. CPU.DETAIL_GATE_PCT), замер не делается: колбэк
   * исполняется напрямую, без двух Game.cpu.getUsed() и записи.
   * Разбивка по подсистемам в отчёте нормируется на число РЕАЛЬНО
   * профилированных тиков, поэтому пропуск тика её не занижает.
   */
  trackRole(role, callback) {
    const g = heap();

    if (!g.enabled || !g.detail) {
      callback();
      return;
    }

    const before = Game.cpu.getUsed();
    callback();
    g.roleCPU[role] = (g.roleCPU[role] || 0) + (Game.cpu.getUsed() - before);
  },

  /** Собирает ли текущий тик подробную разбивку по подсистемам. */
  subsystemsEnabled() {
    return heap().detail;
  },

  /**
   * Учесть УЖЕ измеренное время подсистемы: без колбэка, без замыкания и без
   * собственных Game.cpu.getUsed().
   *
   * Нужен там, где замер включается флагом и разбит на части внутри одного
   * вызова (spawn.manager: find / countRoles / цикл квот). Через trackRole это
   * стоило бы замыкания на каждую часть каждой комнаты каждый тик — то есть
   * ровно того, что оптимизируется.
   *
   * Гейт тот же, что у trackRole (CPU.DETAIL_GATE_PCT): при закрытом detail
   * замер не собирается, иначе разбивка смешала бы профилированные тики с
   * непрофилированными — знаменатель в endTick это profiledTicks.
   */
  acc(role, cpu) {
    const g = heap();
    if (!g.enabled || !g.detail) return;
    g.roleCPU[role] = (g.roleCPU[role] || 0) + cpu;
  },

  /**
   * Включён ли подробный замер по каждому крипу на ЭТОМ тике.
   * Ручной флаг Memory.cpuMonitorVerbose главнее автозамера:
   *   true  — включить; false — запретить и автоматику;
   *   не задан — автозамер раз в CPU.VERBOSE_INTERVAL тиков при полном bucket.
   *
   * Гейт CPU.DETAIL_GATE_PCT действует и на ручной флаг: при закрытом гейте
   * подсистемы не мерятся (trackRole идёт быстрым путём), поэтому поролевой
   * замер крипов тоже не собирается — иначе `roleCPU` смешал бы замеры крипов
   * с незамеренными подсистемами, а быстрый путь runCreepLogic всё равно
   * обошёл бы замер.
   */
  verboseEnabled() {
    const g = heap();
    if (!g.enabled || !g.detail) return false;

    const manual = Memory.cpuMonitorVerbose;
    if (manual === true) return true;
    if (manual === false) return false;

    return g.verboseNow === true;
  },

  endTick() {
    const g = heap();
    if (!g.enabled) return;

    const totalUsed = Game.cpu.getUsed() - g.startCPU;

    // Накопление — только в heap, Memory не трогается.
    g.stats.total += totalUsed;
    g.stats.count++;
    g.average = g.stats.total / g.stats.count;

    for (const role in g.roleCPU) {
      const s = (g.roleStats[role] = g.roleStats[role] || { sum: 0, max: 0 });
      const used = g.roleCPU[role];
      s.sum += used;
      if (used > s.max) s.max = used;
    }
    if (g.detail) g.profiledTicks++;

    // Поролевой счётчик крипов идёт своим ходом: подробный замер мог не
    // включиться (профиль по требованию), но расписание сдвигать нельзя.
    if (g.verboseNow) g.verboseIn = CPU.VERBOSE_INTERVAL;

    if (g.stats.count >= CPU.AVERAGE_WINDOW) {
      g.stats.total = 0;
      g.stats.count = 0;
    }

    if (Game.time % CPU.REPORT_INTERVAL !== 0) return;

    // ── Тик отчёта: единственная запись в Memory за интервал ────────────
    const bucket = Game.cpu.bucket;
    const windowTicks = CPU.REPORT_INTERVAL;
    const profiled = g.profiledTicks;

    // Знаменатель разбивки — число РЕАЛЬНО профилированных тиков окна, а не
    // всё окно: при профилировании по требованию часть тиков измеряется
    // грубым таймером, и деление на windowTicks занизило бы цифры в разы.
    // Если подробных тиков не было вовсе — отдаём прошлый срез без изменений.
    let subsystems;
    let profilable;
    if (profiled > 0) {
      subsystems = {};
      for (const role in g.roleStats) {
        subsystems[role] = +(g.roleStats[role].sum / profiled).toFixed(4);
      }
      profilable = true;
    } else if (Memory.cpuStats && Memory.cpuStats.subsystems) {
      subsystems = Memory.cpuStats.subsystems;
      profilable = false;
    } else {
      subsystems = {};
      profilable = false;
    }

    // Крипы считаются только если подробный замер действительно был —
    // Object.keys(Game.creeps) стоит ~0.0035 CPU (см. шапку модуля).
    const creepCount = profilable || g.verboseNow ? countCreeps() : 0;

    Memory.cpuStats = {
      total: g.stats.total,
      count: g.stats.count,
      average: g.average,
      bucket,
      creeps: creepCount,
      subsystems,
    };
    g.roleStats = {};
    g.profiledTicks = 0;

    // ── Отчёт в консоль ────────────────────────────────────────────────
    const perCreep =
      creepCount > 0 ? (totalUsed / creepCount).toFixed(3) : "n/a";
    const bucketStatus =
      bucket < CPU.BUCKET_CRITICAL ? `⚠️ КРИТИЧНО: ${bucket}` : String(bucket);

    console.log(`================ [ TICK: ${Game.time} ] ================`);
    console.log(
      `CPU: ${totalUsed.toFixed(2)} | AVG(${
        CPU.AVERAGE_WINDOW
      }): ${g.average.toFixed(2)} | BKT: ${bucketStatus}`,
    );
    console.log(`Крипов: ${creepCount} | CPU/крип: ${perCreep}`);

    const sortedRoles = Object.entries(subsystems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    if (!profilable && !g.detail) {
      console.log(
        `--- ПОДРОБНЫЙ ЗАМЕР ВЫКЛЮЧЕН (тик дороже CPU.DETAIL_GATE_PCT = ${
          CPU.DETAIL_GATE_PCT * 100
        }% лимита) — показан прошлый срез ---`,
      );
    } else {
      console.log(
        `--- TOP ПОДСИСТЕМЫ (CPU/тик за ${profiled} профилированных тиков из ${windowTicks}) ---`,
      );
    }
    for (const [role, used] of sortedRoles) {
      console.log(` ${role.padEnd(20)} ${used.toFixed(3)}`);
    }
    console.log(`-------------------------------------------------`);
  },

  /** Срез текущего состояния — для консоли и тестов. */
  snapshot() {
    const g = heap();
    return {
      enabled: g.enabled,
      detail: g.detail,
      profiledTicks: g.profiledTicks,
      verboseIn: g.verboseIn,
      verboseNow: g.verboseNow === true,
      average: g.average,
      windowCount: g.stats.count,
      roleCPU: Object.assign({}, g.roleCPU),
    };
  },
};
