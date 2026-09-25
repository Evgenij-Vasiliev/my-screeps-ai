const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3";
async function send(expr){ const r=await api.console(expr,SHARD); if(r&&r.error) console.log("APIerr:",JSON.stringify(r.error),"| len:",expr.length); }
async function readKey(key){
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{ const raw=await api.memory.get(key,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return "null";
}
const cmds=process.argv.slice(2);
(async()=>{ for(const k of cmds){ /* noop */ } })();
module.exports={send,readKey};
