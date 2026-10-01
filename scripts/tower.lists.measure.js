"use strict";
/**
 * ===================================================
 * SCRIPTS/TOWER.LISTS.MEASURE.JS — замер «горячих списков» башен (Шаг 5)
 * ===================================================
 * Read-only замер ПЕРЕД правкой «Шаг 5: один проход по горячим спискам на
 * комнату». Ничего не выгружает на шард и не меняет боевой код: только
 * консольные выражения, результат — во временном поле Memory.__bench_*.
 *
 * ЧТО МЕРИТСЯ И ЗАЧЕМ:
 *   1) состояние империи: комнаты, башни по комнатам, враждебные крипы по
 *      комнатам — без этих чисел нельзя сказать, сколько раз в тик вообще
 *      исполняется «список на башню»;
 *   2) Memory.cpuStats.subsystems.towers — фактическая цена подсистемы башен
 *      (runTowerLogic) за последнее окно CPU.REPORT_INTERVAL тиков;
 *   3) цена повторного room.find(FIND_HOSTILE_CREEPS) в том же тике — ровно
 *      то, что экономил бы вынос списка враждебных из цикла по башням;
 *   4) цена одного JS-прохода, собирающего список повреждённых структур из
 *      уже закэшированного room.find(FIND_STRUCTURES) — то, что стоит
 *      «сборка списка повреждённых», если делать её на каждую башню;
 *   5) цена tower.pos.findClosestByRange(list) — линейный поиск в движке
 *      (docs/api#RoomPosition-findClosestByRange), вызывается на КАЖДУЮ
 *      башню. Прокси: список структур комнаты той же длины, что и типичный
 *      список враждебных; без враждебных в комнате эта ветка не исполняется.
 *   6) (шаг 10) цена перебора `roomState.damagedStructures` в генераторе
 *      repair-задач — единственном потребителе списка, который читает его
 *      каждый тик, а не раз в TOWER.REPAIR_INTERVAL. Нужна перед правкой
 *      ленивой сборки списка: без этой цифры неизвестно, можно ли гейтить
 *      генератор по интервалу. Данные — живые дороги и настоящая очередь
 *      Memory.rooms[room].tasks.repairStructures.
 *   7) (шаг 11) тот же отбор, но по числам из кэша сканера, без
 *      Game.getObjectById — цена генератора ПОСЛЕ правки варианта B. Разница
 *      шагов 10 и 11 и есть экономия правки. Сборка самих массивов чисел в
 *      замер не входит: она делается в уже существующем проходе сканера по
 *      FIND_STRUCTURES и отдельных вызовов API не добавляет.
 *
 * ОГРАНИЧЕНИЯ (проверено ранее, docs/CPU-BASELINE.md):
 *   - консольная команда длиннее ~1000 символов молча теряется;
 *   - ответ выражения читается из Memory, а не из ответа консоли;
 *   - bot-код и консоль — разные JS-контексты, поэтому замер идёт по
 *     «сырым» вызовам API, а не по вызову runTowerLogic (он к тому же
 *     выполняет игровые интенты attack/repair — это уже не read-only).
 *
 * Временные поля: Memory.keepTemp и Memory.__bench_* — снимаются в finally.
 *
 * Запуск:
 *   node scripts/tower.lists.measure.js           # shard3
 *   node scripts/tower.lists.measure.js shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;
const CONSOLE_LIMIT = 1000;
/** Секция 8 (опрос окон cpuStats) длится ~2 минуты — её можно отключить. */
const WITH_WATCH = !process.argv.includes("--nowatch");

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Выполняет выражение в консоли шарда, результат читает из Memory.__bench_*. */
async function evalInGame(field, expression) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;

  if (command.length > CONSOLE_LIMIT) {
    throw new Error(
      `выражение ${field}: ${command.length} > ${CONSOLE_LIMIT} символов`,
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
  await sleep(600);

  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

/** Короткая обёртка: у своих комнат и башен есть один и тот же префикс. */
const MY_ROOM =
  "Object.values(Game.rooms).find(x=>x.controller&&x.controller.my)";

async function main() {
  const { source } = resolveTokenSource();
  console.log(
    `Шаг 5: замер горячих списков башен, шард ${SHARD} (токен из: ${source})`,
  );

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  try {
    /* ── 1. Состояние: комнаты, башни, враждебные, цена подсистемы ────── */
    const state = JSON.parse(
      await evalInGame(
        "tw1",
        `JSON.stringify({t:Game.time,lim:Game.cpu.limit,bkt:Game.cpu.bucket,
        avg:Memory.cpuStats&&Memory.cpuStats.average,
        cnt:Memory.cpuStats&&Memory.cpuStats.count,
        sub:Memory.cpuStats&&Memory.cpuStats.subsystems,
        creeps:Object.keys(Game.creeps).length,
        mine:Object.values(Game.rooms).filter(r=>r.controller&&r.controller.my).length,
        towers:Object.values(Game.structures).filter(s=>s.structureType===STRUCTURE_TOWER).length,
        host:Object.values(Game.rooms).reduce((a,r)=>a+r.find(FIND_HOSTILE_CREEPS).length,0),
        structs:Object.keys(Game.structures).length})`,
      ),
    );
    console.log("1. state:", JSON.stringify(state));

    /* ── 2. Разбивка по комнатам: башни и враждебные ──────────────────── */
    const perRoom = JSON.parse(
      await evalInGame(
        "tw2",
        `JSON.stringify(Object.values(Game.rooms).filter(r=>r.controller&&r.controller.my)
        .map(r=>r.name+" t"+r.find(FIND_MY_STRUCTURES).filter(s=>s.structureType===STRUCTURE_TOWER).length
        +" h"+r.find(FIND_HOSTILE_CREEPS).length+" s"+r.find(FIND_STRUCTURES).length))`,
      ),
    );
    console.log("2. комнаты (t = башни, h = враждебные, s = структуры):", JSON.stringify(perRoom));

    /* ── 3. Цена room.find(FIND_HOSTILE_CREEPS): первый и повторный ───── */
    const findCost = JSON.parse(
      await evalInGame(
        "tw3",
        `(()=>{const u=()=>Game.cpu.getUsed(),r=${MY_ROOM};
        const t0=u();const a=r.find(FIND_HOSTILE_CREEPS);const cold=u()-t0;
        const t1=u();for(let i=0;i<50;i++)r.find(FIND_HOSTILE_CREEPS);const rep=(u()-t1)/50;
        return JSON.stringify({n:a.length,cold:+cold.toFixed(5),rep:+rep.toFixed(6)});})()`,
      ),
    );
    console.log("3. room.find(FIND_HOSTILE_CREEPS):", JSON.stringify(findCost));

    /* ── 4. Цена сборки списка повреждённых из закэшированного find ───── */
    const dmgCost = JSON.parse(
      await evalInGame(
        "tw4",
        `(()=>{const u=()=>Game.cpu.getUsed(),r=${MY_ROOM};
        const all=r.find(FIND_STRUCTURES);
        const pass=()=>{let n=0;for(let i=0;i<all.length;i++){const s=all[i];if(s.hits<s.hitsMax)n++}return n};
        const t0=u();const n=pass();const first=u()-t0;
        const t1=u();for(let k=0;k<20;k++)pass();const rep=(u()-t1)/20;
        return JSON.stringify({structs:all.length,dmg:n,first:+first.toFixed(5),rep:+rep.toFixed(6)});})()`,
      ),
    );
    console.log("4. сборка списка повреждённых (JS-проход):", JSON.stringify(dmgCost));

    /* ── 5. Цена findClosestByRange на башню (прокси: список структур) ── */
    const closeCost = JSON.parse(
      await evalInGame(
        "tw5",
        `(()=>{const u=()=>Game.cpu.getUsed(),r=${MY_ROOM};
        const tw=r.find(FIND_MY_STRUCTURES).filter(s=>s.structureType===STRUCTURE_TOWER);
        const list=r.find(FIND_STRUCTURES);
        const t=tw[0];if(!t)return JSON.stringify({towers:0});
        const t0=u();for(let i=0;i<20;i++)t.pos.findClosestByRange(list);const per=(u()-t0)/20;
        const t1=u();for(let i=0;i<20;i++)t.pos.findClosestByRange([]);const empty=(u()-t1)/20;
        return JSON.stringify({towers:tw.length,list:list.length,per:+per.toFixed(5),empty:+empty.toFixed(6)});})()`,
      ),
    );
    console.log("5. tower.pos.findClosestByRange:", JSON.stringify(closeCost));

    /* ── 6. Как растёт findClosestByRange с длиной списка ─────────────── */
    const closeScale = JSON.parse(
      await evalInGame(
        "tw6",
        `(()=>{const u=()=>Game.cpu.getUsed(),r=${MY_ROOM};
        const t=r.find(FIND_MY_STRUCTURES).filter(s=>s.structureType===STRUCTURE_TOWER)[0];
        const L=r.find(FIND_STRUCTURES),o={};
        for(const k of [1,4,10,25,50,100,L.length]){const s=L.slice(0,k);
        const t0=u();for(let i=0;i<20;i++)t.pos.findClosestByRange(s);
        o[k]=+((u()-t0)/20).toFixed(6);}
        return JSON.stringify(o);})()`,
      ),
    );
    console.log("6. findClosestByRange по длине списка:", JSON.stringify(closeScale));

    /* ── 7. Состав структур комнаты: сколько элементов обходят списки ─── */
    const types = JSON.parse(
      await evalInGame(
        "tw7",
        `JSON.stringify(Object.values(Game.rooms).filter(r=>r.controller&&r.controller.my)
        .map(r=>{const a=r.find(FIND_STRUCTURES),c={},d={};
        for(let i=0;i<a.length;i++){const s=a[i],k=s.structureType;
        c[k]=(c[k]||0)+1;if(s.hits<s.hitsMax)d[k]=(d[k]||0)+1}
        return {room:r.name,total:a.length,count:c,damaged:d}}))`,
      ),
    );
    console.log("7. состав структур по комнатам:", JSON.stringify(types));

    /* ── 8. Окна Memory.cpuStats подряд: есть ли периодический пик ────── */
    // Только чтение через API (никаких консольных команд): смотрим, как
    // меняется subsystems.towers от окна к окну. Ремонт башен идёт раз в
    // TOWER.REPAIR_INTERVAL (15) тиков, отчёт CPU — раз в CPU.REPORT_INTERVAL
    // (10) тиков, поэтому окна с ремонтом должны выделяться.
    const windows = [];
    for (let i = 0; i < (WITH_WATCH ? 10 : 0); i++) {
      const res = await api.memory.get("cpuStats", SHARD);
      const cs = res && res.data;
      if (cs && cs.subsystems) {
        const line = {
          at: new Date().toISOString(),
          average: cs.average,
          count: cs.count,
          bucket: cs.bucket,
          creeps: cs.creeps,
          towers: cs.subsystems.towers,
          taskManager: cs.subsystems.taskManager,
          marketManager: cs.subsystems.marketManager,
        };
        const same =
          windows.length &&
          windows[windows.length - 1].count === line.count &&
          windows[windows.length - 1].average === line.average;
        if (!same) windows.push(line);
      }
      await sleep(10000);
    }
    console.log("8. окна cpuStats (subsystems.towers):");
    for (const w of windows) {
      console.log(
        `   avg ${String(w.average).slice(0, 6)} cnt ${w.count} towers ${w.towers} ` +
          `task ${w.taskManager} market ${w.marketManager}`,
      );
    }

    /* ── 9. Сколько СЕЙЧАС стоит сборка damagedStructures по комнатам ─── */
    // buildRoomState (room.manager.js:337-385) делает ровно это: резолвит id
    // групп и повреждённых дорог через Game.getObjectById и проверяет
    // hits < hitsMax. Из консоли вызвать buildRoomState нельзя (другой
    // JS-контекст), поэтому мерим эквивалентные операции на реальных id.
    const dmgRoads = JSON.parse(
      await evalInGame(
        "tw9a",
        `(()=>{const u=()=>Game.cpu.getUsed(),o=[];
        for(const r of Object.values(Game.rooms)){if(!r.controller||!r.controller.my)continue;
        const d=r.find(FIND_STRUCTURES).filter(s=>s.structureType===STRUCTURE_ROAD&&s.hits<s.hitsMax).map(s=>s.id);
        const t0=u();let n=0;
        for(let i=0;i<d.length;i++){const s=Game.getObjectById(d[i]);if(s&&s.hits<s.hitsMax)n++}
        o.push([r.name,d.length,n,+ (u()-t0).toFixed(5)])}
        return JSON.stringify(o)})()`,
      ),
    );
    console.log("9a. повреждённые дороги (резолв+проверка), [комната, дорог, повреждённых, CPU]:");
    console.log("   ", JSON.stringify(dmgRoads));

    const dmgGroups = JSON.parse(
      await evalInGame(
        "tw9b",
        `(()=>{const u=()=>Game.cpu.getUsed(),o=[],T=[STRUCTURE_EXTENSION,STRUCTURE_LINK,STRUCTURE_LAB,STRUCTURE_TOWER,STRUCTURE_SPAWN];
        for(const r of Object.values(Game.rooms)){if(!r.controller||!r.controller.my)continue;
        const a=r.find(FIND_STRUCTURES),g=[];
        for(let i=0;i<a.length;i++)if(T.indexOf(a[i].structureType)>=0)g.push(a[i].id);
        const t0=u();let n=0;
        for(let i=0;i<g.length;i++){const s=Game.getObjectById(g[i]);if(s&&s.hits<s.hitsMax)n++}
        o.push([r.name,g.length,n,+ (u()-t0).toFixed(5)])}
        return JSON.stringify(o)})()`,
      ),
    );
    console.log("9b. группы (spawns/towers/links/labs/extensions), [комната, объектов, повреждённых, CPU]:");
    console.log("   ", JSON.stringify(dmgGroups));

    /* ── 10. Цена перебора списка в генераторе repair-задач ───────────── */
    // Вопрос перед правкой сборки damagedStructures: сколько стоит её
    // ЕДИНСТВЕННЫЙ потребитель, который читает список не раз в 15 тиков, а
    // каждый тик. Это generateRepairStructures (task.generators.js:362-383):
    // перебор всех повреждённых (сейчас — 730 дорог), отсев по
    // REPAIR_THRESHOLD_RATIO = 0.5 (:353, :368) и проверка дубля по targetId
    // (:356, :377-379). Замер идёт на живых дорогах комнаты, дубли — из
    // настоящей очереди Memory.rooms[room].tasks.repairStructures, ключ
    // считается как taskManager.taskKey по одному полю: String(targetId)+"\u0000"
    // (task.manager.js:54-60, :356) — то есть значения те же, что у боевого кода.
    const repairPass = JSON.parse(
      await evalInGame(
        "tw10",
        `(()=>{const u=()=>Game.cpu.getUsed(),o=[],S=new Set();
        for(const r of Object.values(Game.rooms)){if(!r.controller||!r.controller.my)continue;
        const q=(Memory.rooms[r.name].tasks||{}).repairStructures||[];
        for(let i=0;i<q.length;i++)if(q[i])S.add(q[i].targetId+"\\u0000");
        const a=r.find(FIND_STRUCTURES),d=[];
        for(let i=0;i<a.length;i++){const s=a[i];if(s.structureType===STRUCTURE_ROAD&&s.hits<s.hitsMax)d.push(s)}
        let pass=0,dup=0;const K=20;
        const t0=u();
        for(let k=0;k<K;k++){pass=0;dup=0;
        for(let i=0;i<d.length;i++){const s=d[i];
        if(s.hits>=s.hitsMax*0.5)continue;
        pass++;if(S.has(s.id+"\\u0000"))dup++}}
        o.push([r.name,d.length,pass,dup,+((u()-t0)/K).toFixed(5)])}
        return JSON.stringify(o)})()`,
      ),
    );
    console.log("10. генератор repair-задач, [комната, дорог, ниже 50%, дублей, CPU]:");
    console.log("   ", JSON.stringify(repairPass));

    /* ── 11. Цена НОВОГО пути: числа из кэша вместо резолва ───────────── */
    // Правка 29.09.2026 (вариант B): сканер кладёт рядом с id дороги её
    // hits/hitsMax (scanner.js, case STRUCTURE_ROAD), а генератор сравнивает
    // ЧИСЛА, не резолвя объекты. Замер повторяет ровно эту работу: тот же
    // отсев по порогу 50 % плюс проверка Set — но без Game.getObjectById.
    // Сборка массивов статистики (то, что делает сканер раз в
    // CACHE.REFRESH_INTERVAL тиков) в замер НЕ входит: она уже оплачена
    // проходом по FIND_STRUCTURES, который сканер делает и без неё.
    const numbersPass = JSON.parse(
      await evalInGame(
        "tw11",
        `(()=>{const u=()=>Game.cpu.getUsed(),o=[],S=new Set();
        for(const r of Object.values(Game.rooms)){if(!r.controller||!r.controller.my)continue;
        const q=(Memory.rooms[r.name].tasks||{}).repairStructures||[];
        for(let i=0;i<q.length;i++)if(q[i])S.add(q[i].targetId+"\\u0000");
        const a=r.find(FIND_STRUCTURES),id=[],h=[],m=[];
        for(let i=0;i<a.length;i++){const s=a[i];
        if(s.structureType!==STRUCTURE_ROAD||s.hits>=s.hitsMax)continue;
        id.push(s.id);h.push(s.hits);m.push(s.hitsMax)}
        const H=Int32Array.from(h),M=Int32Array.from(m);
        let pass=0,dup=0;const K=20,t0=u();
        for(let k=0;k<K;k++){pass=0;dup=0;
        for(let i=0;i<id.length;i++){
        if(H[i]*2>=M[i])continue;
        pass++;if(S.has(id[i]+"\\u0000"))dup++}}
        o.push([r.name,id.length,pass,dup,+((u()-t0)/K).toFixed(5)])}
        return JSON.stringify(o)})()`,
      ),
    );
    console.log("11. новый путь (числа из кэша), [комната, дорог, ниже 50%, дублей, CPU]:");
    console.log("   ", JSON.stringify(numbersPass));

    /* ── Итог ─────────────────────────────────────────────────────────── */
    const towersSub = state.sub && state.sub.towers;
    const perTowerFind = findCost.rep * (state.towers - state.mine);
    const elemCost =
      closeScale[String(closeCost.list)] !== undefined && closeCost.list > 0
        ? closeScale[String(closeCost.list)] / closeCost.list
        : null;

    console.log("\n— Подсистема towers (Memory.cpuStats.subsystems.towers):", towersSub, "CPU/тик");
    console.log(
      `— Башен в империи: ${state.towers}, комнат: ${state.mine}, враждебных крипов: ${state.host}`,
    );
    console.log(
      `— Гипотетический повтор room.find на КАЖДУЮ башню (${state.towers} - ${state.mine} лишних вызовов): ` +
        `${perTowerFind.toFixed(5)} CPU/тик`,
    );
    console.log(
      `— findClosestByRange: ${elemCost === null ? "n/a" : elemCost.toFixed(6)} CPU на элемент списка`,
    );

    const sumRoads = +dmgRoads.reduce((a, x) => a + x[3], 0).toFixed(5);
    const sumGroups = +dmgGroups.reduce((a, x) => a + x[3], 0).toFixed(5);
    const sumRepair = +repairPass.reduce((a, x) => a + x[4], 0).toFixed(5);
    const sumBelowHalf = repairPass.reduce((a, x) => a + x[2], 0);
    const sumDup = repairPass.reduce((a, x) => a + x[3], 0);
    const sumNumbers = +numbersPass.reduce((a, x) => a + x[4], 0).toFixed(5);
    console.log(
      `— Сборка damagedStructures (эквивалент room.manager.js:371-385) по империи: ` +
        `дороги ${sumRoads} + группы ${sumGroups} = ${(sumRoads + sumGroups).toFixed(5)} CPU/тик`,
    );
    console.log(
      `— Перебор списка в генераторе repair-задач (task.generators.js:367-380) по империи: ` +
        `${sumRepair} CPU/тик; ниже порога 50% — ${sumBelowHalf}, из них дублей ${sumDup}`,
    );
    console.log(
      `— Тот же отбор по ЧИСЛАМ, без резолва (новый путь): ${sumNumbers} CPU/тик; ` +
        `экономия ${(sumRepair - sumNumbers).toFixed(5)} CPU/тик`,
    );

    const out = {
      measuredAt: new Date().toISOString(),
      shard: SHARD,
      gameTime: state.t,
      state,
      perRoom,
      findCost,
      dmgCost,
      closeCost,
      closeScale,
      types,
      windows,
      dmgRoads,
      dmgGroups,
      repairPass,
      numbersPass,
      derived: {
        towersSubsystemCpuPerTick: towersSub,
        hypotheticalPerTowerFindCpu: +perTowerFind.toFixed(5),
        closestByRangeCpuPerElement:
          elemCost === null ? null : +elemCost.toFixed(6),
        damagedListRoadsCpuPerTick: sumRoads,
        damagedListGroupsCpuPerTick: sumGroups,
        damagedListTotalCpuPerTick: +(sumRoads + sumGroups).toFixed(5),
        // Шаг 10: цена единственного потребителя списка, который читает его
        // каждый тик (не раз в TOWER.REPAIR_INTERVAL).
        repairGeneratorCpuPerTick: sumRepair,
        repairGeneratorBelowThreshold: sumBelowHalf,
        repairGeneratorDuplicates: sumDup,
        // Шаг 11: тот же отбор, но по числам кэша — цена после правки.
        numbersPathCpuPerTick: sumNumbers,
        numbersPathSavingCpuPerTick: +(sumRepair - sumNumbers).toFixed(5),
      },
    };
    const fs = require("fs");
    const path = require("path");
    const outFile = path.join(
      __dirname,
      "..",
      "docs",
      "tower-lists-measure.json",
    );
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
    console.log(`\nОтчёт сохранён: ${outFile}`);
  } finally {
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(600);
    console.log("Memory.keepTemp снят.");
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log("КРИТИЧЕСКАЯ ОШИБКА:", e.message);
    process.exit(1);
  });
