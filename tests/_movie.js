const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3"; const RN="E35S37"; const R=JSON.stringify(RN);
const N=Number(process.argv[2]||10), P=Number(process.argv[3]||3000);
async function send(e){ const r=await api.console(e,SHARD); if(r&&r.error) console.log("  APIerr:",JSON.stringify(r.error)); }
async function read(k){
  for(let i=0;i<3;i++){
    await new Promise(r=>setTimeout(r,1400));
    try{ const raw=await api.memory.get(k,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return "null";
}
const C=`var r=Game.rooms[${R}];var L=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}});var o={t:Game.time,st:r.storage?r.storage.store[RESOURCE_ENERGY]:-1,ea:r.energyAvailable,links:L.map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"@"+s.pos.x+","+s.pos.y+"c"+s.cooldown;}).join(" ")};
var w=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!==${R})continue;var ro=c.memory.role;if(ro!=="worker"&&ro!=="linkWorker"&&ro!=="miner")continue;w.push(ro.slice(0,5)+"("+c.pos.x+","+c.pos.y+")e"+c.store[RESOURCE_ENERGY]+" "+(c.memory.taskType||"-").slice(0,9));}
o.cr=w.join(" | ");Memory.__m=JSON.stringify(o)`;
(async()=>{
 for(let i=0;i<N;i++){
   await send(C); console.log(`\n[${i+1}] `+await read("__m"));
   if(i<N-1) await new Promise(r=>setTimeout(r,P));
 }
})().catch(e=>console.error("FATAL",e.message));
