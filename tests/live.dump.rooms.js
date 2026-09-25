"use strict";
/**
 * Снимок комнат (только чтение): террейн + объекты. Пишет JSON в /tmp/rooms.json.
 * Запуск: node tests/live.dump.rooms.js
 */
const fs = require("fs");
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const ROOMS = ["E35S37", "E35S38", "E36S37"];

const api = new ScreepsAPI({ token: TOKEN });

async function main() {
  const out = {};
  for (const room of ROOMS) {
    const objs = await api.raw.game.roomObjects(room, SHARD);
    const terrain = await api.raw.game.roomTerrain(room, 0, SHARD);
    out[room] = {
      objects: (objs.objects || objs).map(o => ({
        type: o.type,
        x: o.x,
        y: o.y,
        name: o.name,
        user: o.user,
        structureType: o.structureType,
        store: o.store,
        hits: o.hits,
        energy: o.energy,
        mineralAmount: o.mineralAmount,
      })),
      terrain: terrain.terrain || terrain,
    };
    console.log(
      `${room}: объектов ${out[room].objects.length}, террейн ${String(out[room].terrain).length} симв.`,
    );
  }
  fs.writeFileSync("/tmp/rooms.json", JSON.stringify(out));
  console.log("Сохранено в /tmp/rooms.json");
  process.exit(0);
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
