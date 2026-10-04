"use strict";
/**
 * ===================================================
 * SCRIPTS/WORKER.DIAG.DELTA.JS — дельта бортового счётчика против профайлера
 * ===================================================
 * Вопрос: `Memory.cpuStats.subsystems.worker` (поролевой профайлер) и
 * `global.__workerDiag.cpuExec + cpuTask` (бортовой счётчик worker.runner)
 * описывают ОДНУ И ТУ ЖЕ работу, но расходятся. Кто из них прав?
 *
 * Метод: два снимка `global.__workerDiag` и `Memory.cpuStats` с интервалом,
 * дальше ДЕЛЬТА по тикам и вызовам. Ничего не включает и не пишет — только
 * читает Memory (поле не создаётся: уборка бота тут не нужна вовсе).
 *
 * Запуск: node scripts/worker.diag.delta.js [shard3] [секунд]
 * Пишет: /tmp/worker-diag-delta.json
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const WINDOW_S = +(process.argv[3] || 300);
const OUT = process.argv[4] || "/tmp/worker-diag-delta.json";
const POLL_MS = 30000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Один снимок: профайлер и бортовой счётчик. */
async function snap() {
  await api.console(
    "Memory.__wdiag = JSON.stringify({t:Game.time,d:global.__workerDiag,s:Memory.cpuStats})",
    SHARD,
  );
  await sleep(2500);
  const res = await api.memory.get("__wdiag", SHARD);
  const raw = res && res.data;
  if (!raw) throw new Error("пустой __wdiag");
  await api.console("delete Memory.__wdiag", SHARD);
  return JSON.parse(raw);
}

function roles(o) {
  const s = (o && o.s && o.s.subsystems) || {};
  return {
    worker: s.worker || 0,
    miner: s.miner || 0,
    linkWorker: s.linkWorker || 0,
    labWorker: s.labWorker || 0,
    labManager: s.labManager || 0,
    terminalNetwork: s.terminalNetwork || 0,
    taskManager: s.taskManager || 0,
  };
}

(async () => {
  console.log(`Шард ${SHARD}, окно ${WINDOW_S} с → ${OUT}`);
  const ctx = await snap();
  console.log(
    `Старт: t=${ctx.t} avg=${ctx.s && ctx.s.average} cnt=${ctx.s && ctx.s.count} creeps=${ctx.s && ctx.s.creeps}`,
  );
  console.log(`Роли на старте: ${JSON.stringify(roles(ctx))}`);
  console.log(`__workerDiag на старте: ${JSON.stringify(ctx.d)}`);

  const started = Date.now();
  const points = [{ t: ctx.t, diag: ctx.d, stats: ctx.s, wall: started }];
  while ((Date.now() - started) / 1000 < WINDOW_S) {
    await sleep(POLL_MS);
    try {
      const s = await snap();
      points.push({ t: s.t, diag: s.d, stats: s.s, wall: Date.now() });
      console.log(
        `  t=${s.t} avg=${s.s && s.s.average && s.s.average.toFixed(3)} ` +
          `worker=${roles(s).worker} calls=${s.d && s.d.calls}`,
      );
    } catch (e) {
      console.log(`  проба не удалась: ${e.message}`);
    }
  }

  const a = points[0];
  const b = points[points.length - 1];
  const dTick = b.t - a.t;
  const d = (k) => (b.diag[k] || 0) - (a.diag[k] || 0);
  const dTask = d("cpuTask");
  const dExec = d("cpuExec");
  const dCalls = d("calls");
  const dSel = d("selected");
  const dNo = d("noTask");
  const dScan = d("scans");
  const dTicksObs = d("ticks");

  const avgs = points.map(p => p.stats && p.stats.average).filter(v => typeof v === "number");
  const avgTick = avgs.reduce((x, y) => x + y, 0) / avgs.length;
  const workerRole = points.map(p => roles(p).worker);
  const avgWorkerRole = workerRole.reduce((x, y) => x + y, 0) / workerRole.length;

  const report = {
    shard: SHARD,
    capturedAt: new Date().toISOString(),
    windowSeconds: Math.round((b.wall - a.wall) / 1000),
    firstTick: a.t,
    lastTick: b.t,
    deltaTicks: dTick,
    avgTickCPU: +avgTick.toFixed(4),
    profilerWorkerCPU: +avgWorkerRole.toFixed(4),
    board: {
      ticksObserved: dTicksObs,
      decisions: dCalls,
      noTask: dNo,
      scans: dScan,
      selected: dSel,
      cpuTask: +dTask.toFixed(4),
      cpuExec: +dExec.toFixed(4),
      perTickTask: +(dTask / dTick).toFixed(5),
      perTickExec: +(dExec / dTick).toFixed(5),
      perTickTotal: +((dTask + dExec) / dTick).toFixed(5),
      perCallExec: dCalls ? +(dExec / dCalls).toFixed(5) : null,
      execCallsPerTick: +(dCalls / dTick).toFixed(4),
      noTaskPerTick: +(dNo / dTick).toFixed(4),
      scansPerTick: +(dScan / dTick).toFixed(4),
    },
    points: points.map(p => ({ t: p.t, diag: p.diag, stats: p.stats })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

  console.log(`\n=== ДЕЛЬТА за ${report.windowSeconds} с (${dTick} тиков)`);
  console.log(`avg тика: ${report.avgTickCPU} CPU/тик`);
  console.log(`профайлер, роль worker: ${report.profilerWorkerCPU} CPU/тик`);
  console.log(
    `бортовой: cpuTask ${report.board.perTickTask} + cpuExec ${report.board.perTickExec} ` +
      `= ${report.board.perTickTotal} CPU/тик`,
  );
  console.log(
    `решений ${dCalls}, из них без задачи ${dNo} ` +
      `(${((dNo / dCalls) * 100).toFixed(1)}%), построений индекса ${dScan}`,
  );
  console.log(`исполнитель: ${report.board.perCallExec} CPU/вызов, ${report.board.execCallsPerTick} вызовов/тик`);
  console.log(`Сырые точки: ${OUT}`);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
