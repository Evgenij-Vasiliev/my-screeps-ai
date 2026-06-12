/**
 * ===================================================
 * CPUMONITOR.JS — Монитор потребления CPU
 * ===================================================
 * Screeps даёт лимит CPU в тик (обычно 20 единиц для новых аккаунтов).
 * Сверх лимита идёт в "bucket" — запас до 10000 единиц.
 * Если bucket опустеет — скрипт принудительно остановят.
 *
 * Этот модуль:
 * - Считает CPU за тик и по ролям
 * - Ведёт скользящее среднее за последние 100 тиков
 * - Выводит отчёт каждые 10 тиков
 *
 * Управление через консоль игры:
 *   Memory.cpuMonitorEnabled = false  — выключить мониторинг
 *   Memory.cpuMonitorEnabled = true   — включить мониторинг
 *   delete Memory.cpuStats            — сбросить статистику
 * ===================================================
 */

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
      callback();
      return;
    }
    const before = Game.cpu.getUsed();
    callback();
    const used = Game.cpu.getUsed() - before;
    this.roleCPU[role] = (this.roleCPU[role] || 0) + used;
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

    if (Memory.cpuStats.count >= 100) {
      Memory.cpuStats.total = 0;
      Memory.cpuStats.count = 0;
    }

    if (Game.time % 10 === 0) {
      const perCreep =
        creepCount > 0 ? (totalUsed / creepCount).toFixed(3) : "n/a";
      const bucketStatus =
        bucket < 500 ? `⚠️ КРИТИЧНО: ${bucket}` : String(bucket);

      console.log(`================ [ TICK: ${Game.time} ] ================`);
      console.log(
        `CPU: ${totalUsed.toFixed(
          2,
        )} | AVG(100): ${Memory.cpuStats.average.toFixed(
          2,
        )} | BKT: ${bucketStatus}`,
      );
      console.log(`Крипов: ${creepCount} | CPU/крип: ${perCreep}`);

      const sortedRoles = Object.entries(this.roleCPU)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      console.log(`--- TOP ROLES ---`);
      for (const [role, used] of sortedRoles) {
        console.log(` ${role.padEnd(20)} ${used.toFixed(3)}`);
      }
      console.log(`-------------------------------------------------`);
    }
  },
};
