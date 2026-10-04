"use strict";
/**
 * ===================================================
 * SCRIPTS/WORKER.DIAG.READ.JS — лёгкий read-only снимок состояния
 * ===================================================
 * Ничего не включает и не выключает: читает то, что бот уже накопил сам.
 *   Memory.cpuStats                 — CPU/тик, subsystems, creeps
 *   global.__workerDiag             — бортовой замер worker.runner.js
 *   Memory.creeps                   — перепись ролей
 *   Memory.rooms[*].tasks           — размеры очередей задач
 *
 * Запуск: node scripts/worker.diag.read.js [shard3]
 * Пишет: /tmp/worker-diag.json
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const OUT = process.argv[3] || "/tmp/worker-diag.json";
const CONSOLE_LIMIT = 1000;
const PAUSE_MS = 2500;

const src = resolveTokenSource();
const api = new ScreepsAPI({ token: src.token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Выражение исполняется в консоли, результат читается из Memory.__bench_*. */
async function evalInGame(field, expression) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`выражение ${field}: ${command.length} > ${CONSOLE_LIMIT} символов`);
  }
  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(PAUSE_MS);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(PAUSE_MS);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);
  if (value === undefined || value === null) throw new Error(`пустой ответ для ${key}`);
  return String(value);
}

const EXPR = {
  // Контекст шарда.
  ctx:
    `Game.shard.name+"|"+Game.time+"|"+Game.cpu.limit+"|"+Game.cpu.tickLimit+"|"+` +
    `Game.cpu.bucket+"|"+Object.keys(Game.rooms).length+"|"+Object.keys(Game.creeps).length`,
  // Перепись ролей по Memory.creeps: роль → сколько.
  roles:
    `(()=>{const m=Memory.creeps||{},o={};` +
    `for(const n in m){const r=m[n].role||"?";o[r]=(o[r]||0)+1;}` +
    `return Object.keys(o).sort().map(k=>k+"="+o[k]).join(",");})()`,
  // Сколько воркеров имеют активную задачу и какой taskIndex.
  workermem:
    `(()=>{const m=Memory.creeps||{},o={};let w=0,wt=0;` +
    `for(const n in m){if(m[n].role!=="worker")continue;w++;` +
    `if(m[n].taskId)wt++;const ti=m[n].taskIndex;o["ti"+ti]=(o["ti"+ti]||0)+1;}` +
    `return "workers="+w+" withTask="+wt+" "+Object.keys(o).sort().map(k=>k+"="+o[k]).join(" ");})()`,
  // Бортовой замер worker.runner: снимок в heap.
  diag:
    `global.__workerDiag?JSON.stringify(global.__workerDiag):"нет __workerDiag"`,
  // То же, но с производными средними.
  diagavg:
    `(()=>{const d=global.__workerDiag;if(!d)return "нет __workerDiag";` +
    `const n=d.cpuSample||1;` +
    `return "ticks="+d.ticks+" calls="+d.calls+" noTask="+d.noTask+` +
    `" scans="+d.scans+" dry="+d.dryExits+" sel="+d.selected+" sw="+d.switched+` +
    `" done="+d.done+" skip="+d.skip+" samples="+(d.cpuSample||0)+` +
    `" cpuTask="+(d.cpuTask||0).toFixed(3)+" cpuExec="+(d.cpuExec||0).toFixed(3)+` +
    `" avgTask="+((d.cpuTask||0)/n).toFixed(5)+" avgExec="+((d.cpuExec||0)/n).toFixed(5);})()`,
  // CPU-статистика: среднее, окно, bucket.
  cpu:
    `(()=>{const s=Memory.cpuStats||{};` +
    `return "avg="+(s.average===undefined?"?":s.average.toFixed(3))+" cnt="+s.count+` +
    `" bkt="+s.bucket+" creeps="+s.creeps+" roles="+JSON.stringify(s.subsystems||{});})()`,
  // Очереди задач по комнатам: сколько задач и байт.
  queues:
    `(()=>{const r=Memory.rooms||{},o=[];let T=0;` +
    `for(const n in r){const q=(r[n]||{}).tasks||{};let c=0;` +
    `for(const k in q){const a=q[k];if(Array.isArray(a))c+=a.length;}` +
    `if(c>0)o.push(n+":"+c);T+=c;}` +
    `return "tasks="+T+" "+o.join(" ");})()`,
  // Размер Memory и секций.
  mem:
    `(()=>{const r=RawMemory.get();const t=Object.keys(Memory).map(k=>k+"="+JSON.stringify(Memory[k]).length).sort((a,b)=>parseInt(b.split("=")[1])-parseInt(a.split("=")[1])).slice(0,8);` +
    `return "raw="+r.length+" "+t.join(" ");})()`,
  // TIME: сколько тиков длится тик (по времени между тиками) + аптайм.
  globals:
    `Object.keys(global).filter(k=>k.indexOf("__")===0).join(",")`,
};

(async () => {
  console.log(`Шард ${SHARD}, токен: ${src.source} → ${OUT}\n`);
  const out = { shard: SHARD, capturedAt: new Date().toISOString() };

  for (const [name, expr] of Object.entries(EXPR)) {
    try {
      const value = await evalInGame(name, expr);
      out[name] = value;
      console.log(`── ${name}: ${value}`);
    } catch (e) {
      out[name] = "ERR: " + e.message;
      console.log(`── ${name}: ОШИБКА ${e.message}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nСырой снимок: ${OUT}`);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
