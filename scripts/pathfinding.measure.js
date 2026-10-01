"use strict";
/**
 * ===================================================
 * SCRIPTS/PATHFINDING.MEASURE.JS — замер цены поиска пути (Шаг 4)
 * ===================================================
 * Read-only замер перед правкой «единая политика путей + CostMatrix комнаты».
 * Код бота не меняется, игровых интентов замер не создаёт (проверять интенты
 * приходится по `creep.memory._move`, который оставляет сам бот).
 *
 * Что меряется на живом шарде:
 *   1) самый длинный маршрут комнаты (creep → дальняя структура) без CostMatrix
 *      и с CostMatrix — сравнение цены A*;
 *   2) цена сборки CostMatrix из room.find(FIND_STRUCTURES) и из кэша id сканера;
 *   3) короткий маршрут (creep → storage, 6 тайлов, замеренный ранее);
 *   4) сколько крипов реально платят за поиск пути: у кого в `creep.memory._move`
 *      лежит кэш пути, какой у него возраст и длина;
 *   5) реальная цена `moveTo` в маршруте линкера (link ↔ storage): кэш свежий
 *      (reusePath 5, путь не ищется) против принудительного сброса кэша.
 *
 * ВАЖНО про цену `moveTo` с кэшем: при живом кэше движок не ищет путь, а идёт по
 * сохранённым направлениям; цифра показывает, сколько стоит сам вызов при
 * попадании в кэш, то есть во что обходится повторный `moveTo` каждый тик.
 * Замер с `reusePath: 0` — это цена поиска пути в этом же тике; интент движения
 * в обоих случаях один и тот же (creep и так едет к storage), поэтому картина
 * мира не меняется. Кэш после сброса восстанавливается самим ботом.
 *
 * Бюджет CPU: бот занимает ~5-7 CPU/тик из 20, поэтому тяжёлые замеры разбиты
 * по одному-два на тик (пауза 10 c), а bucket проверяется в прелюде.
 *
 * Запуск:
 *   node scripts/pathfinding.measure.js            # shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;
const TICK_MS = 12000; // один замер на тик
const CONSOLE_LIMIT = 1000;

const api = new ScreepsAPI({ token: resolveTokenSource().token });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function evalInGame(field, expression, pause = PAUSE_MS) {
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
    await sleep(pause);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(pause);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);

  if (value === undefined || value === null) {
    throw new Error(`пустой ответ для поля ${key} после 3 попыток`);
  }
  return String(value);
}

/** Общий прелюд: комната со storage, самый длинный маршрут в ней. */
const PRELUDE =
  "const R=Object.values(Game.rooms).find(r=>r.controller&&r.controller.my&&r.storage);" +
  "const K=R.name;const st=R.storage;const S=R.find(FIND_STRUCTURES);" +
  "let B=null,D=0;const c=Object.values(Game.creeps).find(x=>x.room.name===K);" +
  "for(const s of S){const d=c.pos.getRangeTo(s);if(d>D){D=d;B=s;}}";

/** Матрица дорог из кэша id сканера (как в бою). */
const CACHE_PRELUDE =
  "const C=(global.__structureCache&&global.__structureCache[K])||null;" +
  "const R2=C&&C.roadIds?C.roadIds:null;";

async function main() {
  const { source } = resolveTokenSource();
  console.log(`Шаг 4: замер pathfinding, шард ${SHARD} (токен из: ${source})`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  const out = {};
  try {
    const head = JSON.parse(
      await evalInGame(
        "pfHead",
        `(()=>{${PRELUDE}return JSON.stringify({room:K,t:Game.time,creep:c&&c.name,creeps:Object.keys(Game.creeps).length,` +
          `range:D,target:B&&B.structureType,structs:S.length,bucket:Game.cpu.bucket});})()`,
      ),
    );
    console.log("контекст:", JSON.stringify(head));

    // 1. Длинный маршрут: A* без матрицы против A* с уже построенной матрицей
    //    (сборка матрицы из замера исключена — она измерена отдельно).
    //    Плюс сравнение самого пути: изменится ли маршрут при дорогах cost 1.
    const r1 = JSON.parse(
      await evalInGame(
        "pfLong",
        `(()=>{${PRELUDE}const u=()=>Game.cpu.getUsed();` +
          `const m=new PathFinder.CostMatrix();` +
          `for(const s of S)if(s.structureType===STRUCTURE_ROAD)m.set(s.pos.x,s.pos.y,1);` +
          `let t=u();const a=c.pos.findPathTo(B.pos,{ignoreCreeps:true});const A=u()-t;` +
          `t=u();const b=PathFinder.search(c.pos,{pos:B.pos},{maxOps:2000,roomCallback:()=>m});` +
          `const Bm=u()-t;` +
          `let same=a.length===b.path.length;` +
          `if(same)for(let i=0;i<a.length;i++)if(a[i].x!==b.path[i].x||a[i].y!==b.path[i].y){same=false;break;}` +
          `return JSON.stringify({d:D,lenNoCm:a.length,lenCm:b.path.length,same,` +
          `noCm:+A.toFixed(4),withCm:+Bm.toFixed(4),ops:b.ops});})()`,
      ),
      TICK_MS,
    );
    console.log("1. длинный маршрут (A* отдельно от сборки):", JSON.stringify(r1));
    out.longRoute = r1;

    // 2. Сборка матрицы из кэша id сканера: цена, которую платим раз в 20 тиков.
    const r2 = JSON.parse(
      await evalInGame(
        "pfBuild",
        `(()=>{${PRELUDE}${CACHE_PRELUDE}const u=()=>Game.cpu.getUsed();` +
          `let t=u();const m=new PathFinder.CostMatrix();let n=0;` +
          `if(R2)for(const id of R2){const o=Game.getObjectById(id);if(o){m.set(o.pos.x,o.pos.y,1);n++;}}` +
          `const byCache=u()-t;` +
          `t=u();const m2=new PathFinder.CostMatrix();for(const s of S)if(s.structureType===STRUCTURE_ROAD)m2.set(s.pos.x,s.pos.y,1);` +
          `const byFind=u()-t;` +
          `return JSON.stringify({roads:R2?R2.length:-1,set:n,byCache:+byCache.toFixed(4),byFind:+byFind.toFixed(4)});})()`,
      ),
      TICK_MS,
    );
    console.log("2. сборка матрицы:", JSON.stringify(r2));
    out.matrixBuild = r2;

    // 3. Кто платит за поиск пути: кэш _move у всех крипов.
    const r3 = JSON.parse(
      await evalInGame(
        "pfCache",
        `(()=>{let withCache=0,total=0,ages=[],lens=[];const now=Game.time;` +
          `for(const n in Memory.creeps){total++;const mv=Memory.creeps[n]._move;` +
          `if(mv&&mv.path){withCache++;ages.push(now-mv.time);lens.push(mv.path.length);}}` +
          `ages.sort((a,b)=>a-b);` +
          `return JSON.stringify({total,withCache,ageMin:ages[0],ageMax:ages[ages.length-1],` +
          `lenSum:lens.reduce((a,b)=>a+b,0)});})()`,
      ),
      TICK_MS,
    );
    console.log("3. кэш путей у крипов:", JSON.stringify(r3));
    out.pathCache = r3;

    // 4. Линкер: цена вызова moveTo по одному и тому же маршруту дважды за тик —
    //    первый раз с живым кэшем пути, второй раз с чистого листа (reusePath: 0).
    //    Оба вызова идут к тому же storage, куда линкер и так едет: картина
    //    мира не меняется, к следующему тику бот сам восстановит кэш.
    const r4 = JSON.parse(
      await evalInGame(
        "pfLink",
        `(()=>{${PRELUDE}const lw=Object.values(Game.creeps).find(x=>x.room.name===K&&x.memory.role==='linkWorker');` +
          `if(!lw)return JSON.stringify({err:"нет linkWorker"});const u=()=>Game.cpu.getUsed();` +
          `const mv=lw.memory._move;const hadCache=!!(mv&&mv.path);` +
          `let t=u();const rc1=lw.moveTo(st,{reusePath:5});const cached=u()-t;` +
          `delete lw.memory._move;` +
          `t=u();const rc2=lw.moveTo(st,{reusePath:0});const fresh=u()-t;` +
          `const cacheAfter=!!(lw.memory._move&&lw.memory._move.path);` +
          `return JSON.stringify({hadCache,cacheAfter,rc1,rc2,cached:+cached.toFixed(4),fresh:+fresh.toFixed(4),range:lw.pos.getRangeTo(st)});})()`,
      ),
      TICK_MS,
    );
    console.log("4. linkWorker moveTo:", JSON.stringify(r4));
    out.linkWorker = r4;

    const report = {
      measuredAt: new Date().toISOString(),
      shard: SHARD,
      context: head,
      ...out,
    };
    const fs = require("fs");
    const path = require("path");
    const outFile = path.join(__dirname, "..", "docs", "pathfinding-measure.json");
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nОтчёт сохранён: ${outFile}`);
  } finally {
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(500);
    await api.console(
      "delete Memory.__bench_pfHead; delete Memory.__bench_pfLong; delete Memory.__bench_pfBuild;" +
        " delete Memory.__bench_pfCache; delete Memory.__bench_pfLink;",
      SHARD,
    );
    await sleep(500);
    console.log("временные поля удалены");
  }
  process.exit(0);
}

main().catch(e => {
  console.log("КРИТИЧЕСКАЯ ОШИБКА:", e.message);
  process.exit(1);
});
