const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3"; const R='"E35S37"';
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
(async()=>{
  await send(`Memory.labBoostOff=true;Memory.__f0="ФЛАГ ПОСТАВЛЕН "+Game.time`);
  console.log("флаг:", await read("__f0"));
  const SNAP=`var r=Game.rooms[${R}];var L=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}});var c=Game.creeps["linkWorker_E35S37_83159634"];var o={t:Game.time,link:(function(){for(var i=0;i<L.length;i++){if(L[i].pos.x===18&&L[i].pos.y===6)return (L[i].store[RESOURCE_ENERGY]||0)+"/800";}return "?";})(),lw:c?(c.pos.x+","+c.pos.y+" e"+c.store[RESOURCE_ENERGY]+" mem="+JSON.stringify(c.memory).slice(0,120)):"МЁРТВ",st:r.storage.store[RESOURCE_ENERGY],off:!!Memory.labBoostOff};Memory.__f1=JSON.stringify(o)`;
  for(let i=0;i<8;i++){ await send(SNAP); console.log(`[${i+1}] `+await read("__f1")); await new Promise(r=>setTimeout(r,3000)); }
})().catch(e=>console.error("FATAL",e.message));
