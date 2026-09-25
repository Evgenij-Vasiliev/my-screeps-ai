"use strict";
/**
 * Живой покадровый трекер (только чтение, без записи в Memory):
 * опрашивает roomObjects/E35S37 и E35S38 и печатает позиции дальних крипов.
 * Запуск: node tests/live.watch.border.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = "shard3";
const WATCH = ["remoteMiner", "remoteHauler", "reserver"];

const api = new ScreepsAPI({ token: TOKEN });

async function snap(roomName) {
  const res = await api.raw.game.roomObjects(roomName, SHARD);
  const objs = res.objects || res;
  return (Array.isArray(objs) ? objs : []).map(o => ({
    type: o.type,
    name: o.name,
    user: o.user,
    x: o.x,
    y: o.y,
  }));
}

async function main() {
  const SAMPLES = Number(process.env.SAMPLES || 20);
  for (let s = 0; s < SAMPLES; s++) {
    const [home, remote] = await Promise.all([
      snap("E35S37").catch(() => []),
      snap("E35S38").catch(() => []),
    ]);
    const line = [];
    for (const room of [
      { name: "E35S37", objs: home },
      { name: "E35S38", objs: remote },
    ]) {
      room.objs
        .filter(o => o.type === "creep")
        .forEach(o => {
          const short = (o.name || "").replace(/_[0-9]+$/, "");
          if (!WATCH.some(w => short.startsWith(w))) return;
          line.push(
            `${room.name} ${short}@${o.x},${o.y}`,
          );
        });
    }
    console.log(`#${s.toString().padStart(2)} ` + line.join("  |  "));
    await new Promise(r => setTimeout(r, 2000));
  }
  process.exit(0);
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
