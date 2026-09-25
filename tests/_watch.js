const zlib=require("zlib");
const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3"; const RN=process.argv[2]||"E35S37";
const SAMPLES=Number(process.argv[3]||6);
async function send(expr){ const r=await api.console(expr,SHARD); if(r&&r.error) console.log("APIerr:",JSON.stringify(r.error)); return r; }
async function readKey(key){
  for(let i=0;i<4;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{ const raw=await api.memory.get(key,SHARD);
      if(raw&&raw.data!==undefined){ const s=raw.data; return typeof s==="string"?(s.startsWith("gz:")?zlib.gunzipSync(Buffer.from(s.slice(3),"base64")).toString():s):JSON.stringify(s); }
    }catch(e){}
  }
  return null;
}
const SNAP=`(function(){try{var r=Game.rooms["${RN}"];var o={t:Game.time,cpu:Math.round(Game.cpu.getUsed()*100)/100};
o.creeps={};for(var n in Game.creeps){var c=Game.creeps[n];if(c.memory.homeRoom!=="${RN}"&&c.room.name!=="${RN}")continue;var k=(c.memory.role||"?")+"_"+(c.room.name==="${RN}"?"home":"out");o.creeps[k]=(o.creeps[k]||0)+1;}
o.w=[];for(var n2 in Game.creeps){var c2=Game.creeps[n2];if(c2.memory.role!=="worker"&&c2.memory.role!=="linkWorker"&&c2.memory.role!=="miner")continue;if(c2.memory.homeRoom!=="${RN}")continue;o.w.push([c2.name.split("_")[0],c2.pos.x,c2.pos.y,c2.store.getUsedCapacity(),c2.store[RESOURCE_ENERGY]||0,c2.memory.taskType||"-",c2.memory.working===undefined?"-":c2.memory.working].join(":"));}
var L=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="link";}});o.links=L.map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"/"+s.store.getCapacity(RESOURCE_ENERGY)+"@"+s.pos.x+","+s.pos.y;}).join(" ");
var SP=r.find(FIND_MY_STRUCTURES,{filter:function(s){return s.structureType==="spawn";}});o.spawn=SP.map(function(s){return (s.store[RESOURCE_ENERGY]||0)+"|"+(s.spawning?s.spawning.name+"("+ (s.spawning.remainingTime)+")":"-");}).join(" ");
o.st=r.storage?r.storage.store[RESOURCE_ENERGY]:-1;
o.q={};var tk=(Memory.rooms["${RN}"]||{}).tasks||{};for(var kk in tk){if(tk[kk].length)o.q[kk]=tk[kk].length;}
var M=require("task.manager");o.ev=M.clearTaskEvents();
Memory.__w=JSON.stringify(o);}catch(e){Memory.__w="ERR "+e.message+" "+(e.stack||"").split("\\n")[1];}})()`;
(async()=>{
  for(let i=0;i<SAMPLES;i++){
    await send(SNAP);
    console.log(`\n--- замер ${i+1}: ${await readKey("__w")}`);
    if(i<SAMPLES-1) await new Promise(r=>setTimeout(r,6000));
  }
  // Подсистемы — из profile.blocks, роли — из roles.roles (opt-in
  // Memory.cpuMonitorRoles; если выключен, roles будет null).
  await send(`Memory.__cpu=JSON.stringify({avg:Memory.cpuStats&&Memory.cpuStats.average,blocks:(function(){var c=Memory.cpuStats||{},p=c.profile;if(!p||!p.blocks)return null;var o={};for(var n in p.blocks){if(p.blocks[n].count>0)o[n]=Math.round(p.blocks[n].sum/p.samples*1000)/1000;}return o;})(),roles:(function(){var r=(Memory.cpuStats&&Memory.cpuStats.roles)||null;if(!r||!r.roles||!r.samples)return null;var o={};for(var n in r.roles){if(r.roles[n].count>0)o[n]=Math.round(r.roles[n].sum/r.samples*1000)/1000;}return o;})()})`);
  console.log("\n=== CPU:", await readKey("__cpu"));
})().catch(e=>console.error("FATAL",e.message));
