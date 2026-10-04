// ===================================================
// TASK/runner.diag.js — бортовой замер роли worker
// ===================================================
// Часть разбиения worker.runner.js (525 строк, 04.10.2026). Наружу блок
// по-прежнему отдаёт фасад worker.runner.js: те же ТРИ экспорта (run, diag,
// TASK_CHAIN), что и раньше, — их зовут room/creeps.js:15 и тесты
// (task.index2.test.js:52, worker.proximity.test.js:66).
//
// Накопитель `global.__workerDiag` и решение «считать ли CPU в этом тике». Полное
// описание полей — в шапке фасада worker.runner.js.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================


/* ─────────────────────────── БОРТОВОЙ ЗАМЕР ─────────────────────────────── */

const SAMPLE_EVERY = 50;

/** Накопитель в heap: сбрасывается вместе с VM, Memory не засоряет. */
function diag() {
  let d = global.__workerDiag;
  if (!d) {
    d = global.__workerDiag = {
      since: Game.time,
      lastTick: -1,
      ticks: 0,
      calls: 0,
      noTask: 0,
      scans: 0,
      dryExits: 0,
      selected: 0,
      switched: 0,
      done: 0,
      skip: 0,
      cpuTask: 0,
      cpuExec: 0,
      cpuSample: 0,
    };
  }

  // Тиков наблюдения, а не обращений: воркеров в комнате несколько, а тик один.
  if (d.lastTick !== Game.time) {
    d.lastTick = Game.time;
    d.ticks++;
  }

  return d;
}

/** Считать ли CPU в этом тике. Ответ одинаков для всех воркеров тика. */
function sampling() {
  return Game.time % SAMPLE_EVERY === 0;
}

module.exports = {
  diag,
  sampling,
};
