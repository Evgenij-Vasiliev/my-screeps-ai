"use strict";
/**
 * ===================================================
 * SCRIPTS/CONSOLE.BUDGET.TEST.JS — влияет ли консоль на измеряемый CPU бота
 * ===================================================
 * Проверяет, попадает ли CPU консольной команды в `Game.cpu.getUsed()`
 * тика бота. Вопрос принципиальный для методики: если попадает, то любой
 * замер через консоль (scripts/baseline.js и родственные) искажает
 * `Memory.cpuStats`, которым проект меряет себя.
 *
 * Как проверяется: внутри ОДНОГО окна отчёта (10 тиков) отправляются 5 тяжёлых
 * консольных команд по ≈3.7 CPU каждая (1000 × Object.values(Game.creeps),
 * цена вызова 0.0037 CPU — docs/cpu-baseline.json). Если CPU консоли считается
 * в тике бота, сумма окна вырастет примерно на 18.5 CPU (≈+1.85 CPU/тик) —
 * это в разы больше фазового шума ±0.4 CPU/тик.
 *
 * Результат прогона 29.09.2026 (shard3): окно с четырьмя тяжёлыми пробами
 * оказалось САМЫМ дешёвым (3.335 CPU/тик) против соседей 4.049 и 3.480 —
 * то есть CPU консоли в тик бота НЕ попадает. Это подтверждает заметку
 * проекта loadShed.js:250-252 («консоль и тик — разные бюджеты CPU»).
 *
 * Read-only: пишет только временные Memory.keepTemp и Memory.__pt, оба
 * снимаются в конце; игровых интентов нет.
 *
 * Запуск:
 *   node scripts/console.budget.test.js [shard3]
 * ===================================================
 */
const SHARD = process.argv[2] || "shard3";
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");
const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = async () => (await api.memory.get("cpuStats", SHARD)).data;
const HEAVY =
  "for(let i=0;i<1000;i++){Object.values(Game.creeps).length};" +
  "Memory.__pt=(Memory.__pt||'')+Game.time+','";
(async () => {
  const rows = [];
  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);
  for (let i = 0; i < 16; i++) {
    if (i >= 3 && i <= 7) {           // 5 тяжёлых проб подряд ≈ +18.5 CPU, если считаются
      await api.console(`try { ${HEAVY}; } catch (e) {}`, SHARD);
      await sleep(2500);
    }
    const d = await read();
    rows.push({ wall: Date.now(), c: d.count, s: d.total, a: d.average });
    console.log(`+${String(Math.round((Date.now()-rows[0].wall)/1000)).padStart(3)}s count=${String(d.count).padStart(3)} total=${d.total.toFixed(3)} avg=${d.average.toFixed(4)}`);
    await sleep(7000);
  }
  const pt = await api.memory.get("__pt", SHARD);
  await api.console("delete Memory.keepTemp; delete Memory.__pt", SHARD);
  console.log("\nтики тяжёлых проб:", pt && pt.data);
  for (let i = 1; i < rows.length; i++) {
    const dc = rows[i].c - rows[i-1].c;
    if (dc <= 0) { console.log(`  count ${rows[i-1].c}->${rows[i].c}: сброс окна`); continue; }
    console.log(`  окно до count=${rows[i].c}: ${(rows[i].s-rows[i-1].s).toFixed(3)} CPU / ${dc} тик = ${((rows[i].s-rows[i-1].s)/dc).toFixed(4)} CPU/тик`);
  }
})().catch(e => console.error("ERR", e.message));
