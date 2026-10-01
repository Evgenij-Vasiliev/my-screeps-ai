"use strict";
/**
 * ===================================================
 * SCRIPTS/PATH.QUALITY.MEASURE.JS — качество маршрута с CostMatrix (Шаг 4)
 * ===================================================
 * Read-only замер. Вопрос: меняет ли матрица дорог (cost 1) сам маршрут и в
 * какую сторону — на нескольких парах «крип → дальняя структура», а не на
 * одной (иначе вывод строится на одной точке).
 *
 * Командой 1 в heap собирается список пар (до 6), командой 2 по каждой паре
 * считаются два пути от одной и той же позиции:
 *   A) findPathTo без CostMatrix (как ходит бот сейчас);
 *   B) PathFinder.search с уже построенной матрицей дорог (cost 1 на дорогах).
 *
 * Код бота не меняется, moveTo не вызывается, интентов нет.
 *
 * Запуск:
 *   node scripts/path.quality.measure.js            # shard3
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const PAUSE_MS = 2500;
const TICK_MS = 14000;
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

/** Общий прелюд обеих команд: комната, структуры, матрица дорог, крипы. */
const PRELUDE =
  "const R=Object.values(Game.rooms).find(r=>r.controller&&r.controller.my&&r.storage);" +
  "const S=R.find(FIND_STRUCTURES);const K=R.name;const C=Object.values(Game.creeps);" +
  "const m=new PathFinder.CostMatrix();" +
  "for(const s of S)if(s.structureType===STRUCTURE_ROAD)m.set(s.pos.x,s.pos.y,1);";

async function main() {
  const { source } = resolveTokenSource();
  console.log(`Шаг 4: качество маршрута с CostMatrix, шард ${SHARD} (токен из: ${source})`);

  await api.console("Memory.keepTemp = true", SHARD);
  await sleep(1500);

  try {
    // Команда 1: пары «индекс крипа → самая дальняя структура» кладём в heap.
    // Индекс вместо имени: команда 2 должна влезать в 1000 символов консоли.
    await api.console(
      `try{${PRELUDE}global.__pq=null;global.__pqt=Game.time;const a=[];` +
        `for(let i=0;i<C.length;i++){const c=C[i];if(c.room.name!==K)continue;let B=null,D=0;` +
        `for(const s of S){const d=c.pos.getRangeTo(s);if(d>D){D=d;B=s;}}` +
        `if(B&&D>=15)a.push([i,B.pos.x,B.pos.y,D]);if(a.length>=6)break;}global.__pq=a;}catch(e){}`,
      SHARD,
    );
    await sleep(TICK_MS);
    // Индексы крипов действительны только в тике замера: за время лага консоли
    // состав Game.creeps мог измениться, поэтому проверяем и перечитываем.
    const fresh = JSON.parse(
      await evalInGame(
        "pqFresh",
        `JSON.stringify({t:Game.time,stamp:global.__pqt,n:(global.__pq||[]).length})`,
      ),
    );
    console.log("пары собраны:", JSON.stringify(fresh));

    // Команда 2: два пути на каждую пару от одной и той же позиции (CPU и длина).
    const r = JSON.parse(
      await evalInGame(
        "pq",
        `(()=>{${PRELUDE}const u=()=>Game.cpu.getUsed();const A=global.__pq||[];const o=[];` +
          `for(const [i,x,y,D] of A){const c=C[i];if(!c)continue;const Q=R.getPositionAt(x,y);` +
          `let t=u();const a=c.pos.findPathTo(Q,{ignoreCreeps:true});const ca=u()-t;` +
          `t=u();const b=PathFinder.search(c.pos,{pos:Q},{maxOps:2000,roomCallback:()=>m});const cb=u()-t;` +
          `o.push({r:c.memory.role,d:D,la:a.length,lb:b.path.length,ca:+ca.toFixed(4),cb:+cb.toFixed(4),ops:b.ops});}` +
          `return JSON.stringify({room:K,pairs:o});})()`,
      ),
      TICK_MS,
    );

    // Команда 3: вес маршрута (усталость) для обоих путей — отдельной командой,
    // иначе она не влезает в лимит консоли. Множитель тайла НАЗНАЧЕНИЯ:
    // дорога 1, обычный тайл 2, свамп 10 (ENG movement.js:204-214).
    const w = JSON.parse(
      await evalInGame(
        "pqw",
        `(()=>{const R=Object.values(Game.rooms).find(r=>r.controller&&r.controller.my&&r.storage);` +
          `const S=R.find(FIND_STRUCTURES);const T=R.getTerrain();const rs={};` +
          `for(const s of S)if(s.structureType===STRUCTURE_ROAD)rs[s.pos.x+","+s.pos.y]=1;` +
          `const o=[];` +
          `for(const [i,x,y,D] of (global.__pq||[])){const c=Object.values(Game.creeps)[i];if(!c)continue;` +
          `const Q=R.getPositionAt(x,y);const a=c.pos.findPathTo(Q,{ignoreCreeps:true});` +
          `const m2=new PathFinder.CostMatrix();for(const s of S)if(s.structureType===STRUCTURE_ROAD)m2.set(s.pos.x,s.pos.y,1);` +
          `const b=PathFinder.search(c.pos,{pos:Q},{maxOps:2000,roomCallback:()=>m2}).path;` +
          `let wa=0,wb=0;for(const q of a)wa+=rs[q.x+","+q.y]?1:(T.get(q.x,q.y)===TERRAIN_MASK_SWAMP?10:2);` +
          `for(const q of b)wb+=rs[q.x+","+q.y]?1:(T.get(q.x,q.y)===TERRAIN_MASK_SWAMP?10:2);` +
          `o.push({r:c.memory.role,d:D,wa,wb});}` +
          `return JSON.stringify({pairs:o});})()`,
      ),
      TICK_MS,
    );
    console.log("пути:", JSON.stringify(r, null, 2));
    console.log("вес маршрута (усталость):", JSON.stringify(w, null, 2));

    // Свод: для каждой пары — длина и вес обоих путей и цена поиска.
    const merged = r.pairs.map((p, idx) => {
      const q = (w.pairs || [])[idx] || {};
      return {
        role: p.r,
        range: p.d,
        lenNoCm: p.la,
        lenCm: p.lb,
        weightNoCm: q.wa,
        weightCm: q.wb,
        cpuNoCm: p.ca,
        cpuCm: p.cb,
        ops: p.ops,
      };
    });
    console.log("\nсвод:");
    for (const m of merged) {
      console.log(
        `  ${m.role} (${m.range} тайлов): путь ${m.lenNoCm}→${m.lenCm}, ` +
          `усталость ${m.weightNoCm}→${m.weightCm}, A* ${m.cpuNoCm}→${m.cpuCm} CPU`,
      );
    }

    const report = {
      measuredAt: new Date().toISOString(),
      shard: SHARD,
      room: r.room,
      merged,
      rawPaths: r.pairs,
      rawWeights: w.pairs,
    };
    const fs = require("fs");
    const path = require("path");
    const outFile = path.join(__dirname, "..", "docs", "path-quality-measure.json");
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nОтчёт сохранён: ${outFile}`);
  } finally {
    await api.console("delete Memory.keepTemp", SHARD);
    await sleep(500);
    await api.console("delete Memory.__bench_pq;global.__pq=null;", SHARD);
    await sleep(500);
    console.log("временные поля удалены");
  }
  process.exit(0);
}

main().catch(e => {
  console.log("КРИТИЧЕСКАЯ ОШИБКА:", e.message);
  process.exit(1);
});
