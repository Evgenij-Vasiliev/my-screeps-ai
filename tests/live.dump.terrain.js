"use strict";
/**
 * Снимок террейна набора комнат (только чтение) → /tmp/terrain.json
 * Запуск: node tests/live.dump.terrain.js
 */
const fs = require("fs");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const ROOMS = [
  "E35S37",
  "E35S38",
  "E36S37",
  "E36S38",
  "E34S37",
  "E34S38",
  "E35S36",
  "E35S39",
  "E36S36",
  "E34S36",
  "E33S37",
  "E37S37",
  "E37S38",
];

const api = new ScreepsAPI({ token: TOKEN });

async function main() {
  const out = require("/tmp/rooms.json");
  for (const room of ROOMS) {
    if (out[room] && out[room].terrain) continue;
    try {
      const terrain = await api.raw.game.roomTerrain(room, 0, SHARD);
      out[room] = { objects: [], terrain: terrain.terrain || terrain };
      console.log(`${room}: террейн получен`);
    } catch (e) {
      console.log(`${room}: ошибка ${e.message}`);
    }
  }
  fs.writeFileSync("/tmp/rooms.json", JSON.stringify(out));
  console.log("Готово, комнат в снимке:", Object.keys(out).length);
  process.exit(0);
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
