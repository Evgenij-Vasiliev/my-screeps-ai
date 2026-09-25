const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3";
async function send(e){ const r=await api.console(e,SHARD); if(r&&r.error) console.log("  APIerr:",JSON.stringify(r.error)); }
async function read(k){
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,1500));
    try{ const raw=await api.memory.get(k,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return "null";
}
// ЭКСПЕРИМЕНТ: сколько частей реально бустит движок при нехватке минерала/энергии
const E=`(function(){var c=Game.creeps["linkWorker_E35S37_83159634"];var lab=Game.getObjectById("6a0074d69760eb01439b776a");
function bp(){var n=0;for(var i=0;i<c.body.length;i++){if(c.body[i].boost)n++;}return n;}
var o={labMineral:lab.mineralType,labAmount:lab.store[lab.mineralType]||0,labEnergy:lab.store[RESOURCE_ENERGY]||0,boostedBefore:bp()};
o.code_2=lab.boostCreep(c,2); o.boostedAfter2=bp();
o.labAmount2=lab.store[lab.mineralType]||0; o.labEnergy2=lab.store[RESOURCE_ENERGY]||0;
o.code_2b=lab.boostCreep(c,2); o.boostedAfter2b=bp();
o.labAmount3=lab.store[lab.mineralType]||0; o.labEnergy3=lab.store[RESOURCE_ENERGY]||0;
Memory.__exp=JSON.stringify(o);})()`;
(async()=>{ await send(E); console.log(await read("__exp")); })().catch(e=>console.error("FATAL",e.message));
