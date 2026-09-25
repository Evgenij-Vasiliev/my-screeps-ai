const {ScreepsAPI}=require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api=new ScreepsAPI({token:resolveToken()});
const SHARD="shard3";
const SEC=Number(process.argv[2]||25);
(async()=>{
  await api.socket.connect();
  console.log("socket connected");
  let n=0;
  api.socket.subscribe("console", ev=>{
    let p; try{ p=typeof ev==="string"?JSON.parse(ev):ev; }catch(e){ console.log("RAW(не JSON):", String(ev).slice(0,300)); return; }
    const d=p&&p.data; if(!d) { console.log("PAYLOAD:", JSON.stringify(p).slice(0,300)); return; }
    const msgs=d.messages||{};
    const all=[].concat(msgs.log||[]).concat(msgs.error||[]).concat(msgs.result||[]);
    for(const raw of all){
      n++;
      const line=String(raw).replace(/&#x([0-9a-fA-F]+);/g,(m,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#(\d+);/g,(m,dd)=>String.fromCharCode(Number(dd)));
      console.log(`[${n}] ${line.slice(0,400)}`);
    }
  });
  await api.console('console.log("ЛОГ-ТЕСТ " + Game.time)', SHARD);
  await new Promise(r=>setTimeout(r,SEC*1000));
  console.log(`\nвсего строк: ${n}`);
  try{ api.socket.disconnect(); }catch(e){}
  process.exit(0);
})().catch(e=>{console.error("FATAL",e.message);process.exit(1);});
