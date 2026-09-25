"use strict";
/**
 * Задача 16 — калибровка формулы комиссии (только чтение).
 * `Game.market.calcTransactionCost(1000, 'E35S37', X)` для комнат с известными
 * координатами: проверяем, что комиссия = ceil(amount × (1 − e^(−distance/30))),
 * и какая именно «дистанция» имеется в виду.
 *
 * Запуск: node tests/live.task16.fee.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";

const api = new ScreepsAPI({ token: TOKEN });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXPR = [
  "var r={},from='E35S37';",
  "var t=['E45S37','E55S37','E65S37','E75S37','E85S37','E95S37','E23S6','E35S7','E35S27','E35S57','W11N32','W21N39'];",
  "r.rows=t.map(function(x){return [x,Game.market.calcTransactionCost(1000,from,x),Game.map.getRoomLinearDistance(from,x),Game.map.getRoomLinearDistance(from,x,true)]});",
  "r.worldSize=Game.map.getWorldSize();",
  "Memory.__t16q=r;",
].join("");

function roomCoords(name) {
  const m = /^([EW])(\d+)([NS])(\d+)$/.exec(name);
  const x = (m[1] === "E" ? 1 : -1) * Number(m[2]);
  const y = (m[3] === "S" ? -1 : 1) * Number(m[4]);
  return { x: x, y: y };
}

function chebyshev(a, b) {
  const p = roomCoords(a);
  const q = roomCoords(b);
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
}

(async () => {
  const res = await api.console(EXPR, SHARD);
  if (!res || res.ok !== 1) throw new Error("console: " + JSON.stringify(res));
  await sleep(6000);
  const data = (await api.memory.get("__t16q", SHARD)).data;
  for (let i = 0; i < data.rows.length; i++) {
    const [to, cost, linear, continuous] = data.rows[i];
    const dist = chebyshev("E35S37", to);
    const predicted = Math.ceil(1000 * (1 - Math.exp(-dist / 30)));
    console.log(
      `${to.padEnd(8)} cheb=${String(dist).padStart(3)}` +
        ` linear=${String(linear).padStart(3)} cont=${String(continuous).padStart(3)}` +
        ` cost=${String(cost).padStart(4)} formulaCheb=${String(predicted).padStart(4)}`,
    );
  }
  console.log("worldSize", data.worldSize);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
