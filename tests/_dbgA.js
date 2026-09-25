const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api = new ScreepsAPI({ token: resolveToken() });
const CMD = `(function(){var o={t:Game.time},m=Memory.rooms['E35S37'];
function pick(s){var x={};for(var k in s)if(s[k]>0)x[k]=s[k];return x;}
o.bl=m.boostLab?pick(Game.getObjectById(m.boostLab).store):null;
o.metric=Memory.__boostMetric||null;
var bo=[];for(var n in Game.creeps){var c=Game.creeps[n];var nb=c.body.filter(function(p){return p.boost;}).length;
if(nb>0)bo.push(c.name+':'+c.memory.role+':'+nb+'@'+c.room.name+':'+c.body.filter(function(p){return p.boost;})[0].boost);}
o.boosted=bo;
var lw=null;for(var n2 in Game.creeps){var c2=Game.creeps[n2];if(c2.memory.role==='labWorker'&&c2.room.name==='E35S37')lw={task:c2.memory.task||null,res:c2.memory.resource||null};}
o.labWorker=lw;
console.log('DBG7'+JSON.stringify(o));})();`;
(async () => {
  await api.socket.connect();
  api.socket.subscribe("console", (ev) => {
    let p; try { p = typeof ev === "string" ? JSON.parse(ev) : ev; } catch (e) { return; }
    const m = p && p.data && p.data.messages; if (!m) return;
    [].concat(m.log||[]).concat(m.error||[]).concat(m.result||[]).forEach((raw) => {
      const line = String(raw).replace(/&#x22;/g,'"');
      if (line.indexOf("DBG7") === 0) console.log(line.slice(4));
    });
  });
  for (let i=0;i<5;i++){ await api.console(CMD, "shard3"); await new Promise(r=>setTimeout(r,50000)); }
  api.socket.disconnect(); process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
