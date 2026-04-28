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
  /**
   * startTick — вызывается в начале каждого тика (первым делом в main.js).
   * Запоминает точку отсчёта CPU и сбрасывает статистику ролей.
   */
  startTick() {
    // Если мониторинг выключен вручную — ничего не делаем
    if (Memory.cpuMonitorEnabled === false) {
      this.enabled = false;
      return;
    }

    // Game.cpu.getUsed() — сколько CPU уже потрачено в этом тике.
    // В начале тика это почти 0, но не ровно 0 — движок тоже тратит чуть-чуть.
    this.startCPU = Game.cpu.getUsed();

    // roleCPU — словарь { "роль": потраченное_CPU } за этот тик
    // Сбрасываем каждый тик, чтобы данные были свежими
    this.roleCPU = {};

    this.enabled = true;
  },

  /**
   * trackRole — измеряет CPU потраченное на один вызов callback.
   * Используется в main.js для каждой роли и roomManager.
   *
   * Пример использования:
   *   cpuMonitor.trackRole("miner", () => roleMiner.run(creep));
   *
   * @param {string}   role     — название роли (для отчёта)
   * @param {function} callback — функция которую измеряем
   */
  trackRole(role, callback) {
    // Если мониторинг выключен — просто выполняем без измерений
    if (!this.enabled) {
      callback();
      return;
    }

    const before = Game.cpu.getUsed();
    callback();
    const used = Game.cpu.getUsed() - before;

    // Суммируем: одна роль может вызываться много раз за тик
    // (например, если крипов одной роли несколько)
    this.roleCPU[role] = (this.roleCPU[role] || 0) + used;
  },

  /**
   * endTick — вызывается в конце каждого тика (последним в main.js).
   * Считает итоги и выводит отчёт.
   */
  endTick() {
    if (!this.enabled) return;

    // Сколько CPU потратил весь наш скрипт за этот тик
    const totalUsed = Game.cpu.getUsed() - this.startCPU;

    // bucket — запас CPU. Копится когда тратим меньше лимита.
    // Максимум 10000. Если упадёт до 0 — скрипт заблокируют на несколько тиков.
    const bucket = Game.cpu.bucket;

    const creepCount = Object.keys(Game.creeps).length;

    /**
     * СКОЛЬЗЯЩЕЕ СРЕДНЕЕ
     *
     * Идея: храним сумму и количество замеров.
     * Среднее = сумма / количество.
     *
     * ИСПРАВЛЕНИЕ: раньше при сбросе (count >= 100) в total записывалось
     * среднее — это ломало математику следующих 100 тиков.
     * Теперь просто сбрасываем total и count в 0 каждые 100 тиков.
     * Среднее считаем честно от реальных данных.
     */
    if (!Memory.cpuStats) {
      Memory.cpuStats = { total: 0, count: 0, average: 0 };
    }

    Memory.cpuStats.total += totalUsed;
    Memory.cpuStats.count++;

    // Пересчитываем среднее каждый тик
    Memory.cpuStats.average = Memory.cpuStats.total / Memory.cpuStats.count;

    // Каждые 100 тиков сбрасываем накопители — начинаем новое окно.
    // Так среднее отражает последние 100 тиков, а не всю историю игры.
    if (Memory.cpuStats.count >= 100) {
      Memory.cpuStats.total = 0;
      Memory.cpuStats.count = 0;
      // average не трогаем — пусть показывает последнее посчитанное
    }

    /**
     * ВЫВОД ОТЧЁТА — раз в 10 тиков
     * Game.time % 10 === 0 означает "каждые 10 тиков"
     */
    if (Game.time % 10 === 0) {
      // CPU на одного крипа — помогает понять эффективность кода
      const perCreep =
        creepCount > 0 ? (totalUsed / creepCount).toFixed(3) : "n/a";

      // Предупреждение если bucket критически низкий
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

      /**
       * ТОП-5 ролей по потреблению CPU.
       * Object.entries превращает { miner: 1.2, hauler: 0.8 }
       * в массив [["miner", 1.2], ["hauler", 0.8]]
       * — это нужно чтобы применить sort() и slice()
       */
      const sortedRoles = Object.entries(this.roleCPU)
        .sort((a, b) => b[1] - a[1]) // сортируем по убыванию CPU
        .slice(0, 5); // берём только топ-5

      console.log(`--- TOP ROLES ---`);
      for (const [role, used] of sortedRoles) {
        // padEnd(20) — выравнивание по левому краю для красивой таблицы
        console.log(` ${role.padEnd(20)} ${used.toFixed(3)}`);
      }
      console.log(`-------------------------------------------------`);
    }
  },
};
