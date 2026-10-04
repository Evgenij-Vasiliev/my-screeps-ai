"use strict";
/**
 * ===================================================
 * SCRIPTS/TASK.EXECUTOR.CPU.JS — куда уходит CPU роли worker
 * ===================================================
 * Зачем: поролевой замер (scripts/cpu.roles.measure.js) показал, что роль
 * `worker` стоит 1.196 CPU/тик — 26.9 % тика, больше любой подсистемы. Но ключ
 * `worker` целиком включает и исполнителя задачи, и обращения к task.manager,
 * поэтому по нему нельзя понять, что оптимизировать. Этот скрипт даёт разбивку
 * ВНУТРИ роли.
 *
 * КАК. Экспорт модулей оборачивается счётчиками CPU прямо В КОНСОЛИ шарда:
 * worker.runner.js берёт функцию из объекта модуля в момент вызова
 * (`taskExecutors.executors[currentTaskType](...)` — task/runner.js:91,
 * `taskManager.getNextTask(...)` — task/runner.pick.js:177 и :247), поэтому
 * обёртка видна боту.
 * Приём тот же, что у scripts/task.manager.calls.js, но считает не вызовы, а
 * сумму `Game.cpu.getUsed()` до и после. Поведение не меняется: обёртка
 * вызывает ровно ту же функцию с теми же аргументами.
 *
 * ПОЧЕМУ НЕ ПРАВКОЙ КОДА. Поролевой профиль крипов включается флагом
 * Memory.cpuMonitorVerbose (cpuMonitor.js:194) и даёт только ключ роли; ключей
 * по исполнителям в бою нет, а добавлять их — правка worker.runner.js, то есть
 * защищённой зоны (AGENTS.md:8-10). Обёртка даёт ту же разбивку без правки.
 *
 * ЦЕНА ЗАМЕРА (важно для чтения цифр): каждая обёртка делает два
 * `Game.cpu.getUsed()` — по docs/PROFILING-ON-DEMAND.md это ~0.0001-0.0002 CPU
 * на вызов, и он попадает в измеренную дельту. Для исполнителя (вызовов за тик
 * единицы) это доли процента, для addTask/hasDuplicate (21 вызов за тик из
 * генераторов) — заметнее, поэтому их цифры читать как «с обёрткой».
 *
 * ═══ ЗАПРЕЩЕНО: ОБОРАЧИВАТЬ МЕТОДЫ ИГРОВЫХ ОБЪЕКТОВ (ИНЦИДЕНТ 03.10.2026) ═══
 * Обёртки ставятся ТОЛЬКО на экспорт пользовательских модулей. Попытка снять
 * коды возврата с `Creep.prototype.withdraw` (обёртка в консоли + сохранение
 * оригинала в global) обошлась дорого:
 *   - сохранённый оригинал `global.__wdOrig` пропал до команды восстановления
 *     (почему — НЕ ИЗВЕСТНО: в двух прогонах ключи `global`, поставленные из
 *     консоли, исчезали за 35 с и за ~7 мин, тогда как `global.__cpuAcc` и
 *     `global.__rec` жили всё время; проверенного объяснения нет);
 *   - восстановление подставило в прототип `undefined` — КАЖДЫЙ вызов
 *     `creep.withdraw` стал бросать TypeError, роли worker/linkWorker/labWorker
 *     встали, `Memory.cpuStats.average` вырос до 26.29 при лимите 20;
 *   - вернуть нативный метод нельзя ничем, кроме перезагрузки кода: движок
 *     создаёт прототипы ОДИН раз на инстанс рантайма
 *     (engine src/game/creeps.js: `if(globals.Creep) return;`), а
 *     `PowerCreep.prototype.withdraw` не запасной путь — он делегирует в
 *     `globals.Creep.prototype.withdraw` (engine src/game/power-creeps.js).
 * Вывод: методы движка не трогать НИКОГДА; то, что нужно измерить внутри
 * исполнителя, измеряется обёрткой модуля (как здесь) либо флагами
 * cpuMonitor. Если измерение требует правки прототипа — измерение отменяется.
 *
 * Read-only по отношению к боевой логике: пишет Memory.keepTemp, временное поле
 * Memory.__bench_ex и опционально Memory.cpuMonitorVerbose; всё снимается в
 * finally и по SIGINT, обёртки снимаются с проверкой (сколько осталось).
 *
 * Запуск:
 *   node scripts/task.executor.cpu.js [shard3] [секунды] [пауза мс] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const DURATION_S = +(process.argv[3] || 360);
const PAUSE_MS = +(process.argv[4] || 60000);
const OUT = process.argv[5] || "/tmp/task-executor-cpu.json";
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Обёртка исполнителя. `l` — метка в накопителе: "exec.<тип>" или "tm.<функция>".
 * Оригинал сохраняется в global.__execOrig / global.__tmOrig, чтобы снять
 * обёртку обратной заменой, а не «надеждой, что перезагрузка кода поможет».
 *
 * Четвёртый параметр (куда писать оригиналы) назван ЯВНО: в стрелочной функции
 * `arguments` не свой — обращение к нему дало бы аргументы внешней IIFE, то есть
 * undefined (на этом скрипт уже падал 03.10.2026: «Cannot set properties of
 * undefined»).
 *
 * ИДЕМПОТЕНТНОСТЬ (цена инцидента 03.10.2026): консоль шарда иногда молча
 * теряет команду, и `exec()` повторяет её. Повтор НЕ должен оборачивать уже
 * обёрнутое: иначе в global.__execOrig уезжает обёртка вместо оригинала
 * (снятие вернёт обёртку — «осталось 11»), а вызов идёт через две обёртки.
 * Поэтому: карта оригиналов создаётся только если её ещё нет, а ключ с уже
 * стоящей обёрткой (`f.__cw`) пропускается.
 */
const WRAP = `const W=(o,k,l,O)=>{if(o[k].__cw)return;O[k]=o[k];` +
  `const f0=o[k];` +
  `const f=function(){const t=Game.cpu.getUsed();const r=f0.apply(this,arguments);` +
  `const a=global.__cpuAcc;a.cpu[l]=(a.cpu[l]||0)+(Game.cpu.getUsed()-t);` +
  `a.calls[l]=(a.calls[l]||0)+1;return r;};f.__cw=1;o[k]=f;};`;

const ACC_GUARD = `global.__cpuAcc=global.__cpuAcc||{cpu:{},calls:{}};`;

/** Обёртка одного экспорта модуля: "модуль.функция" → накопитель. */
const INSTALL_WITHDRAW =
  `(()=>{const M=require("energySource");global.__cpuAcc=global.__cpuAcc||{cpu:{},calls:{}};` +
  `global.__wdOrig=global.__wdOrig||{};` +
  `const f0=M.withdrawFromStorage;global.__wdOrig.withdrawFromStorage=f0;` +
  `const f=function(creep,ignoreReserve){const t=Game.cpu.getUsed();` +
  `const r=f0.apply(this,arguments);const a=global.__cpuAcc;` +
  `a.cpu["es.withdraw"]=(a.cpu["es.withdraw"]||0)+(Game.cpu.getUsed()-t);` +
  `a.calls["es.withdraw"]=(a.calls["es.withdraw"]||0)+1;return r;};` +
  `f.__cw=1;M.withdrawFromStorage=f;return "on"})()`;

const INSTALL_EXEC =
  `(()=>{const E=require("task.executors").executors;${ACC_GUARD}` +
  `global.__execOrig=global.__execOrig||{};` +
  WRAP +
  `for(const k in E)W(E,k,"exec."+k,global.__execOrig);` +
  `return "on:"+Object.keys(global.__execOrig).length})()`;

const TM_LIST = [
  "getNextTask",
  "getTaskById",
  "reserveTask",
  "releaseTask",
  "completeTask",
  "removeTask",
  "addTask",
  "hasDuplicate",
  "compactAll",
  "freeTasks",
  "initRoomTasks",
];

const INSTALL_TM =
  `(()=>{const T=require("task.manager");${ACC_GUARD}` +
  `global.__tmOrig=global.__tmOrig||{};` +
  WRAP +
  `for(const k of ${JSON.stringify(TM_LIST)})if(typeof T[k]==="function")W(T,k,"tm."+k,global.__tmOrig);` +
  `return "on:"+Object.keys(global.__tmOrig).length})()`;

const PROBE =
  `(()=>{const a=global.__cpuAcc||{cpu:{},calls:{}};` +
  `return JSON.stringify({t:Game.time,cpu:a.cpu,calls:a.calls,` +
  `n:Object.keys(a.calls).length,cr:Object.keys(Game.creeps).length,` +
  `avg:(Memory.cpuStats||{}).average})})()`;

/**
 * Снятие обёрток. Порядок здесь — часть защиты:
 *   1) накопитель восстанавливается ПЕРВЫМ: пока хоть одна обёртка стоит, её
 *      вызов обращается к global.__cpuAcc, и без него исполнитель бросает
 *      TypeError (это и случилось 03.10.2026: обёртки остались, накопитель был
 *      удалён — воркеры перестали исполнять задачи);
 *   2) накопитель удаляется ТОЛЬКО если обёрток не осталось;
 *   3) отсутствие карты оригиналов — не повод удалять накопитель: обёртку,
 *      для которой потерян оригинал, снять нельзя, и она должна продолжать
 *      работать, а не падать.
 */
const UNINSTALL =
  `(()=>{const E=require("task.executors").executors,T=require("task.manager"),W=require("energySource");${ACC_GUARD}` +
  `for(const k in global.__execOrig||{})E[k]=global.__execOrig[k];` +
  `for(const k in global.__tmOrig||{})T[k]=global.__tmOrig[k];` +
  `for(const k in global.__wdOrig||{})W[k]=global.__wdOrig[k];` +
  `delete global.__execOrig;delete global.__tmOrig;delete global.__wdOrig;` +
  `const left=Object.keys(E).filter(k=>E[k].__cw).length+` +
  `Object.keys(T).filter(k=>T[k]&&T[k].__cw).length+` +
  `Object.keys(W).filter(k=>W[k]&&W[k].__cw).length;` +
  `const a=global.__cpuAcc;if(left===0)delete global.__cpuAcc;` +
  `return JSON.stringify({left:left,restored:left===0,` +
  `accKept:left>0,calls:a?a.calls:null})})()`;

/** Отправляет команду; при key — читает ответ из Memory.__bench_<key>. */
async function exec(command, { key = null, tries = 3 } = {}) {
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`команда ${command.length} > ${CONSOLE_LIMIT} символов`);
  }
  if (!key) {
    await api.console(command, SHARD);
    await sleep(1200);
    return null;
  }
  const field = `__bench_${key}`;
  const wrapped =
    `try { Memory.${field} = String(${command}); } ` +
    `catch (e) { Memory.${field} = "ERR: " + e.message; }`;
  if (wrapped.length > CONSOLE_LIMIT) {
    throw new Error(`обёрнутая команда ${wrapped.length} > ${CONSOLE_LIMIT}`);
  }
  let value;
  for (let attempt = 1; attempt <= tries; attempt++) {
    await api.console(wrapped, SHARD);
    await sleep(1500);
    const res = await api.memory.get(field, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(1500);
  }
  await api.console(`delete Memory.${field}`, SHARD);
  await sleep(500);
  if (value === undefined || value === null) throw new Error(`пустой ответ ${field}`);
  return String(value);
}

let installed = false;
let verboseWas = null;
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (installed) {
    try {
      const off = JSON.parse(await exec(UNINSTALL, { key: "exoff" }));
      installed = false;
      console.log(
        `Обёртки сняты: осталось ${off.left} (снято верно: ${off.restored})`,
      );
      if (!off.restored) {
        console.log(
          "  ВНИМАНИЕ: часть обёрток снять не удалось (потеряна карта оригиналов\n" +
            "  из-за повторной посылки команды). Накопитель global.__cpuAcc оставлен\n" +
            "  на месте намеренно — без него обёрнутый исполнитель бросил бы\n" +
            "  TypeError. Такой остаток безвреден: он лишь добавляет два\n" +
            "  Game.cpu.getUsed() на вызов исполнителя (~0.002 CPU/тик) и исчезает\n" +
            "  при первой же загрузке нового кода (global сбрасывается).",
        );
      }
    } catch (e) {
      console.log(`  СНЯТЬ ОБЁРТКИ НЕ УДАЛОСЬ: ${e.message}`);
    }
  }
  if (verboseWas !== undefined) {
    const cmd =
      verboseWas === undefined || verboseWas === null
        ? "delete Memory.cpuMonitorVerbose"
        : `Memory.cpuMonitorVerbose = ${JSON.stringify(verboseWas)}`;
    try {
      await api.console(cmd, SHARD);
    } catch (e) {
      console.log(`  вернуть cpuMonitorVerbose не удалось: ${e.message}`);
    }
  }
  await api.console("delete Memory.keepTemp", SHARD);
  await sleep(800);
  console.log("Флаги сняты.");
}

(async () => {
  console.log(
    `Шард ${SHARD}: разбивка CPU по исполнителям, окно ${DURATION_S} с, ` +
      `проба раз в ${PAUSE_MS} мс → ${OUT}`,
  );
  console.log(`Токен: ${resolveTokenSource().source}\n`);

  process.on("SIGINT", async () => {
    console.log("\nПрерывание — снимаю обёртки...");
    await cleanup();
    process.exit(130);
  });

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1200);

  const vr = await api.memory.get("cpuMonitorVerbose", SHARD);
  verboseWas = vr && vr.data;
  await api.console("Memory.cpuMonitorVerbose = true", SHARD);
  await sleep(600);

  const onExec = await exec(INSTALL_EXEC, { key: "exon" });
  if (onExec !== "on:11") throw new Error(`обёртки исполнителей не встали: ${onExec}`);
  const onTm = await exec(INSTALL_TM, { key: "tmon" });
  const onWd = await exec(INSTALL_WITHDRAW, { key: "wdon" });
  console.log(`Обёртки поставлены: исполнителей ${onExec.slice(3)}, функций task.manager ${onTm.slice(3)}, energySource.withdraw ${onWd}\n`);
  installed = true;

  const rows = [];
  const first = JSON.parse(await exec(PROBE, { key: "ex" }));
  rows.push(first);
  console.log(`старт: t=${first.t}, крипы ${first.cr}, avg ${first.avg}`);

  const started = Date.now();
  while ((Date.now() - started) / 1000 < DURATION_S) {
    await sleep(PAUSE_MS);
    const p = JSON.parse(await exec(PROBE, { key: "ex" }));
    rows.push(p);
    const ticks = p.t - first.t;
    console.log(`  t=${String(p.t).padEnd(11)} +${String(ticks).padStart(3)} тиков`);
  }

  const last = rows[rows.length - 1];
  const ticks = Math.max(1, last.t - first.t);
  await cleanup();

  const labels = new Set([...Object.keys(first.cpu), ...Object.keys(last.cpu)]);
  const table = [];
  for (const label of labels) {
    const dc = (last.cpu[label] || 0) - (first.cpu[label] || 0);
    const dn = (last.calls[label] || 0) - (first.calls[label] || 0);
    table.push({
      label,
      cpuPerTick: dc / ticks,
      callsPerTick: dn / ticks,
      cpuPerCall: dn > 0 ? dc / dn : 0,
    });
  }
  table.sort((a, b) => b.cpuPerTick - a.cpuPerTick);

  const sum = table.reduce((s, r) => s + r.cpuPerTick, 0);
  console.log(`\n=== Разбивка внутри роли worker (окно ${ticks} тиков)`);
  console.log("  CPU/тик    вызовов/тик   CPU/вызов   ключ");
  for (const r of table) {
    console.log(
      `  ${r.cpuPerTick.toFixed(4).padStart(8)}  ${r.callsPerTick.toFixed(2).padStart(11)}  ` +
        `${r.cpuPerCall.toFixed(6).padStart(10)}   ${r.label}`,
    );
  }
  console.log(`  ${sum.toFixed(4).padStart(8)}  — измерено обёртками (сумма)`);
  console.log(
    `\nСправка: роль worker целиком была 1.1959 CPU/тик (scripts/cpu.roles.measure.js); ` +
      `avg тика ${last.avg === undefined ? "?" : last.avg.toFixed(2)}`,
  );

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { shard: SHARD, generatedAt: new Date().toISOString(), ticks, rows, table },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nСырые пробы: ${OUT}`);
})().catch(async e => {
  console.error("ОШИБКА:", e.message);
  await cleanup();
  process.exit(1);
});
