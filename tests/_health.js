const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3";
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
const C1=`var r=Game.rooms["E35S37"];var L=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}});var o=[];for(var i=0;i<L.length;i++)o.push(L[i].pos.x+","+L[i].pos.y+"="+(L[i].store[RESOURCE_ENERGY]||0));Memory.__k1=o.join(" ")+" | склад="+r.storage.store[RESOURCE_ENERGY]+" | флаг="+!!Memory.labBoostOff+" | dw="+r.controller.ticksToDowngrade`;
const C2=`var r=Game.rooms["E35S37"];var S=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="spawn";}});Memory.__k2=S.map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"/"+(s.spawning?s.spawning.name.slice(0,22)+":"+s.spawning.remainingTime:"-");}).join("   ")`;
const C3=`var w=[];var cnt=0;for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!=="E35S37")continue;cnt++;var ro=c.memory.role;if(ro!=="worker"&&ro!=="linkWorker")continue;w.push(ro.slice(0,6)+"("+c.pos.x+","+c.pos.y+")e"+c.store[RESOURCE_ENERGY]+" "+(c.memory.taskType||"-").slice(0,9));}Memory.__k3="крипов="+cnt+" | "+w.join(" | ")`;
const C4=`var r=Game.rooms["E35S37"];var E=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="extension";}});var se=0,nf=0;for(var j=0;j<E.length;j++){var v=E[j].store[RESOURCE_ENERGY]||0;se+=v;if(v<E[j].store.getCapacity(RESOURCE_ENERGY))nf++;}Memory.__k4="расширения сумма="+se+" неполных="+nf+" | энергия комнаты="+r.energyAvailable+"/"+r.energyCapacityAvailable`;
(async()=>{ for(let i=0;i<4;i++){ await send(C1);await send(C2);await send(C3);await send(C4);
  console.log(`\n[${i+1}] ${await read("__k1")}\n    спавны: ${await read("__k2")}\n    ${await read("__k3")}\n    ${await read("__k4")}`);
  await new Promise(r=>setTimeout(r,9000)); } })().catch(e=>console.error("FATAL",e.message));
