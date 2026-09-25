const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3"; const RN=process.argv[2]||"E35S37"; const N=Number(process.argv[3]||8); const PAUSE=Number(process.argv[4]||4000);
const R=JSON.stringify(RN);
async function send(e){ const r=await api.console(e,SHARD); if(r&&r.error) console.log("  APIerr:",JSON.stringify(r.error)); }
async function read(k){
  for(let i=0;i<3;i++){
    await new Promise(r=>setTimeout(r,1500));
    try{ const raw=await api.memory.get(k,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return "null";
}
const C1=`var r=Game.rooms[${R}];Memory.__s1=JSON.stringify({t:Game.time,st:r.storage?r.storage.store[RESOURCE_ENERGY]:-1,ea:r.energyAvailable,ecap:r.energyCapacityAvailable})`;
const C2=`var r=Game.rooms[${R}];Memory.__s2=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="spawn";}}).map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"|"+(s.spawning?s.spawning.name.slice(0,14)+":"+s.spawning.remainingTime:"-");}).join("  ")`;
const C3=`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!==${R})continue;var ro=c.memory.role;if(ro!=="worker"&&ro!=="linkWorker")continue;o.push(c.name.split("_")[0].slice(0,6)+"("+c.pos.x+","+c.pos.y+")e"+c.store[RESOURCE_ENERGY]+" "+(c.memory.taskType||"-").slice(0,10)+" w"+(c.memory.working===true?1:0));}Memory.__s3=o.join(" | ")`;
const C4=`var M=require("task.manager");var t=(Memory.rooms[${R}]||{}).tasks||{};var o={};for(var k in t){if(t[k].length)o[k]=t[k].length;}Memory.__s4=JSON.stringify({q:o,ev:M.clearTaskEvents(),has:M.hasAvailableTask(${R})})`;
const C5=`var r=Game.rooms[${R}];var E=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="extension";}});var sum=0,nf=0;for(var i=0;i<E.length;i++){var e=E[i].store[RESOURCE_ENERGY]||0;sum+=e;if(e<E[i].store.getCapacity(RESOURCE_ENERGY))nf++;}Memory.__s5=E.length+" расш, сумма="+sum+", неполных="+nf`;
(async()=>{
  for(let i=0;i<N;i++){
    await send(C1); await send(C2); await send(C3); await send(C4); await send(C5);
    const [a,b,c,d,e]=[await read("__s1"),await read("__s2"),await read("__s3"),await read("__s4"),await read("__s5")];
    console.log(`\n──── замер ${i+1}`);
    console.log("  окно:", a);
    console.log("  спавны:", b);
    console.log("  расш:", e);
    console.log("  воркеры:", c);
    console.log("  очереди+события:", d);
    if(i<N-1) await new Promise(r=>setTimeout(r,PAUSE));
  }
})().catch(e=>console.error("FATAL",e.message));
