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
["__b1",`Memory.__b1=JSON.stringify(Memory.__boostMetric||"НЕТ МЕТРИКИ")`],
["__b2",`var c=Game.creeps["linkWorker_E35S37_83159634"];Memory.__b2=JSON.stringify({name:c.name,pos:c.pos.x+","+c.pos.y,store:JSON.stringify(c.store),body:c.body.map(function(p){return p.type+(p.boost?"("+p.boost+")":"");}).join(","),mem:JSON.stringify(c.memory)})`],
["__b3",`var rm=Memory.rooms["E35S37"];var L=Game.getObjectById(rm.links.storage);var cfg=rm.boostConfig;var b=Game.getObjectById("6a0074d69760eb01439b776a");Memory.__b3=JSON.stringify({linkE:L.store[RESOURCE_ENERGY]+"/"+L.store.getCapacity(RESOURCE_ENERGY),linkCd:L.cooldown,boostConfig:cfg,boostLab:b?{type:b.mineralType,amount:b.store[b.mineralType]||0,E:b.store[RESOURCE_ENERGY]||0,cd:b.cooldown}:"МЁРТВАЯ ЛАБА 6a0074d69760eb01439b776a"})`],
["__b4",`var c=Game.creeps["linkWorker_E35S37_83159634"];var rm=Memory.rooms["E35S37"];var L=Game.getObjectById(rm.links.storage);Memory.__b4=JSON.stringify({rangeToLink:c.pos.getRangeTo(L),isNear:c.pos.isNearTo(L),freeCap:c.store.getFreeCapacity(),usedCap:c.store.getUsedCapacity(),withdrawCode:c.withdraw(L,RESOURCE_ENERGY)})`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
