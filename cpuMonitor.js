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
 * Управление через консоль игры:
 *   Memory.cpuMonitorEnabled = false  — выключить мониторинг целиком
 *   Memory.cpuMonitorEnabled = true   — включить
 *   Memory.cpuMonitorVerbose = true   — подробный замер по каждому крипу
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

    g.enabled = true;
    g.startCPU = Game.cpu.getUsed();
    g.roleCPU = {};
  },

  /**
   * Замер подсистемы. Вызывается на границах подсистем (спавн, задачи,
   * башни, линки, рынок), но НЕ на каждом крипе — для крипов есть
   * подробный режим в runCreepLogic под флагом cpuMonitorVerbose.
   */
  trackRole(role, callback) {
    const g = heap();

    if (!g.enabled) {
      callback();
      return;
    }

    const before = Game.cpu.getUsed();
    callback();
    g.roleCPU[role] = (g.roleCPU[role] || 0) + (Game.cpu.getUsed() - before);
  },

  /** Включён ли подробный замер по каждому крипу. */
  verboseEnabled() {
    return Memory.cpuMonitorVerbose === true;
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

    if (g.stats.count >= CPU.AVERAGE_WINDOW) {
      g.stats.total = 0;
      g.stats.count = 0;
    }

    if (Game.time % CPU.REPORT_INTERVAL !== 0) return;

    // ── Тик отчёта: единственная запись в Memory за интервал ────────────
    const bucket = Game.cpu.bucket;
    const creepCount = countCreeps();
    const windowTicks = CPU.REPORT_INTERVAL;

    const subsystems = {};
    for (const role in g.roleStats) {
      subsystems[role] = +(g.roleStats[role].sum / windowTicks).toFixed(4);
    }

    Memory.cpuStats = {
      total: g.stats.total,
      count: g.stats.count,
      average: g.average,
      bucket,
      creeps: creepCount,
      subsystems,
    };
    g.roleStats = {};

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

    console.log(`--- TOP ПОДСИСТЕМЫ (CPU/тик за ${windowTicks} тиков) ---`);
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
      average: g.average,
      windowCount: g.stats.count,
      roleCPU: Object.assign({}, g.roleCPU),
    };
  },
};
