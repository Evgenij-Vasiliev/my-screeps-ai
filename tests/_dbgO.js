const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");
const api = new ScreepsAPI({ token: resolveToken() });
const CMD = `(function(){var o={t:Game.time},m=Memory.rooms['E35S37'];
function pick(s){var x={};for(var k in s)if(s[k]>0)x[k]=s[k];return x;}
o.bl=m.boostLab?pick(Game.getObjectById(m.boostLab).store):null;
var bo=[];for(var n in Game.creeps){var c=Game.creeps[n];var b=c.body.filter(function(p){return p.boost;});
if(b.length)bo.push(c.name.slice(-6)+':'+c.memory.role+'@'+c.room.name+':'+b.length+'x'+b[0].boost);}
o.boosted=bo;o.metric=Memory.__boostMetric||null;
var rm=m.labs&&m.labs.reactor?Game.getObjectById(m.labs.reactor):null;
o.hubXKH2O=rm?rm.store.XKH2O||0:0;
console.log('LIVE'+JSON.stringify(o));})();`;
(async () => {
  await api.socket.connect();
  api.socket.subscribe("console", (ev) => {
    let p; try { p = typeof ev === "string" ? JSON.parse(ev) : ev; } catch (e) { return; }
    const m = p && p.data && p.data.messages; if (!m) return;
    [].concat(m.log||[]).concat(m.error||[]).concat(m.result||[]).forEach((raw) => {
      const line = String(raw).replace(/&#x22;/g,'"');
      if (line.indexOf("LIVE") === 0) console.log(line.slice(4));
    });
  });
  for (let i=0;i<10;i++){ await api.console(CMD, "shard3"); await new Promise(r=>setTimeout(r,22000)); }
  api.socket.disconnect(); process.exit(0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
