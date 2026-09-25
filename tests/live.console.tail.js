"use strict";
/**
 * «Хвост» консоли шарда через сокет (только чтение): печатает строки
 * console.log/ошибок игры за окно наблюдения. Нужен для функционального
 * контроля после деплоя (например, нет ли `[RoomManager] Ошибка у крипа …`
 * и `TRAVELER: …` спама).
 *
 * Запуск: SECONDS=30 node tests/live.console.tail.js
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SECONDS = Number(process.env.SECONDS || 30);

const api = new ScreepsAPI({ token: TOKEN });

(async () => {
  await api.socket.connect();
  await api.socket.subscribe("console");

  let lines = 0;
  api.socket.on("console", e => {
    const msgs = (e && e.data && e.data.messages) || {};
    for (const m of msgs.log || []) {
      console.log("[log] " + m);
      lines++;
    }
    for (const m of msgs.results || []) {
      console.log("[res] " + JSON.stringify(m));
      lines++;
    }
  });

  console.log(`Слушаю консоль shard3 ${SECONDS} с …`);
  setTimeout(() => {
    console.log(`Строк получено: ${lines}`);
    process.exit(0);
  }, SECONDS * 1000);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
