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
const E=`(function(){var c=Game.creeps["labWorker_E35S37_83159948"];var lc=Game.creeps["linkWorker_E35S37_83159634"];var lab=Game.getObjectById("6a0074d69760eb01439b776a");
function desc(x){return x?x.body.map(function(p){return p.type+(p.boost?"("+p.boost+")":"");}).join(","):"МЁРТВ";}
Memory.__exp3=JSON.stringify({t:Game.time,labAmount:lab.store[lab.mineralType]||0,labE:lab.store[RESOURCE_ENERGY]||0,labType:lab.mineralType,labWorker:desc(c),linkWorker:desc(lc)});})()`;
(async()=>{ await send(E); console.log("после эксперимента:\n"+await read("__exp3")); })().catch(e=>console.error("FATAL",e.message));
