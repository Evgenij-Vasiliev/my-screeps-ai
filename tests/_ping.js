const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3"; const RN="E35S37";
async function send(expr){ const r=await api.console(expr,SHARD); if(r&&r.error) console.log("APIerr:",JSON.stringify(r.error)); }
async function readKey(key){
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,2500));
    try{ const raw=await api.memory.get(key,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return null;
}
const jobs=[];
// роли крипов комнаты (компактно) + task + store
jobs.push(["__c1",`(function(){try{var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!=="${RN}"&&c.room.name!=="${RN}")continue;o.push([c.name,c.memory.role||"?",c.room.name,c.pos.x,c.pos.y,c.store.getUsedCapacity(),c.store[RESOURCE_ENERGY]||0,c.memory.taskType||(c.memory.task?"TASK_NO_TYPE":"-"),c.ticksToLive,c.fatigue].join("|"));}Memory.__c1=o.join("\\n");}catch(e){Memory.__c1="ERR "+e.message;}})()`]);
// линки + спавны
jobs.push(["__c2",`(function(){try{var r=Game.rooms["${RN}"];var L=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}});var o=[];for(var i=0;i<L.length;i++){var s=L[i];o.push(s.id+"="+(s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY)+"cd"+s.cooldown+"@"+s.pos.x+","+s.pos.y);}Memory.__c2=o.join("\\n");}catch(e){Memory.__c2="ERR "+e.message;}})()`]);
// storage/terminal/башни
jobs.push(["__c3",`(function(){try{var r=Game.rooms["${RN}"];var T=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="tower";}});var o={st:r.storage?r.storage.store[RESOURCE_ENERGY]:-1,stFree:r.storage?r.storage.store.getFreeCapacity():-1,te:r.terminal?r.terminal.store[RESOURCE_ENERGY]:-1,dw:r.controller?r.controller.ticksToDowngrade:-1,host:r.find(FIND_HOSTILE_CREEPS).length,tw:T.map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY);}).join(",")};Memory.__c3=JSON.stringify(o);}catch(e){Memory.__c3="ERR "+e.message;}})()`]);
(async()=>{
  for(const [,expr] of jobs) await send(expr);
  for(const [k] of jobs) console.log("\n=== "+k+"\n"+await readKey(k));
})().catch(e=>console.error("FATAL",e.message));
