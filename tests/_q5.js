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
["__h1",`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.role!=="remoteHauler"&&c.memory.role!=="remoteMiner")continue;o.push(c.name+" role="+c.memory.role+" @"+c.room.name+"("+c.pos.x+","+c.pos.y+") mem="+JSON.stringify(c.memory));}Memory.__h1=o.join("\\n\\n")`],
["__h2",`var t=require("remote.targets");Memory.__h2=JSON.stringify(Object.keys(t))`],
["__h3",`var o={};["E35S38","E36S37"].forEach(function(rn){var r=Game.rooms[rn];o[rn]=r?r.find(FIND_STRUCTURES,{filter:function(s){return s.structureType==="container"||s.structureType==="road";}}).length:"нет обзора";});Memory.__h3=JSON.stringify(o)`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
