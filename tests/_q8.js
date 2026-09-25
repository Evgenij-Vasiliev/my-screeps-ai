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
const J=[
["__s_x",`var r=Game.rooms["E35S37"];var o={storage_XKH2O:r.storage?r.storage.store["XKH2O"]||0:-1,terminal_XKH2O:r.terminal?r.terminal.store["XKH2O"]||0:-1,labs:{}};var L=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="lab";}});for(var i=0;i<L.length;i++){o.labs[L[i].id+"@"+L[i].pos.x+","+L[i].pos.y]=L[i].mineralType+":"+(L[i].store[L[i].mineralType]||0)+"|E"+(L[i].store[RESOURCE_ENERGY]||0);}Memory.__s_x=JSON.stringify(o)`],
["__s_lw",`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.role!=="labWorker")continue;o.push(c.name+" @"+c.room.name+"("+c.pos.x+","+c.pos.y+") store="+JSON.stringify(c.store)+" mem="+JSON.stringify(c.memory).slice(0,200));}Memory.__s_lw=o.join("\\n")||"нет labWorker"`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
