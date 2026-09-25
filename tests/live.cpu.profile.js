"use strict";
/**
 * Печатает окно Memory.cpuStats со шарда (только чтение): средний CPU за тик,
 * максимум по блокам профилирования (roomState, roomManager, подсистемы,
 * комнаты) плюс число замеров в окне.
 *
 * Роли — отдельное окно Memory.cpuStats.roles и opt-in
 * (Memory.cpuMonitorRoles): если ролевой замер выключен, раздела ролей в
 * выводе не будет (это норма, а не отсутствие данных).
 *
 * Запуск: node tests/live.cpu.profile.js [shard]
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.argv[2] || process.env.SHARD || "shard3";

const api = new ScreepsAPI({ token: TOKEN });

(async () => {
  const res = await api.memory.get("cpuStats.profile", SHARD);
  const p = res && res.data;
  const rolesRes = await api.memory.get("cpuStats.roles", SHARD).catch(() => null);
  const r = rolesRes && rolesRes.data;
  const rolesOn = await api.memory
    .get("cpuMonitorRoles", SHARD)
    .then(m => m && m.data === true)
    .catch(() => false);
  if (!p) {
    console.log(`cpuStats.profile пуст на ${SHARD} (окно ещё не сброшено в Memory)`);
  } else {
    const samples = p.samples || 0;
    const avg = e => (e && samples ? (e.sum / samples).toFixed(4) : "-");
    const rows = Object.keys(p.blocks || {})
      .map(k => [k, avg(p.blocks[k]), (p.blocks[k].max || 0).toFixed(3)])
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));

    console.log(
      `\n=== cpuStats.profile | ${SHARD} | замеров ${samples} | период ${samples} тиков (с ${p.startTick}) ===`,
    );
    console.log("блок".padEnd(20), "avg".padStart(9), "max".padStart(9));
    for (const [k, a, m] of rows) console.log(k.padEnd(20), a.padStart(9), m.padStart(9));

    const rooms = p.rooms || {};
    const roomRows = Object.keys(rooms).sort();
    if (roomRows.length) {
      console.log("\nкомнаты (room:<имя> = вся обработка комнаты):");
      for (const k of roomRows) console.log(" ", k.padEnd(10), avg(rooms[k]), "max", (rooms[k].max || 0).toFixed(3));
    }
    console.log(
      `\nMARK profile: samples=${samples} roomState=${avg(p.blocks && p.blocks.roomState)} ` +
        `roomStateMax=${p.blocks && p.blocks.roomState ? p.blocks.roomState.max.toFixed(3) : "-"} ` +
        `roomManager=${avg(p.blocks && p.blocks.roomManager)}`,
    );
  }

  if (!r) {
    console.log(
      `\nроли: окно Memory.cpuStats.roles пусто (Memory.cpuMonitorRoles=${rolesOn} — ` +
        `включить: Memory.cpuMonitorRoles = true)`,
    );
  } else {
    const samples = r.samples || 0;
    const avg = e => (e && samples ? (e.sum / samples).toFixed(4) : "-");
    const rows = Object.keys(r.roles || {})
      .map(k => [k, avg(r.roles[k]), (r.roles[k].max || 0).toFixed(3)])
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
    console.log(
      `\n=== cpuStats.roles | ${SHARD} | замеров ${samples} | период ${samples} тиков (с ${r.startTick}) ===`,
    );
    console.log("роль".padEnd(20), "avg".padStart(9), "max".padStart(9));
    for (const [k, a, m] of rows) console.log(k.padEnd(20), a.padStart(9), m.padStart(9));
  }
  process.exit(0);
})().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
