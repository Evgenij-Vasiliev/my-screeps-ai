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
["__u1",`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!==${R})continue;if(c.memory.role!=="worker")continue;var t=c.memory.task;var tg=t?Game.getObjectById(t.targetId):null;o.push(c.name+" | task="+(t?t.taskId+" type="+t.type+" src="+t.sourceId+" tgt="+t.targetId:"НЕТ")+" | target="+(tg?tg.structureType+"@"+tg.pos.x+","+tg.pos.y+" E="+(tg.store[RESOURCE_ENERGY]||0)+"/"+tg.store.getCapacity(RESOURCE_ENERGY):"МЁРТВ")+" | creepE="+c.store[RESOURCE_ENERGY]+" | dist="+(tg?c.pos.getRangeTo(tg):-1)+" | ttl="+c.ticksToLive);}Memory.__u1=o.join("\\n")`],
["__u2",`var o=[];for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!==${R})continue;o.push(c.name.split("_")[0].slice(0,9)+" ttl="+c.ticksToLive+" role="+c.memory.role+" spot="+(c.memory.spot?"да":"-")+" task="+(c.memory.taskType||"-"));}Memory.__u2=o.join("\\n")`],
["__u3",`var sp=require("spawn.manager");var o={};try{for(var k in sp)o[k]=typeof sp[k];}catch(e){o.err=e.message}Memory.__u3=JSON.stringify(o)`],
];
(async()=>{ for(const[,e] of J) await send(e); for(const[k] of J) console.log("\n=== "+k+"\n"+await read(k)); })().catch(e=>console.error("FATAL",e.message));
