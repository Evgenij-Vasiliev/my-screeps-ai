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
    const start = Game.cpu.getUsed();
    callback();
    const used = Game.cpu.getUsed() - start;
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

    if (Memory.cpuStats.count >= 100) {
      Memory.cpuStats.average = Memory.cpuStats.total / Memory.cpuStats.count;
      Memory.cpuStats.total = Memory.cpuStats.average;
      Memory.cpuStats.count = 1;
    } else {
      Memory.cpuStats.average = Memory.cpuStats.total / Memory.cpuStats.count;
    }

    if (Game.time % 10 === 0) {
      const perCreep = creepCount > 0 ? (totalUsed / creepCount).toFixed(3) : 0;
      const bucketStatus = bucket < 500 ? "!! EMERGENCY !!" : bucket;

      console.log(`================ [ TICK: ${Game.time} ] ================`);
      console.log(
        `🧠 CPU: ${totalUsed.toFixed(
          2,
        )} | AVG: ${Memory.cpuStats.average.toFixed(
          2,
        )} | 🪣 BKT: ${bucketStatus}`,
      );
      console.log(
        `👥 POP: ${creepCount} creeps | ⚡ PER: ${perCreep} CPU/creep`,
      );

      const sortedRoles = Object.entries(this.roleCPU)
        .sort((a, b) => b[1] - a[1]) // Исправил сортировку объектов
        .slice(0, 5);

      console.log(`--- TOP ROLES ---`);
      for (const [role, used] of sortedRoles) {
        console.log(` • ${role.padEnd(15)} : ${used.toFixed(2)}`);
      }
      console.log(`-------------------------------------------------`);
    }
  },
};
