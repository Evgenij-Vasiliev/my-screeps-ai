"use strict";
/**
 * АВАРИЙНАЯ ДИАГНОСТИКА (ТОЛЬКО ЧТЕНИЕ) — комната E35S37.
 *
 * Почему так: HTTP-консоль Screeps результата НЕ возвращает (только ok),
 * а сокет консоли периодически отдаёт 502/пусто. Рабочий обходной путь:
 * команда считает отчёт и кладёт его в Memory.__diag, а мы читаем
 * Memory.__diag через HTTP endpoint /api/user/memory (gz+base64).
 *
 * Запуск: node tests/_diag.crisis.js [roomName]
 */
const zlib = require("zlib");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const ROOM = process.argv[2] || "E35S37";

const api = new ScreepsAPI({ token: TOKEN });

const CMD = `(function(){
var rn=${JSON.stringify(ROOM)};
var o={t:Game.time,cpu:Game.cpu.getUsed(),err:null,rm:null,creeps:[],hostiles:null,ev:null};
try{
 var rm=Memory.rooms[rn]||{};
 o.rm={keys:Object.keys(rm),links:rm.links?JSON.stringify(rm.links):"ОТСУТСТВУЕТ",tasks:{},taskSample:{}};
 var tk=rm.tasks||{};
 for(var k in tk){
   var q=tk[k];if(!q.length)continue;
   var res=0;for(var i=0;i<q.length;i++){if(q[i].reservedBy)res++;}
   o.rm.tasks[k]=q.length+"/"+res;
   var free=null;for(var j=0;j<q.length;j++){if(!q[j].reservedBy){free=q[j];break;}}
   o.rm.taskSample[k]=free?JSON.stringify(free).slice(0,180):"ВСЕ ЗАРЕЗЕРВИРОВАНЫ";
 }
 var room=Game.rooms[rn];
 if(!room){o.rm.roomMissing=true;}
 if(room){
   o.rm.rcl=room.controller?room.controller.level:-1;
   o.rm.dw=room.controller?room.controller.ticksToDowngrade:-1;
   o.rm.storage=room.storage?(room.storage.store[RESOURCE_ENERGY]||0):-1;
   o.rm.terminal=room.terminal?(room.terminal.store[RESOURCE_ENERGY]||0):-1;
   o.rm.spawnsE=room.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="spawn"||s.structureType==="extension";}}).map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY);}).join(" ");
   o.rm.linksLive=room.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}}).map(function(s){return s.id+"="+(s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY)+"cd"+s.cooldown+"("+s.pos.x+","+s.pos.y+")";});
   o.hostiles=room.find(FIND_HOSTILE_CREEPS).length;
 }
 for(var n in Game.creeps){
   var c=Game.creeps[n];
   if(c.memory.homeRoom!==rn&&c.room.name!==rn)continue;
   o.creeps.push({
     n:c.name,role:c.memory.role||"?",home:c.memory.homeRoom||"-",room:c.room.name,
     x:c.pos.x,y:c.pos.y,
     st:c.store.getUsedCapacity()+"/"+c.store.getTotalCapacity(),
     energy:c.store[RESOURCE_ENERGY]||0,
     other:Object.keys(c.store).filter(function(k){return k!==RESOURCE_ENERGY;}).map(function(k){return k+":"+c.store[k];}).join(",")||"-",
     task:c.memory.taskType||(c.memory.task?"ЕСТЬ_БЕЗ_ТИПА":"нет"),
     working:c.memory.working===undefined?"-":c.memory.working,
     fat:c.fatigue,ttl:c.ticksToLive,body:c.body.length
   });
 }
 var M=require("task.manager");
 o.ev=M.clearTaskEvents();
}catch(e){o.err=e.message+" | "+(e.stack||"").split("\\n").slice(0,3).join(" <<< ");}
Memory.__diag=JSON.stringify(o);
})();`;

function gunzipMaybe(value) {
  if (value === null || value === undefined) return null;
  let str = value;
  if (typeof value === "object") {
    str = value.data || value.result || value;
    if (typeof str === "object") str = JSON.stringify(str);
  }
  if (typeof str !== "string") return String(str);
  const m = str.match(/^gz:([\s\S]*)$/);
  if (!m) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }
  const buf = zlib.gunzipSync(Buffer.from(m[1], "base64"));
  return JSON.parse(buf.toString("utf8"));
}

(async () => {
  console.log(`Отправляю команду диагностики в ${SHARD}/${ROOM} ...`);
  await api.console(CMD, SHARD);

  let diag = null;
  for (let attempt = 1; attempt <= 12; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const raw = await api.memory.get("__diag", SHARD);
      const parsed = gunzipMaybe(raw);
      if (parsed && parsed.t && parsed.rm) {
        diag = parsed;
        break;
      }
      console.log(`  попытка ${attempt}: пока нет данных (${JSON.stringify(parsed).slice(0, 120)})`);
    } catch (err) {
      console.log(`  попытка ${attempt}: ${err.message}`);
    }
  }

  if (!diag) return console.log("НЕ УДАЛОСЬ ПОЛУЧИТЬ ОТЧЁТ");
  console.log(`\n=== tick ${diag.t}  cpu=${diag.cpu}  врагов в комнате=${diag.hostiles}`);
  if (diag.err) console.log("!!! ОШИБКА КОМАНДЫ:", diag.err);
  console.log("Memory.rooms[room] ключи:", JSON.stringify(diag.rm.keys));
  console.log("КОНФИГ links:", diag.rm.links);
  console.log(
    `RCL=${diag.rm.rcl} dw=${diag.rm.dw} storage=${diag.rm.storage} terminal=${diag.rm.terminal}`,
  );
  console.log("спавны/расширения (E/ёмк):", diag.rm.spawnsE);
  console.log("ЛИНКИ В КОМНАТЕ:", JSON.stringify(diag.rm.linksLive));
  console.log("очереди (всего/зарезерв):", JSON.stringify(diag.rm.tasks));
  console.log("первая свободная задача:", JSON.stringify(diag.rm.taskSample));
  console.log(`\nкрипов: ${diag.creeps.length}`);
  for (const c of diag.creeps) {
    console.log(
      `  ${c.n} role=${c.role} home=${c.home} @${c.room}(${c.x},${c.y}) store=${c.st} e=${c.energy} чужое=${c.other} task=${c.task} working=${c.working} fat=${c.fat} ttl=${c.ttl} parts=${c.body}`,
    );
  }
  if (diag.ev) {
    const keys = Object.keys(diag.ev);
    console.log(
      "\nсобытия Task System за окно:",
      keys.length ? keys.map(k => k + "=" + diag.ev[k]).join(" ") : "нет",
    );
  }
})().catch(e => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
