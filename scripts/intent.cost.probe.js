"use strict";
/**
 * ===================================================
 * SCRIPTS/INTENT.COST.PROBE.JS — из чего состоят 0.188 CPU на вызов исполнителя
 * ===================================================
 * Бортовой замер worker.runner даёт цену ОДНОГО вызова исполнителя
 * (`global.__workerDiag`: cpuExec/calls). Вопрос: это наш JS (резолвы,
 * чтения store, проверки) или интенты движка (`withdraw`/`transfer`/`move`)?
 *
 * Замер: на одном и том же объекте сравниваются три пути одинаковой длины:
 *   R1 чтение стора — только наш JS;
 *   R2 `withdraw` по цели ВНЕ радиуса — интент НЕ создаётся (ERR_NOT_IN_RANGE);
 *   R3 `withdraw` по цели В РАДИУСЕ  — интент создаётся, дальше движок.
 * Разность R3 - R2 = цена создания интента движком.
 *
 * БЕЗОПАСНОСТЬ: крип выбирается только из тех, у кого рюкзак полон, и только
 * если у цели есть чем поделиться. Вызов `withdraw` при полном рюкзаке движок
 * отбивает по ERR_FULL ДО записи в `runtimeData` (проверяется на месте: R3
 * обязан вернуть ERR_FULL, иначе проба помечается FAILED и её результат не
 * используется). Ничего не двигается, не спавнится и не передаётся; Memory не
 * трогается, кроме временного `Memory.keepTemp`/`__bench_*`, снимаемых в finally.
 *
 * Запуск: node scripts/intent.cost.probe.js [shard3] [итераций]
 * Пишет: /tmp/intent-cost.json
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const N = +(process.argv[3] || 300);
const OUT = process.argv[4] || "/tmp/intent-cost.json";
const CONSOLE_LIMIT = 1000;
const PAUSE_MS = 2500;

const src = resolveTokenSource();
const api = new ScreepsAPI({ token: src.token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let savedKeepTemp;
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  const cmd =
    savedKeepTemp === undefined
      ? "delete Memory.keepTemp"
      : `Memory.keepTemp = ${JSON.stringify(savedKeepTemp)}`;
  try {
    await api.console(cmd, SHARD);
    await api.console("delete Memory.__bench_probe", SHARD);
    await sleep(600);
    console.log(`\nУборка: ${cmd}`);
  } catch (e) {
    console.log(`  уборка не удалась: ${e.message}`);
  }
}

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
  await sleep(500);
  if (value === undefined || value === null) throw new Error(`пустой ответ для ${key}`);
  return String(value);
}

/** Общая голова пробы: выбор крипа, цели и часов. */
const HEAD = (name, extra) =>
  `(()=>{const N=${N};` +
  `const cs=Object.values(Game.creeps).filter(c=>c.memory.role==="${name}");` +
  `if(!cs.length)return "нет крипов роли ${name}";` +
  `const u=()=>Game.cpu.getUsed();` +
  `${extra}`;

const PROBES = {
  // ── R1: только наш JS — чтения стора и цели ──────────────────────────
  r1_store: HEAD(
    "worker",
    `const c=cs[0];let s=0;` +
      `const t0=u();` +
      `for(let i=0;i<N;i++){const st=c.store;s+=st.getFreeCapacity()===0?1:0;}` +
      `const dt=u()-t0;` +
      `return JSON.stringify({probe:"read store",n:N,cpu:+dt.toFixed(4),each:+(dt/N).toFixed(6),sum:s});})()`,
  ),

  // ── R2: withdraw вне радиуса — интента нет ──────────────────────────
  r2_withdraw_far: HEAD(
    "worker",
    `const c=cs[0],r=c.room;` +
      `const st=r.storage||r.terminal;` +
      `if(!st)return "нет storage/terminal";` +
      `if(c.pos.getRangeTo(st)<=1)return "крип уже в радиусе — проба невалидна";` +
      `let rc=0;` +
      `const t0=u();` +
      `for(let i=0;i<N;i++){rc=c.withdraw(st,RESOURCE_ENERGY);}` +
      `const dt=u()-t0;` +
      `return JSON.stringify({probe:"withdraw вне радиуса",n:N,cpu:+dt.toFixed(4),each:+(dt/N).toFixed(6),rc:rc});})()`,
  ),

  // ── R3: интент, отбитый на проверке Store ───────────────────────────
  // Крип с энергией и НЕПОЛНАЯ цель вплотную: движок принимает интент, при
  // обработке упирается в `store.getFreeCapacity() === 0` и возвращает ERR_FULL.
  // Сравнение с R2 (ERR_NOT_IN_RANGE, проверка ID) показывает цену Store.
  r3_transfer_full: HEAD(
    "worker",
    `const c=cs[0];` +
      `if(c.store[RESOURCE_ENERGY]<=0)return "у крипа нет энергии — R3 пропущена";` +
      `const a=c.room.find(FIND_STRUCTURES),id0=c.store.getFreeCapacity();void id0;` +
      `let s=null;for(const x of a){if(c.pos.getRangeTo(x)===1&&x.store&&` +
      `x.store.getFreeCapacity(RESOURCE_ENERGY)>0){s=x;break;}}` +
      `if(!s)return "нет неполной цели вплотную — R3 пропущена";` +
      `const id=s.id;let rc=0;` +
      `const t0=u();` +
      `for(let i=0;i<N;i++){rc=c.transfer(Game.getObjectById(id),RESOURCE_ENERGY);}` +
      `const dt=u()-t0;` +
      `return JSON.stringify({probe:"transfer интент (Store-путь)",n:N,` +
      `cpu:+dt.toFixed(4),each:+(dt/N).toFixed(6),rc:rc,st:s.structureType});})()`,
  ),

  // ── R4: контроль — интент, отбитый ДО проверки ID (глобальный id) ────
  r4_transfer_badid: HEAD(
    "worker",
    `const c=cs[0];` +
      `if(c.store[RESOURCE_ENERGY]<=0)return "у крипа нет энергии — R4 пропущена";` +
      `const bad=Game.getObjectById(Game.creeps[cs[0].name].id);` +
      `if(!bad)return "нет объекта — R4 пропущена";` +
      `let rc=0;` +
      `const t0=u();` +
      `const find=()=>Game.getObjectById(bad.id);` +
      `for(let i=0;i<N;i++){const o=find();rc=c.transfer(o,RESOURCE_ENERGY);}` +
      `const dt=u()-t0;` +
      `return JSON.stringify({probe:"transfer глобальный id (контроль)",n:N,` +
      `cpu:+dt.toFixed(4),each:+(dt/N).toFixed(6),rc:rc});})()`,
  ),

  // ── R5: валидный интент ДВИЖЕНИЯ — цена шага в тике ─────────────────
  // Крип ходит по квадрату 2x2 (замкнутый цикл), поэтому после пробы остаётся
  // рядом со своим постом. Проба валидна, только если ВСЕ ходы вернули OK:
  // иначе часть вызовов отбита (усталость/стена) и цифра занижена.
  r5_move: HEAD(
    "worker",
    `const c=cs.filter(x=>x.store[RESOURCE_ENERGY]===0&&x.fatigue===0)[0]||cs[0];` +
      `if(c.fatigue!==0)return "у крипа усталость — R5 невалидна";` +
      `const ok=[];` +
      `ok.push(c.move(TOP),c.move(RIGHT),c.move(BOTTOM),c.move(LEFT));` +
      `if(ok.some(x=>x!==0))return "ход отбит: "+JSON.stringify(ok)+" — R5 невалидна";` +
      `let rc=0;` +
      `const t0=u();` +
      `for(let i=0;i<N;i++){rc=c.move(i%2?RIGHT:LEFT);}` +
      `const dt=u()-t0;` +
      `return JSON.stringify({probe:"move интент",n:N,cpu:+dt.toFixed(4),` +
      `each:+(dt/N).toFixed(6),rc:rc,fatigue:c.fatigue,energy:c.store[RESOURCE_ENERGY]});})()`,
  ),

  // ── Справочно: цена самих примитивов на этом же шарде ───────────────
  primitives:
    `(()=>{const u=()=>Game.cpu.getUsed();const N=500;` +
    `const c=Object.values(Game.creeps)[0];const id=c.id;` +
    `let a=u();for(let i=0;i<N;i++){Game.getObjectById(id);}const byId=u()-a;` +
    `a=u();for(let i=0;i<N;i++){Game.creeps[c.name];}const byName=u()-a;` +
    `a=u();for(let i=0;i<N;i++){c.pos.getRangeTo(c.room.storage||c);}const range=u()-a;` +
    `a=u();for(let i=0;i<N;i++){Game.cpu.getUsed();}const used=u()-a;` +
    `return JSON.stringify({n:N,getObjectById:+(byId/N).toFixed(6),` +
    `creepsByName:+(byName/N).toFixed(6),getRangeTo:+(range/N).toFixed(6),` +
    `getUsed:+(used/N).toFixed(6)});})()`,
};

(async () => {
  console.log(`Шард ${SHARD}, итераций ${N}, токен: ${src.source} → ${OUT}`);

  const raw = await api.memory.get("keepTemp", SHARD);
  savedKeepTemp = raw && raw.data;
  await api.console("Memory.keepTemp = true", SHARD); // уборка __* не должна съесть поля замера
  await sleep(1200);
  process.on("SIGINT", async () => {
    console.log("\nПрерывание — уборка...");
    await cleanup();
    process.exit(130);
  });

  const out = { shard: SHARD, capturedAt: new Date().toISOString(), iterations: N, keepTempBefore: savedKeepTemp === undefined ? null : savedKeepTemp };
  for (const [name, expr] of Object.entries(PROBES)) {
    try {
      const raw2 = await evalInGame(name, expr);
      let parsed = raw2;
      try {
        parsed = JSON.parse(raw2);
      } catch (e) {
        void e;
      }
      out[name] = parsed;
      console.log(`── ${name}: ${raw2}`);
    } catch (e) {
      out[name] = "ERR: " + e.message;
      console.log(`── ${name}: ОШИБКА ${e.message}`);
    }
  }

  const r2 = out.r2_withdraw_far;
  const r3 = out.r3_transfer_full;
  const r4 = out.r4_transfer_badid;
  if (r2 && r3 && typeof r2 === "object" && typeof r3 === "object") {
    out.intentCostStore = +(r3.each - r2.each).toFixed(6);
    console.log(
      `\nЦена Store-проверки в интенте = R3 - R2 = ${out.intentCostStore} CPU ` +
        `(R3 ${r3.each}, R2 ${r2.each})`,
    );
  }
  if (r3 && r4 && typeof r3 === "object" && typeof r4 === "object") {
    out.intentCostFull = +(r3.each - r4.each).toFixed(6);
    console.log(
      `Цена пути «валидный интент от начала до Store» = R3 - R4 = ${out.intentCostFull} CPU ` +
        `(R4 ${r4.each})`,
    );
  }

  await cleanup();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Сырой результат: ${OUT}`);
})().catch(async e => {
  console.error("ОШИБКА:", e.message);
  await cleanup();
  process.exit(1);
});
