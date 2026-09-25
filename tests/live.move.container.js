"use strict";
/**
 * Живая правка (ЗАПИСЬ в игру): поставить площадку контейнера у источника в
 * удалённой комнате на заданную клетку.
 *
 * Зачем: роль ставит площадку ПОД крипом (`creep.pos.createConstructionSite`),
 * а крип подходит к источнику разными маршрутами (путь в E35S38 дешевле через
 * дороги домашней комнаты — docs/REMOTE-BORDER-PING-PONG.md), поэтому клетка
 * контейнера получается случайной: в E35S38 вышло (37,33) вместо (37,32).
 * Код после правки 18.09.2026 берёт клетку из constants.REMOTE
 * (ROOM_TO_CONTAINER_POS), но уже стоящую площадку он не переносит — этот
 * скрипт делает это в живом мире и сбрасывает кэш площадки у майнеров комнаты.
 * Дальше майнер достраивает контейнер сам и встаёт на него (клетка контейнера —
 * его рабочее место).
 *
 * ВАЖНО (найденный лимит API): консоль Screeps МОЛЧА игнорирует выражения
 * длиннее ~1000 символов — HTTP отвечает 200, а события сокета приходят с
 * пустым `results` (проверено замером: 395 символов — ответ есть, 1044 — уже
 * нет). Поэтому выражение здесь собирается ОДНОЙ строкой без комментариев, а
 * его длина проверяется до отправки (MAX_EXPRESSION).
 *
 * Запуск:
 *   DRY=1 node tests/live.move.container.js      # только показать состояние
 *   node tests/live.move.container.js            # правка
 *   ROOM=E35S38 X=37 Y=32 SHARD=shard3
 */

const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const ROOM = process.env.ROOM || "E35S38";
const X = Number(process.env.X || 37);
const Y = Number(process.env.Y || 32);
const DRY = !!process.env.DRY;

// Ограничение консоли Screeps (см. шапку файла): длиннее — молча ничего.
const MAX_EXPRESSION = 900;

const api = new ScreepsAPI({ token: TOKEN });
const JS = JSON.stringify;

/** Короткое выражение: только снимок (режим DRY и проверка после правки). */
function reportExpression() {
  return (
    "(function(){var R=" +
    JS(ROOM) +
    ",T=new RoomPosition(" +
    X +
    "," +
    Y +
    ",R),r=Game.rooms[R];if(!r)return JSON.stringify({error:'комната не видна'});" +
    "var c=r.controller,res=" +
    "c&&c.reservation?c.reservation.username+'/'+c.reservation.ticksToEnd:'нет резервации';" +
    "var m=[];for(var n in Memory.creeps){var cm=Memory.creeps[n];" +
    "if(cm.role==='remoteMiner'&&cm.targetRoom===R)m.push(n)}" +
    "return JSON.stringify({reservation:res,remoteMiners:m," +
    "sites:r.find(FIND_CONSTRUCTION_SITES).map(function(s){return s.pos.x+','+s.pos.y+'/'+s.progress})})})()"
  );
}

/**
 * Одно выражение на всю правку: снять прежние площадки контейнера, поставить
 * площадку в заданной клетке и сбросить у дальних майнеров этой комнаты кэш
 * площадки (иначе роль до REMOTE.STRUCTURE_CHECK_INTERVAL тиков считает, что
 * площадки нет, и ставит свою — под собой). Всё в одном тике: между снятием и
 * постановкой роль успела бы поставить площадку обратно.
 */
function fixExpression() {
  return (
    "(function(){var R=" +
    JS(ROOM) +
    ",T=new RoomPosition(" +
    X +
    "," +
    Y +
    ",R),r=Game.rooms[R];if(!r)return JSON.stringify({error:'комната не видна'});" +
    "var o=[];r.find(FIND_CONSTRUCTION_SITES,{filter:function(s){return s.structureType===STRUCTURE_CONTAINER}})" +
    ".forEach(function(s){o.push(s.pos.x+','+s.pos.y);s.remove()});" +
    "var cr=T.createConstructionSite(STRUCTURE_CONTAINER);" +
    "for(var n in Memory.creeps){var cm=Memory.creeps[n];" +
    "if(cm.role==='remoteMiner'&&cm.targetRoom===R){delete cm.containerSiteId;delete cm.containerCheckedAt}}" +
    "return JSON.stringify({removed:o,create:cr," +
    "sites:r.find(FIND_CONSTRUCTION_SITES).map(function(s){return s.pos.x+','+s.pos.y})})})()"
  );
}

/**
 * Отправка одного выражения в консоль шарда и разбор ответа.
 *
 * События сокета: результат приходит отдельным событием от логов игры, а у
 * выражений длиннее лимита (см. шапку) приходит пустой `results` — поэтому
 * проверяем молчание и предупреждаем отдельным текстом.
 */
async function ask(expression) {
  let result = null;
  const logs = [];
  const onConsole = ev => {
    if (ev.data && ev.data.shard && ev.data.shard !== SHARD) return;
    const msgs = ev.data.messages || {};
    if (msgs.log && msgs.log.length) logs.push(JSON.stringify(msgs.log));
    (msgs.results || []).forEach(m => {
      if (m !== undefined && m !== null && m !== "") result = m;
    });
  };
  api.socket.subscribe("console", onConsole);
  try {
    await api.console(expression, SHARD);
    await new Promise(r => setTimeout(r, 8000));
  } finally {
    if (typeof api.socket.unsubscribe === "function") {
      api.socket.unsubscribe("console", onConsole);
    }
  }
  if (!result) return { error: "нет ответа от консоли", logs: logs };
  return JSON.parse(result);
}

async function main() {
  const expression = DRY ? reportExpression() : fixExpression();
  if (expression.length > MAX_EXPRESSION) {
    throw new Error(
      `выражение ${expression.length} символов > ${MAX_EXPRESSION} — консоль его молча проигнорирует`,
    );
  }

  await api.socket.connect();
  await new Promise(r => setTimeout(r, 1500));

  console.log(
    `${DRY ? "DRY — только снимок" : "ПРАВКА"} (${ROOM}, цель ${X},${Y}, выражение ${expression.length} символов)`,
  );

  const r = await ask(expression);
  if (r.error) {
    console.log(`  ${r.error}`);
    r.logs.forEach(l => console.log("  лог: " + l));
    process.exitCode = 1;
    process.exit(1);
  }

  if (DRY) {
    printReport(r);
    process.exit(0);
  }

  console.log(
    `  снятые площадки контейнера: ${r.removed.length ? r.removed.join(" | ") : "нет"}`,
  );
  console.log(
    `  createConstructionSite = ${r.create} (0 = OK, -8 = ERR_FULL, -10 = ERR_INVALID_TARGET, -4 = занято)`,
  );

  // Room.find кэшируется на тик, поэтому сразу после createConstructionSite
  // список площадок в ответе пуст — проверяем отдельным запросом в НОВОМ тике.
  await new Promise(r => setTimeout(r, 5000));
  const check = await ask(reportExpression());
  console.log("\nСнимок после правки (новый тик):");
  if (check.error) {
    console.log(`  ${check.error}`);
    process.exitCode = 1;
    process.exit(1);
  }
  printReport(check);
  const ok = check.sites.some(s => s.startsWith(`${X},${Y}`));
  console.log(`  площадка в настроенной клетке (${X},${Y}): ${ok ? "ДА" : "НЕТ"}`);
  if (!ok) process.exitCode = 1;
  process.exit(ok ? 0 : 1);
}

/** Печать снимка комнаты (общий формат для DRY и проверки после правки). */
function printReport(r) {
  console.log(`  резервация контроллера: ${r.reservation}`);
  console.log(
    `  дальние майнеры с targetRoom=${ROOM}: ${r.remoteMiners.join(" | ") || "нет"}`,
  );
  console.log(
    `  площадки контейнера (клетка/прогресс): ${r.sites.join(" | ") || "нет"}`,
  );
}

main().catch(e => {
  console.error("ОШИБКА:", e.message);
  process.exitCode = 1;
});
