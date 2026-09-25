const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3";
async function send(expr){ const r=await api.console(expr,SHARD); if(r&&r.error) console.log("  APIerr:",JSON.stringify(r.error),"len="+expr.length); return r; }
async function readKey(key){
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{ const raw=await api.memory.get(key,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return "null";
}
const RN=process.argv[2]||"E35S37";
const JOBS=[
 ["__a_src",`var r=Game.rooms["${RN}"];Memory.__a_src=r.find(FIND_SOURCES).map(function(s){return s.id+"@"+s.pos.x+","+s.pos.y+" e="+s.energy+"/"+s.energyCapacity;}).join(" | ")`],
 ["__a_min",`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.role!=="miner"&&c.memory.role!=="remoteMiner")continue;o.push(c.name+" role="+c.memory.role+" @"+c.room.name+"("+c.pos.x+","+c.pos.y+") spot="+JSON.stringify(c.memory.spot)+" srcId="+c.memory.sourceId+" linkId="+c.memory.linkId+" store="+c.store.getUsedCapacity());}Memory.__a_min=o.join("\\n")`],
 ["__a_sp",`var r=Game.rooms["${RN}"];Memory.__a_sp=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="spawn";}}).map(function(s){return s.name+"@"+s.pos.x+","+s.pos.y+" E="+(s.store[RESOURCE_ENERGY]||0)+" spawn="+(s.spawning?s.spawning.name+" rem="+s.spawning.remainingTime:"-");}).join(" | ")`],
 ["__a_me",`var rm=Memory.rooms["${RN}"];Memory.__a_me=JSON.stringify({economyMode:rm.economyMode,_lastStorageEnergy:rm._lastStorageEnergy,diagnostics:rm.diagnostics,minerSpots:rm.minerSpots,underAttack:rm.underAttack,hasSites:rm.hasSites,energyTargets:rm.energyTargets})`],
 ["__a_cpu",`var p=Memory.cpuStats&&Memory.cpuStats.profile;Memory.__a_cpu=p?JSON.stringify(p.history?p.history.slice(-3):p):"нет"`],
];
(async()=>{
  for(const [k,expr] of JOBS){ console.log("send "+k+" len="+expr.length); await send(expr); }
  for(const [k] of JOBS){ console.log("\n=== "+k+"\n"+await readKey(k)); }
})().catch(e=>console.error("FATAL",e.message));
