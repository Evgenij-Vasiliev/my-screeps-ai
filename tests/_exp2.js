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
const E=`(function(){var c=Game.creeps["labWorker_E35S37_83159948"];var lab=Game.getObjectById("6a0074d69760eb01439b776a");
function bp(){var n=0;for(var i=0;i<c.body.length;i++){if(c.body[i].boost)n++;}return n;}
var o={pos:c.pos.x+","+c.pos.y,range:c.pos.getRangeTo(lab),parts:c.body.length,boostedBefore:bp(),m0:lab.store[lab.mineralType]||0,e0:lab.store[RESOURCE_ENERGY]||0};
o.code_4=lab.boostCreep(c,4); o.boostedAfter4=bp(); o.m4=lab.store[lab.mineralType]||0; o.e4=lab.store[RESOURCE_ENERGY]||0;
o.code_3=lab.boostCreep(c,3); o.boostedAfter3=bp(); o.m3=lab.store[lab.mineralType]||0; o.e3=lab.store[RESOURCE_ENERGY]||0;
Memory.__exp2=JSON.stringify(o);})()`;
(async()=>{ await send(E); console.log(await read("__exp2")); })().catch(e=>console.error("FATAL",e.message));
