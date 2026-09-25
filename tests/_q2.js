const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3"; const RN="E35S37"; const R=JSON.stringify(RN);
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
["__t1",`var q=Memory.rooms[${R}].tasks.fillSpawnsExtensions;var c={};for(var i=0;i<q.length;i++){var o=Game.getObjectById(q[i].targetId);var k=o?o.structureType:"МЁРТВЫЙ";c[k]=(c[k]||0)+1;}Memory.__t1=JSON.stringify(c)+" first3="+q.slice(0,3).map(function(x){var o=Game.getObjectById(x.targetId);return x.taskId+":"+(o?o.structureType+"E"+(o.store[RESOURCE_ENERGY]||0):"DEAD");}).join(",")`],
["__t2",`var S=require("scanner");var c=S.getStructureCache(Game.rooms[${R}]);Memory.__t2=JSON.stringify({spawnIds:c.spawnIds,ext:c.extensionIds?c.extensionIds.length:-1,tower:c.towerIds?c.towerIds.length:-1,link:c.linkIds?c.linkIds.length:-1})`],
["__t3",`var r=Game.rooms[${R}];Memory.__t3=JSON.stringify({findSpawns:r.find(FIND_MY_SPAWNS).map(function(s){return s.name+"@"+s.pos.x+","+s.pos.y+" id="+s.id+" E="+(s.store[RESOURCE_ENERGY]||0)}),spawnMemKeys:Object.keys(Memory.spawns||{}).length})`],
["__t4",`var r=Game.rooms[${R}];Memory.__t4=JSON.stringify({storage:r.storage?r.storage.id+"@"+r.storage.pos.x+","+r.storage.pos.y:"НЕТ",terminal:r.terminal?r.terminal.id+"@"+r.terminal.pos.x+","+r.terminal.pos.y:"НЕТ"})`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
