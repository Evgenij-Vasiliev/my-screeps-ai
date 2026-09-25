const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3";
async function send(e){ const r=await api.console(e,SHARD); if(r&&r.error) console.log("  APIerr:",JSON.stringify(r.error)); }
async function read(k){
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,1800));
    try{ const raw=await api.memory.get(k,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return "null";
}
const J=[
["__r1",`var o={};["E35S38","E36S37","E36S38"].forEach(function(rn){var r=Game.rooms[rn];if(!r){o[rn]="НЕТ ОБЗОРА";return;}o[rn]={con:r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType==="container";}}).map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY)+"@"+s.pos.x+","+s.pos.y;}),link:r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}}).map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY)+"@"+s.pos.x+","+s.pos.y+"cd"+s.cooldown;}),src:r.find(FIND_SOURCES).map(function(s){return s.id+"@"+s.pos.x+","+s.pos.y+"="+s.energy;})};});Memory.__r1=JSON.stringify(o)`],
["__r2",`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];var ro=c.memory.role;if(ro!=="remoteMiner"&&ro!=="remoteHauler"&&ro!=="reserver"&&ro!=="miner")continue;o.push(c.name+" role="+ro+" @"+c.room.name+"("+c.pos.x+","+c.pos.y+") store="+c.store.getUsedCapacity()+" tgt="+(c.memory.targetRoom||"-")+" handoff="+(c.memory.handoffFrom||"-")+" ttl="+c.ticksToLive);}Memory.__r2=o.join("\\n")`],
["__r3",`var o={};["E35S38","E36S37"].forEach(function(rn){var m=Memory.rooms[rn]||{};var k={};for(var kk in m){if(kk==="tasks"){k.tasks={};for(var t in m.tasks){if(m.tasks[t].length)k.tasks[t]=m.tasks[t].length;}}else k[kk]=JSON.stringify(m[kk]).slice(0,150);}o[rn]=k;});Memory.__r3=JSON.stringify(o)`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
