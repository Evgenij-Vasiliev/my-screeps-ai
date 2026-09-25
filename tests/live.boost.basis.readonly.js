"use strict";
/**
 * ЖИВОЙ ФАКТ-БАЗИС ПОД ТЗ «boosts для рабочих комнат» — ТОЛЬКО ЧТЕНИЕ.
 *
 * Ничего не пишет ни в Memory, ни в игру: команды в консоль шарда печатают JSON
 * через console.log, результат забирается по websocket-подписке 'console'
 * (тот же приём, что в tests/live.lab.stocks.readonly.js).
 *
 * Зачем: расчёт бустов обязан опираться на движковые величины и фактическое
 * состояние shard3, а не на память. Скрипт печатает:
 *   BASIS_ENG    — движковые константы (LAB_BOOST_MINERAL/ENERGY,
 *                  LAB_REACTION_AMOUNT, HARVEST_POWER, HARVEST_MINERAL_POWER,
 *                  ENERGY_REGEN_TIME, MINERAL_REGEN_TIME, REACTION_TIME
 *                  и множители BOOSTS для XKH2O/XZHO2/XUHO2/XLHO2);
 *   BASIS_MIN    — минерал и extractor каждой owned-комнаты (в т.ч. cooldown);
 *   BASIS_CREEPS — фактический состав крипов по ролям и комнатам
 *                  (число, ticksToLive, cooldown);
 *   BASIS_STOCK  — бусты/X в storage, terminal, тройках и буст-лабе;
 *   BASIS_METRIC — Memory.__boostMetric / labBoostOff.
 *
 * Запуск: node tests/live.boost.basis.readonly.js
 * Токен: SCREEPS_TOKEN или встроенный (как в остальных live-тестах проекта).
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const api = new ScreepsAPI({ token: TOKEN });

const ROOMS = ["E35S37", "E35S39", "E36S38", "E37S37", "E37S38"];
const TAGS = ["BASIS_ENG", "BASIS_MIN", "BASIS_CREEPS", "BASIS_STOCK", "BASIS_METRIC", "BASIS_MARKET"];

// Список ресурсов, интересных ТЗ (готовые бусты + X + их реагенты).
const RES = [
  "X", "XKH2O", "XZHO2", "XUHO2", "XLHO2", "XKHO2",
  "KH2O", "KHO2", "ZHO2", "UHO2", "LHO2", "OH", "UO", "ZO", "LO", "KO", "KH",
];

const CMDS = [
  // 1. Движковые константы и множители бустов.
  `(function(){var o={R:{},B:{}};
['XKH2O','XZHO2','XUHO2','XLHO2','XKHO2','KH2O','KHO2','ZHO2','UHO2','LHO2','OH','UO','ZO','LO','KO','KH','X'].forEach(function(k){o.R[k]=REACTION_TIME[k];});
o.B={carry:BOOSTS.carry.XKH2O?BOOSTS.carry.XKH2O.capacity:null,
mfat:BOOSTS.move.XZHO2?BOOSTS.move.XZHO2.fatigue:null,
workh:BOOSTS.work.XUHO2?BOOSTS.work.XUHO2.harvest:null,
heal:BOOSTS.heal.XLHO2?BOOSTS.heal.XLHO2.heal:null};
o.F={bp:LAB_BOOST_MINERAL,be:LAB_BOOST_ENERGY,ra:LAB_REACTION_AMOUNT,
hp:HARVEST_POWER,hmp:HARVEST_MINERAL_POWER,ert:ENERGY_REGEN_TIME,mrt:MINERAL_REGEN_TIME,
lc:LAB_COOLDOWN,tick:Game.time,shard:Game.shard.name};
console.log('BASIS_ENG'+JSON.stringify(o));})();`,

  // 2. Минерал по комнатам. ВАЖНО: room.mineral в консоли шарда отдаёт
  // undefined даже при живом месторождении (проверено 20.09.2026: K 44 835 в
  // E35S37 при q.mineral === undefined), поэтому только FIND_MINERALS.
  `(function(){var o={};
${JSON.stringify(ROOMS)}.forEach(function(n){var q=Game.rooms[n];if(!q){o[n]=null;return;}
var m=q.find(FIND_MINERALS);
o[n]=m.length?m.map(function(x){return x.mineralType+':'+x.mineralAmount;}).join(','):'none';});
console.log('BASIS_MIN'+JSON.stringify(o));})();`,

  // 3. Фактический состав крипов: роль@комната, число, ttl, cooldown.
  `(function(){var g={};for(var n in Game.creeps){var c=Game.creeps[n];if(!c.my)continue;
var k=c.memory.role+'@'+(c.memory.homeRoom||c.room.name);
var e=g[k]||(g[k]={n:0,ttl:[],cd:[],w:0});
e.n++;if(c.ticksToLive!==undefined)e.ttl.push(c.ticksToLive);
if(c.cooldown>0)e.cd.push(c.cooldown);
for(var i=0;i<c.body.length;i++)if(c.body[i].type==='work')e.w++;}
var r={};for(var k in g){var e=g[k];
r[k]={n:e.n,w:e.w,ttlMin:Math.min.apply(null,e.ttl),ttlMax:Math.max.apply(null,e.ttl),
cdMax:e.cd.length?Math.max.apply(null,e.cd):0};}
console.log('BASIS_CREEPS'+JSON.stringify(r));})();`,

  // 4. Запасы бустов/X в storage, terminal, тройках и буст-лабе.
  `(function(){var B=${JSON.stringify(RES)};
function pick(o){var r={};if(!o)return r;for(var i=0;i<B.length;i++)if(o.store[B[i]]>0)r[B[i]]=o.store[B[i]];return r;}
var o={};${JSON.stringify(ROOMS)}.forEach(function(n){var q=Game.rooms[n];if(!q)return;
var m=Memory.rooms[n]||{},e={st:pick(q.storage),te:pick(q.terminal),
bl:m.boostLab?(function(L){return L?pick(L):'no-lab';})(Game.getObjectById(m.boostLab)):null};
['labs','labs2','labs3'].forEach(function(k){var c=m[k];if(!c)return;var x={};
['lab1','lab2','reactor'].forEach(function(sl){var L=c[sl]?Game.getObjectById(c[sl]):null;x[sl]=L?pick(L):null;});
e[k]=x;});o[n]=e;});
console.log('BASIS_STOCK'+JSON.stringify(o));})();`,

  // 5. Метрики бустирования и флаги.
  `console.log('BASIS_METRIC'+JSON.stringify({m:Memory.__boostMetric||null,
off:Memory.labBoostOff||null,alert:Memory.attackAlert||null,
bc:(Memory.rooms&&Memory.rooms.E35S37?Memory.rooms.E35S37.boostConfig:null)||null}));`,

  // 6. Рынок: кредиты и цена X (нужно, чтобы понять, потянет ли империя
  // возросший расход катализатора: каждая финальная реакция берёт 5 X).
  `(function(){var o={credits:Game.market.credits,orders:(Game.market.getAllOrders?null:'n/a'),
xDeal:Memory.__xDeal||null};
console.log('BASIS_MARKET'+JSON.stringify(o));})();`,
];

(async () => {
  const lines = {};
  await api.socket.connect();
  api.socket.subscribe("console", (event) => {
    let payload;
    try {
      payload = typeof event === "string" ? JSON.parse(event) : event;
    } catch (err) {
      void err;
      return;
    }
    const msgs = payload && payload.data && payload.data.messages;
    if (!msgs) return;
    const all = []
      .concat(msgs.log || [])
      .concat(msgs.error || [])
      .concat(msgs.result || []);
    for (const raw of all) {
      const line = String(raw).replace(/&#x22;/g, '"').replace(/&#x3E;/g, ">");
      for (const tag of TAGS) {
        if (line.indexOf(tag) === 0) lines[tag] = line.slice(tag.length);
      }
    }
  });

  for (const expr of CMDS) {
    const res = await api.console(expr, SHARD);
    if (!res || res.ok !== 1) {
      console.error("console error:", JSON.stringify(res).slice(0, 200));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    api.socket.disconnect();
  } catch (err) {
    void err;
  }

  const out = {};
  for (const tag of Object.keys(lines)) {
    try {
      out[tag] = JSON.parse(lines[tag]);
    } catch (err) {
      void err;
      out[tag] = lines[tag];
    }
  }
  console.log(JSON.stringify(out, null, 1));
  const missing = TAGS.filter((t) => !(t in out));
  if (missing.length) {
    console.error("Не получены секции: " + missing.join(","));
    process.exit(2);
  }
})().catch((e) => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
