"use strict";
/**
 * ===================================================
 * SCRIPTS/TASK.MANAGER.BENCH.JS — цена вызовов task.manager на живом шарде
 * ===================================================
 * Отвечает на вопрос «сколько стоит ОДИН вызов» для функций, которые бот
 * дёргает сотни раз за тик: `getNextTask`, `getTaskById`, `hasDuplicate`,
 * а через них — `getQueueEntry`/`reindex`/`queueRef`.
 *
 * ПОЧЕМУ ЭТО READ-ONLY.
 * Замер вызывает ТОЛЬКО читающие функции менеджера: они смотрят в `Memory`
 * (`Memory.rooms[r].tasks[t]`) и строят heap-индексы в `global.__taskHeap`.
 * Ни одна из них не пишет в `Memory` и не даёт игровых интентов.
 *
 * Приём с heap: перед замером ссылка `global.__taskHeap` запоминается, на
 * время замера подменяется свежим (чтобы измерять ПОСТРОЕНИЕ индекса, а не
 * попадание в кэш), в finally возвращается обратно — состояние бота не
 * меняется. `reserveTask`/`completeTask` НЕ замеряются: они пишут в `Memory`
 * (`reservedBy`, надгробие), а это уже правка, а не замер.
 *
 * Запуск:
 *   node scripts/task.manager.bench.js [shard3] [повторы] [файл]
 * ===================================================
 */

const fs = require("fs");
const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const N = +(process.argv[3] || 300);
const OUT = process.argv[4] || "/tmp/task-manager-bench.json";
const PAUSE_MS = 2500;
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Шапка замера: сохранение heap, часы, безопасный разбор. */
const HEAD =
  `(()=>{const tm=require("task.manager"),sv=global.__taskHeap,` +
  `u=()=>Game.cpu.getUsed(),o={};try{`;
const TAIL =
  `}catch(e){o.err=String(e&&e.message||e)}global.__taskHeap=sv;` +
  `return JSON.stringify(o)})()`;

/** Выполняет замер в консоли шарда и возвращает разобранный JSON. */
async function run(field, body) {
  const key = "__bench_" + field;
  const expression = HEAD + body + TAIL;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(
      `выражение ${field}: команда ${command.length} > ${CONSOLE_LIMIT} символов`,
    );
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
  if (value === undefined || value === null) throw new Error(`пустой ответ ${key}`);
  const text = String(value);
  if (text.startsWith("ERR:")) throw new Error(text);
  return JSON.parse(text);
}

(async () => {
  console.log(`Токен: ${resolveTokenSource().source}`);
  console.log(`Шард ${SHARD}: повторов на замер ${N}, результат → ${OUT}\n`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  const rows = [];
  const push = (name, data) => {
    rows.push(Object.assign({ name }, data));
    if (data.err) {
      console.log(`  ${name}: ОШИБКА — ${data.err}`);
    } else {
      console.log(`  ${name.padEnd(52)} ${String(data.v).padStart(10)} CPU`);
    }
  };

  try {
    // ── 0. Данные шарда: очереди, крип для rangeFn, живая задача ───────
    const info = await run(
      "tmb0",
      `const q={};for(const r in Memory.rooms){const t=Memory.rooms[r].tasks||{};` +
        `const m={};for(const k in t)if(t[k].length)m[k]=t[k].length;q[r]=m;}` +
        `let cn=null,tid=null,tt=null,rr=null;` +
        `for(const n in Game.creeps){const c=Game.creeps[n],m=c.memory;` +
        `if(m.taskId){cn=n;tid=m.taskId;tt=tm.TASK_CHAIN[m.taskIndex];rr=c.room.name;break;}}` +
        `let nf=null;for(const rn in Game.rooms){const r=Game.rooms[rn];` +
        `if(r.controller&&r.controller.my&&r.energyAvailable!==r.energyCapacityAvailable){nf=rn;break;}}` +
        `o.q=q;o.cn=cn;o.tid=tid;o.tt=tt;o.rr=rr;o.t=Game.time;o.nf=nf;` +
        `o.cr=Object.keys(Game.creeps).length;` +
        `o.hq=Object.keys((global.__taskHeap||{}).queues||{}).length;`,
    );
    console.log(
      `\nGame.time=${info.t}, крипов ${info.cr}, очередей в heap ${info.hq}`,
    );
    console.log(`первая неполная комната: ${info.nf || "(нет)"}`);
    console.log("непустые очереди (комната → тип:длина):");
    for (const r in info.q) {
      console.log(
        `  ${r}: ` +
          Object.entries(info.q[r])
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}:${v}`)
            .join(" "),
      );
    }

    // Худшая очередь — верхняя граница для построения индекса.
    let R = null;
    let T = null;
    let best = 0;
    for (const r in info.q) {
      for (const t in info.q[r]) {
        if (info.q[r][t] > best) {
          best = info.q[r][t];
          R = r;
          T = t;
        }
      }
    }
    if (!R) throw new Error("нет непустых очередей — замер невозможен");
    const RR = info.rr || R; // комната, в которой реально работает выбранный крип
    console.log(`\nхудшая очередь для индекса: ${R}/${T} = ${best} задач`);
    console.log(`крип: ${info.cn} (${RR}), задача ${info.tid} типа ${info.tt}\n`);

    // Функция расстояния — та же логика, что rangeToNextStop (worker.runner.js:53-62).
    const RANGE =
      `const f=q=>{const id=c.store.getFreeCapacity()===0?(q.targetId||q.sourceId)` +
      `:(q.sourceId||q.targetId);const g=Game.getObjectById(id);` +
      `return g&&c.pos?c.pos.getRangeTo(g):1e9;};`;

    // ── 1. Построение индекса очереди: первый вызов за тик ─────────────
    push(
      `1. getNextTask: построение индекса (${R}/${T}, ${best} задач)`,
      await run(
        "tmb1",
        `const R="${R}",T="${T}",N=${N};global.__taskHeap=undefined;tm.getNextTask(R,T);` +
          `const k=R+"\\u0001"+T;let t=u();` +
          `for(let i=0;i<N;i++){delete global.__taskHeap.queues[k];tm.getNextTask(R,T);}` +
          `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
      ),
    );

    // ── 2. Попадание в кэш: индекс уже построен ────────────────────────
    push(
      "2. getNextTask: попадание в кэш, без rangeFn",
      await run(
        "tmb2",
        `const R="${R}",T="${T}",N=${N};global.__taskHeap=undefined;tm.getNextTask(R,T);` +
          `let t=u();for(let i=0;i<N;i++)tm.getNextTask(R,T);` +
          `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
      ),
    );

    // ── 3. С rangeFn (реальный крип, реальные задачи) ──────────────────
    if (info.cn) {
      push(
        `3. getNextTask: с rangeFn (крип ${info.cn}, ${RR})`,
        await run(
          "tmb3",
          `const R="${RR}",T="${T}",N=${N},c=Game.creeps["${info.cn}"];${RANGE}` +
            `global.__taskHeap=undefined;tm.getNextTask(R,T,f);` +
            `let t=u();for(let i=0;i<N;i++)tm.getNextTask(R,T,f);` +
            `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
        ),
      );
    }

    // ── 4. getTaskById: попадание в Map ────────────────────────────────
    if (info.tid && info.tt) {
      push(
        `4. getTaskById: попадание (${RR}/${info.tt})`,
        await run(
          "tmb4",
          `const R="${RR}",T="${info.tt}",I="${info.tid}",N=${N};` +
            `global.__taskHeap=undefined;tm.getTaskById(R,T,I);` +
            `let t=u();for(let i=0;i<N;i++)tm.getTaskById(R,T,I);` +
            `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
        ),
      );
    }

    // ── 5. hasDuplicate: попадание (Set уже построен) ──────────────────
    const FIELDS = `const F=["targetId"];`;
    push(
      "5. hasDuplicate: попадание в Set",
      await run(
        "tmb5",
        `const R="${R}",T="${T}",N=${N};${FIELDS}` +
          `const C={type:"repair",targetId:"__none"};global.__taskHeap=undefined;` +
          `tm.hasDuplicate(R,T,C,F);let t=u();` +
          `for(let i=0;i<N;i++)tm.hasDuplicate(R,T,C,F);` +
          `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
      ),
    );

    // ── 6. hasDuplicate: построение Set по очереди ─────────────────────
    push(
      `6. hasDuplicate: построение Set (${R}/${T}, ${best} задач)`,
      await run(
        "tmb6",
        `const R="${R}",T="${T}",N=${N};${FIELDS}` +
          `const C={type:"repair",targetId:"__none"};let t=u();` +
          `for(let i=0;i<N;i++){global.__taskHeap=undefined;tm.hasDuplicate(R,T,C,F);}` +
          `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
      ),
    );

    // ── 7. Полный перебор типов — то, что платит воркер без задачи ─────
    if (info.cn) {
      push(
        `7. nearestTypeIndex: 11 типов x getNextTask(rangeFn)`,
        await run(
          "tmb7",
          `const R="${RR}",N=${N},c=Game.creeps["${info.cn}"],CH=tm.TASK_CHAIN;${RANGE}` +
            `global.__taskHeap=undefined;` +
            `for(let i=0;i<CH.length;i++)tm.getNextTask(R,CH[i],f);` +
            `let t=u();for(let i=0;i<N;i++){for(let j=0;j<CH.length;j++)tm.getNextTask(R,CH[j],f);}` +
            `o.v=+((u()-t)/N).toFixed(5);o.n=N;`,
        ),
      );
    }

    // ── 8-10. Примитивы, из которых состоит горячий путь ───────────────
    const M = N * 20;
    push(
      `8. ключ room+"\\u0001"+type (на итерацию)`,
      await run(
        "tmb8",
        `const R="${R}",T="${T}",N=${M};let k="";let t=u();` +
          `for(let i=0;i<N;i++)k=R+"\\u0001"+T;` +
          `o.v=+((u()-t)/N).toFixed(6);o.len=k.length;o.n=N;`,
      ),
    );
    push(
      "9. цепочка Memory.rooms[r].tasks[t] (на итерацию)",
      await run(
        "tmb9",
        `const R="${R}",T="${T}",N=${M};let x=0;let t=u();` +
          `for(let i=0;i<N;i++)x+=Memory.rooms[R].tasks[T].length;` +
          `o.v=+((u()-t)/N).toFixed(6);o.len=x;o.n=N;`,
      ),
    );
    push(
      "10. Game.creeps[name] (на итерацию)",
      await run(
        "tmb10",
        `const nm="${info.cn}",N=${M};let x=0;let t=u();` +
          `for(let i=0;i<N;i++)if(Game.creeps[nm])x++;` +
          `o.v=+((u()-t)/N).toFixed(6);o.len=x;o.n=N;`,
      ),
    );

    // ── 11-13. Реплика тела generateFillSpawnsExtensions ───────────────
    // Копия горячего цикла генератора БЕЗ addTask (addTask пишет в Memory —
    // это уже не замер). Показывает, сколько из измеренной цены генератора
    // объясняется скан+hasDuplicate, а не постановкой задач.
    if (info.nf) {
      const REP =
        `const R="${info.nf}",F=["type","targetId","sourceId","resourceType"],` +
        `rr=Game.rooms[R],L=rr.find(FIND_MY_SPAWNS).concat(` +
        `rr.find(FIND_MY_STRUCTURES,{filter:s=>s.structureType===STRUCTURE_EXTENSION})),` +
        `D=rr.storage?rr.storage.id:"x";`;
      const LOOP_HASH =
        `for(let i=0;i<L.length;i++){const s=L[i].store;objs++;` +
        `if(!s||typeof s.getFreeCapacity!=="function")continue;` +
        `if(s.getFreeCapacity("energy")<=0)continue;` +
        `const C={type:"transfer",sourceId:D,targetId:L[i].id,resourceType:"energy"};` +
        `if(tm.hasDuplicate(R,"fillSpawnsExtensions",C,F))hits++;}`;
      const LOOP_SCAN =
        `for(let i=0;i<L.length;i++){const s=L[i].store;objs++;` +
        `if(!s||typeof s.getFreeCapacity!=="function")continue;` +
        `if(s.getFreeCapacity("energy")<=0)continue;need++;}`;

      push(
        `11. реплика генератора fillSpawns (${info.nf}, скан+hasDuplicate)`,
        await run(
          "tmb11",
          `const N=${N};${REP}let hits=0,objs=0;global.__taskHeap=undefined;let t=u();` +
            `for(let k=0;k<N;k++){${LOOP_HASH}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=objs/N;o.hits=hits/N;o.n=N;`,
        ),
      );
      push(
        "12. только скан (без hasDuplicate)",
        await run(
          "tmb12",
          `const N=${N};${REP}let need=0,objs=0;global.__taskHeap=undefined;let t=u();` +
            `for(let k=0;k<N;k++){${LOOP_SCAN}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=objs/N;o.need=need/N;o.n=N;`,
        ),
      );
      // Разбор скана по частям: где именно уходит 0.024 CPU на комнату.
      push(
        "12a. скан: пустой цикл по объектам",
        await run(
          "tmb12a",
          `const N=${N};${REP}let objs=0;let t=u();` +
            `for(let k=0;k<N;k++){for(let i=0;i<L.length;i++){objs++;}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=objs/N;o.n=N;`,
        ),
      );
      push(
        "12b. скан: чтение .store + typeof (без вызова)",
        await run(
          "tmb12b",
          `const N=${N};${REP}let objs=0;let t=u();` +
            `for(let k=0;k<N;k++){for(let i=0;i<L.length;i++){const s=L[i].store;objs++;` +
            `if(!s||typeof s.getFreeCapacity!=="function")continue;}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=objs/N;o.n=N;`,
        ),
      );
      push(
        "12c. скан: energy < energyCapacity",
        await run(
          "tmb12c",
          `const N=${N};${REP}let need=0,objs=0;let t=u();` +
            `for(let k=0;k<N;k++){for(let i=0;i<L.length;i++){const o2=L[i];objs++;` +
            `if(o2.energy<o2.energyCapacity)need++;}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=objs/N;o.need=need/N;o.n=N;`,
        ),
      );
      push(
        "12d. скан: store[energy] < store.getCapacity()",
        await run(
          "tmb12d",
          `const N=${N};${REP}let need=0,objs=0;let t=u();` +
            `for(let k=0;k<N;k++){for(let i=0;i<L.length;i++){const s=L[i].store;objs++;` +
            `if(s["energy"]<s.getCapacity("energy"))need++;}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=objs/N;o.need=need/N;o.n=N;`,
        ),
      );
      push(
        "12e. скан: .id каждого объекта",
        await run(
          "tmb12e",
          `const N=${N};${REP}let x=0;let t=u();` +
            `for(let k=0;k<N;k++){for(let i=0;i<L.length;i++){if(L[i].id)x++;}}` +
            `o.v=+((u()-t)/N).toFixed(5);o.objs=x/N;o.n=N;`,
        ),
      );
    }

    // ── 14. Тело rangeFn: то, что платит воркер на каждого кандидата ────
    if (info.cn && info.tid) {
      push(
        `14. rangeFn целиком (getObjectById + getRangeTo + store)`,
        await run(
          "tmb14",
          `const N=${N},c=Game.creeps["${info.cn}"],I="${info.tid}",o2=Game.getObjectById(I);` +
            `let x=0;let t=u();for(let i=0;i<N;i++){` +
            `const id=c.store.getFreeCapacity()===0?I:I;const g=Game.getObjectById(id);` +
            `if(g&&c.pos)x+=c.pos.getRangeTo(g);}` +
            `o.v=+((u()-t)/N).toFixed(5);o.x=x;o.n=N;`,
        ),
      );
      push(
        "14a. только Game.getObjectById",
        await run(
          "tmb14a",
          `const N=${N},I="${info.tid}";let x=0;let t=u();` +
            `for(let i=0;i<N;i++){if(Game.getObjectById(I))x++;}` +
            `o.v=+((u()-t)/N).toFixed(6);o.x=x;o.n=N;`,
        ),
      );
      push(
        "14b. только pos.getRangeTo",
        await run(
          "tmb14b",
          `const N=${N},c=Game.creeps["${info.cn}"],g=Game.getObjectById("${info.tid}");` +
            `let x=0;let t=u();for(let i=0;i<N;i++){if(g&&c.pos)x+=c.pos.getRangeTo(g);}` +
            `o.v=+((u()-t)/N).toFixed(6);o.x=x;o.n=N;`,
        ),
      );
      push(
        "14c. только creep.store.getFreeCapacity()",
        await run(
          "tmb14c",
          `const N=${N},c=Game.creeps["${info.cn}"];let x=0;let t=u();` +
            `for(let i=0;i<N;i++){if(c.store.getFreeCapacity()===0)x++;}` +
            `o.v=+((u()-t)/N).toFixed(6);o.x=x;o.n=N;`,
        ),
      );
    }

    // ── 15-16. Реплика generateFillTerminalEnergy (без addTask) ────────
    // Генератор «одна заявка на комнату» показывает в cpuMonitor 0.0928
    // CPU/тик на 5 комнат (0.0186 на комнату). Проверяем, чем эта цифра
    // может объясняться: двумя чтениями store и одним hasDuplicate.
    if (info.nf) {
      const TR =
        `const R="${info.nf}",rr=Game.rooms[R],tr=rr.terminal,st=rr.storage,` +
        `F=["type","sourceId","targetId","resourceType"];`;
      push(
        "15. fillTerminalEnergy: 2 чтения store + hasDuplicate",
        await run(
          "tmb15",
          `const N=${N};${TR}` +
            `const D=st?st.id:"x",E=tr?tr.id:"y";global.__taskHeap=undefined;let t=u();` +
            `for(let k=0;k<N;k++){if(tr.store["energy"]>=150000)continue;` +
            `if(st.store["energy"]<=195000)continue;` +
            `const C={type:"transfer",sourceId:D,targetId:E,resourceType:"energy"};` +
            `if(tm.hasDuplicate(R,"fillTerminalEnergy",C,F))continue;}` +
            `o.v=+((u()-t)/N).toFixed(5);o.n=N;o.tr=tr.store["energy"];o.st=st.store["energy"];`,
        ),
      );
      push(
        "16. fillTerminalEnergy: только 2 чтения store",
        await run(
          "tmb16",
          `const N=${N};${TR}let x=0;let t=u();` +
            `for(let k=0;k<N;k++){x+=tr.store["energy"];x+=st.store["energy"];}` +
            `o.v=+((u()-t)/N).toFixed(5);o.x=x;o.n=N;`,
        ),
      );
      push(
        "16a. только чтение terminal.store[energy]",
        await run(
          "tmb16a",
          `const N=${N};${TR}let x=0;let t=u();` +
            `for(let k=0;k<N;k++){x+=tr.store["energy"];}` +
            `o.v=+((u()-t)/N).toFixed(6);o.x=x;o.n=N;`,
        ),
      );
      push(
        "16b. только чтение storage.store[energy]",
        await run(
          "tmb16b",
          `const N=${N};${TR}let x=0;let t=u();` +
            `for(let k=0;k<N;k++){x+=st.store["energy"];}` +
            `o.v=+((u()-t)/N).toFixed(6);o.x=x;o.n=N;`,
        ),
      );
    }

    // ── 17-18. Примитивы внутренностей addTask ────────────────────────
    push(
      "17. Map.set + Map.get (индекс очереди)",
      await run(
        "tmb17",
        `const N=${M};const m=new Map();let x=0;let t=u();` +
          `for(let i=0;i<N;i++){m.set("task_"+i,i);x+=m.get("task_"+i);}` +
          `o.v=+((u()-t)/N).toFixed(6);o.x=x;o.n=N;`,
      ),
    );
    push(
      "18. объект задачи + push в массив",
      await run(
        "tmb18",
        `const N=${M},a=[];let t=u();` +
          `for(let i=0;i<N;i++){a.push({type:"transfer",sourceId:"a",targetId:"b",` +
          `resourceType:"energy",taskId:"task_"+i});if(a.length>1000)a.length=0;}` +
          `o.v=+((u()-t)/N).toFixed(6);o.n=N;`,
      ),
    );
    // ── 19. Проверка самого приёма «окно из двух getUsed()» ────────────
    // cpuMonitor меряет подсистему как разность двух Game.cpu.getUsed()
    // вокруг ОДНОГО вызова. Если у этого приёма есть собственный пол
    // (квантование isolate.cpuTime), то дешёвые окна в отчёте завышены.
    // Здесь тот же приём применён к пустой функции и к дешёвому вызову.
    push(
      "19a. окно вокруг ПУСТОЙ функции (пол приёма)",
      await run(
        "tmb19a",
        `const N=${N * 2},f=function(){};let acc=0;let t=u();` +
          `for(let i=0;i<N;i++){const b=u();f();acc+=u()-b;}` +
          `o.v=+(acc/N).toFixed(6);o.all=+((u()-t)/N).toFixed(6);o.n=N;`,
      ),
    );
    push(
      "19b. окно вокруг Game.cpu.getUsed() (два вызова)",
      await run(
        "tmb19b",
        `const N=${N * 2};let acc=0;let t=u();` +
          `for(let i=0;i<N;i++){const b=u();u();acc+=u()-b;}` +
          `o.v=+(acc/N).toFixed(6);o.all=+((u()-t)/N).toFixed(6);o.n=N;`,
      ),
    );
    push(
      "19c. окно вокруг getNextTask (как меряет cpuMonitor)",
      await run(
        "tmb19c",
        `const N=${N * 2},R="${R}",T="${T}";global.__taskHeap=undefined;tm.getNextTask(R,T);` +
          `let acc=0;let t=u();` +
          `for(let i=0;i<N;i++){const b=u();tm.getNextTask(R,T);acc+=u()-b;}` +
          `o.v=+(acc/N).toFixed(6);o.all=+((u()-t)/N).toFixed(6);o.n=N;`,
      ),
    );
    push(
      "19d. окно вокруг hasDuplicate (как меряет cpuMonitor)",
      await run(
        "tmb19d",
        `const N=${N * 2},R="${R}",T="${T}";const F=["targetId"];` +
          `const C={type:"repair",targetId:"__none"};global.__taskHeap=undefined;` +
          `tm.hasDuplicate(R,T,C,F);let acc=0;let t=u();` +
          `for(let i=0;i<N;i++){const b=u();tm.hasDuplicate(R,T,C,F);acc+=u()-b;}` +
          `o.v=+(acc/N).toFixed(6);o.all=+((u()-t)/N).toFixed(6);o.n=N;`,
      ),
    );
  } finally {
    // Уборка: временных полей в Memory не остаётся.
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(500);
    fs.writeFileSync(OUT, JSON.stringify({ shard: SHARD, n: N, rows }, null, 1));
  }

  console.log(`\nсырые данные: ${OUT}`);
})().catch(e => {
  console.error("ОШИБКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});
