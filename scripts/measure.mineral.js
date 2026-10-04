"use strict";
/**
 * ===================================================
 * SCRIPTS/MEASURE.MINERAL.JS — состояние добычи минералов в империи
 * ===================================================
 * READ-ONLY. Ничего не пишет ни в Memory, ни на шард: только
 * `GET /api/game/room-objects` (официальный game API — тот же путь, что в
 * scripts/world.facts.js:40) и чтение Memory.rooms / Memory.creeps через
 * `memory.get`.
 *
 * Почему не консоль: консольная команда исполняется в том же изоляте, что и
 * тик бота, и её CPU попадает в Game.cpu.getUsed()
 * (driver/lib/runtime/runtime.js, `usedTime = wall + intents`) — искажает
 * замер. room-objects читает состояние мира без исполнения кода бота.
 *
 * Зачем: по коду видно, что роль mineralMiner существует
 * (role.mineralMiner.js:4), квота стоит (constants/spawn.js:31), шлюз спавна
 * написан (spawn.manager.js:204-207). Но построена ли добыча в мире — вопрос
 * факта: есть ли экстрактор, сколько минерала в комнате, живёт ли хоть один
 * крип этой роли. Без этих чисел любое предложение — гипотеза (AGENTS.md:16).
 *
 * Запуск:
 *   node scripts/measure.mineral.js [shard3]
 * ===================================================
 */

const { resolveTokenSource } = require("../screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = process.argv[2] || "shard3";
const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** store структуры из room-objects — плоский объект { ресурс: количество }. */
function storeOf(obj) {
  return (obj && obj.store) || {};
}

function fmtStore(store) {
  const keys = Object.keys(store || {}).filter(k => store[k] > 0);
  if (!keys.length) return "пусто";
  return keys
    .sort((a, b) => store[b] - store[a])
    .map(k => `${k}:${store[k]}`)
    .join(" ");
}

(async () => {
  const me = await api.userID();

  const mem = await api.memory.get("rooms", SHARD);
  const roomMem = (mem && mem.data) || {};
  const rooms = Object.keys(roomMem);

  // Роль крипа лежит в Memory.creeps[name].role — одно чтение на всю империю.
  const cMem = await api.memory.get("creeps", SHARD);
  const creepsMem = (cMem && cMem.data) || {};
  const byRole = {};
  const mineralMiners = [];
  for (const name in creepsMem) {
    const role = creepsMem[name] && creepsMem[name].role;
    byRole[role] = (byRole[role] || 0) + 1;
    if (role === "mineralMiner") {
      mineralMiners.push({ name, mem: creepsMem[name] || {} });
    }
  }

  console.log(`Замер минералов: shard=${SHARD}, комнат в Memory.rooms=${rooms.length}`);

  const summary = [];

  for (const room of rooms) {
    let objs = [];
    try {
      const res = await api.raw.game.roomObjects(room, SHARD);
      objs = (res && res.objects) || [];
    } catch (e) {
      console.log(`\n=== ${room} === ОШИБКА чтения: ${e.message}`);
      continue;
    }

    const ctrl = objs.find(o => o.type === "controller");
    // В room-objects владелец контроллера — поле user (id), а не my
    // (scripts/world.facts.js:46-47).
    const isOwned = !!(ctrl && ctrl.user === me);
    if (!isOwned) {
      await sleep(900);
      continue;
    }

    const mineral = objs.find(o => o.type === "mineral") || null;
    const extractor = objs.find(o => o.type === "extractor") || null;
    const storage = objs.find(o => o.type === "storage") || null;
    const terminal = objs.find(o => o.type === "terminal") || null;
    const myCreeps = objs.filter(o => o.type === "creep" && o.user === me);

    const storageStore = storeOf(storage);
    const terminalStore = storeOf(terminal);
    const mineralType = mineral ? mineral.mineralType : null;

    console.log(`\n=== ${room} === RCL ${ctrl ? ctrl.level : "?"}, своих крипов ${myCreeps.length}`);
    if (mineral) {
      console.log(
        `  минерал: type=${mineral.mineralType} amount=${mineral.mineralAmount}` +
          `${mineral.density !== undefined ? " density=" + mineral.density : ""}` +
          `${mineral.mineralAmount === 0 ? "  <-- ИСТОЩЁН" : ""}`,
      );
    } else {
      console.log("  минерал: НЕ НАЙДЕН в room-objects");
    }
    if (extractor) {
      console.log(
        `  extractor: есть, cooldown=${extractor.cooldown}` +
          `${extractor.cooldown > 0 ? " (добыча идёт)" : " (простаивает)"}`,
      );
    } else {
      console.log("  extractor: НЕТ");
    }
    if (mineralType) {
      console.log(
        `  ${mineralType} в storage=${storageStore[mineralType] || 0}` +
          `  в terminal=${terminalStore[mineralType] || 0}`,
      );
    }
    console.log(`  storage: ${fmtStore(storageStore)}`);
    console.log(`  terminal: ${fmtStore(terminalStore)}`);

    summary.push({
      room,
      type: mineralType,
      amount: mineral ? mineral.mineralAmount : null,
      extractor: !!extractor,
      cd: extractor ? extractor.cooldown : null,
      creeps: myCreeps.length,
    });

    await sleep(900);
  }

  console.log("\n=== РОЛИ ЖИВЫХ КРИПОВ (Memory.creeps) ===");
  const roleNames = Object.keys(byRole).sort((a, b) => byRole[b] - byRole[a]);
  console.log(
    "  " + (roleNames.length
      ? roleNames.map(r => `${r}:${byRole[r]}`).join("  ")
      : "(Memory.creeps пуст)"),
  );

  console.log(`\n=== mineralMiner: ${mineralMiners.length} шт. ===`);
  for (const m of mineralMiners) {
    const flat = Object.keys(m.mem)
      .filter(k => !k.startsWith("__"))
      .map(k => `${k}=${JSON.stringify(m.mem[k])}`)
      .join(" ");
    console.log(`  ${m.name}: ${flat}`);
  }

  console.log("\n=== СВОДКА ПО СВОИМ КОМНАТАМ ===");
  console.log("  комната       минерал  amount   extractor  своих крипов");
  for (const s of summary) {
    console.log(
      `  ${s.room.padEnd(13)} ${String(s.type || "нет").padEnd(8)} ` +
        `${String(s.amount === null ? "-" : s.amount).padEnd(8)} ` +
        `${(s.extractor ? "да" : "нет").padEnd(10)} ${s.creeps}`,
    );
  }
  console.log(
    `\n  комнат с экстрактором: ${summary.filter(s => s.extractor).length} из ${summary.length}` +
      `; комнат с неизрасходованным минералом: ` +
      `${summary.filter(s => s.amount > 0).length}` +
      `; живых mineralMiner: ${mineralMiners.length}`,
  );
})().catch(e => {
  console.error("ОШИБКА:", e && e.message ? e.message : e);
  process.exit(1);
});
