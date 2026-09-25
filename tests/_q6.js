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
["__z1",`var raw=RawMemory.get();Memory.__z1=JSON.stringify({memBytes:raw.length,memLimit:2097152,pct:Math.round(raw.length/2097152*1000)/10,creepsInGame:Object.keys(Game.creeps).length,creepsInMem:Object.keys(Memory.creeps||{}).length,tick:Game.time})`],
["__z2",`var o=[];for(var n in Game.creeps){if(n.indexOf("linkWorker")<0&&n.indexOf("mineralMiner")<0)continue;var c=Game.creeps[n];o.push(n+" @"+c.room.name+"("+c.pos.x+","+c.pos.y+") ttl="+c.ticksToLive+" hits="+c.hits+" spawning="+!!c.spawning+" mem="+JSON.stringify(c.memory)+" inMemTable="+!!((Memory.creeps||{})[n]));}Memory.__z2=o.length?o.join("\\n"):"НЕТ ТАКИХ КРИПОВ В Game.creeps"`],
["__z3",`var o=[];for(var n in Memory.creeps){if(n.indexOf("linkWorker")<0&&n.indexOf("mineralMiner")<0)continue;o.push(n+" mem="+JSON.stringify(Memory.creeps[n])+" alive="+!!Game.creeps[n]);}Memory.__z3=o.length?o.join("\\n"):"НЕТ ТАКИХ В Memory.creeps"`],
["__z4",`var m=Memory.rooms["E35S37"]||{};var t={};for(var k in m){var v=m[k];var s=JSON.stringify(v);t[k]=s.length;}Memory.__z4=JSON.stringify(t)`],
["__z5",`var t={};for(var rn in Memory.rooms){var s=JSON.stringify(Memory.rooms[rn]);t[rn]=s.length;}Memory.__z5=JSON.stringify(t)+" | всего крипов:"+Object.keys(Memory.creeps||{}).length`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
