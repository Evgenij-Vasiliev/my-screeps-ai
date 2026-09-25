"use strict";
/**
 * ЖИВОЙ КОНТРОЛЬ ПРИОРИТЕТОВ, ДОХОДА И СОБЫТИЙ TASK SYSTEM — только чтение
 * (единственная запись: счётчик `Memory.__taskEvents`, который снимок снимает и
 * обнуляет, и служебный `Memory.__prioProbe`).
 *
 * ЧТО ИЗМЕРЯЕТСЯ (доход, а не только CPU):
 *   1. `Memory.__taskEvents` за ОКНО между двумя замерами: pickup/done/skip/
 *      preempt по каждой категории. Это различает «задачу никто не взял»,
 *      «довёл» и «бросил ради более приоритетной».
 *   2. ДОХОД: транзакции рынка за то же окно тиков (`/api/user/money-history`),
 *      дельта кредитов `Game.market.credits` и баланс батареи
 *      (фабрика + склад + терминал) — то есть производство, а не только продажа.
 *   3. Состояние снабжения фабрик: энергия фабрики, `cooldownTime`, энергия
 *      склада (гейт снабжения `STORAGE.ENERGY_MIN × ENERGY_RESERVE_MULTIPLIER`
 *      = 165000), глубина очередей, число крипов по ролям.
 *   4. CPU: средний и блоки `Memory.cpuStats.profile`.
 *
 * ПОЧЕМУ ТАК.
 *   - Раньше скрипт читал ответ консоли через сокет и ждал фиксированные 3 с.
 *     На shard3 тик длится ~3.8 с, ответ не успевал прийти, и замеры приходили
 *     пустыми. Теперь снимок событий/типа/кредитов складывается в
 *     `Memory.__prioProbe`, а скрипт опрашивает `api.memory.get` до появления
 *     нового тика — канал вывода консоли (502/пусто) в замере не участвует.
 *   - Консольный API режет выражение длиннее ~1020 символов
 *     («expression size is too large»), поэтому команд ровно одна и короткая.
 *   - Живое состояние структур (фабрика/склад/терминал/контроллер) берётся из
 *     `GET /api/game/room-objects` — консоль для этого не нужна вовсе.
 *     Очереди задач, роли и CPU читаются из Memory напрямую.
 *
 * Запуск: node tests/live.priority.check.js [замеров=2] [пауза_мс=540000]
 *   Замер 1 — базовая линия (окно от предыдущего сброса счётчиков неизвестно).
 *   Каждый следующий замер — чистое окно длиной ровно в прошедшие тики.
 *   Для окна ~140 тиков при ~3.8 с/тик нужна пауза ~540000 мс (9 мин).
 *   Меньше двух замеров смысла не имеет: окно задаёт именно пара замеров.
 */
const { ScreepsAPI } = require("screeps-api");
const { resolveToken } = require("../screeps.token");

const TOKEN = resolveToken();
const SHARD = process.env.SHARD || "shard3";
const SAMPLES = Number(process.argv[2] || 2);
const PAUSE = Number(process.argv[3] || 540000);
const PROBE = "__prioProbe";
const PROBE_TIMEOUT = Number(process.env.PROBE_TIMEOUT || 60000);
const FACTORY_ENERGY_GATE = 165000; // STORAGE.ENERGY_MIN 150000 × FACTORY.ENERGY_RESERVE_MULTIPLIER 1.1

const api = new ScreepsAPI({ token: TOKEN });

// Одна короткая команда: тик, кредиты, цепочка и атомарный снимок+сброс событий.
const CMD =
  `(function(){var M=require("task.manager");` +
  `Memory.${PROBE}={t:Game.time,credits:Game.market.credits,bucket:Game.cpu.bucket,` +
  `chain:M.TASK_CHAIN.join(","),ev:M.clearTaskEvents(),stage:2};})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function send(expr) {
  if (expr.length > 1020) {
    throw new Error(`выражение ${expr.length} символов — больше лимита консоли (~1020)`);
  }
  const res = await api.console(expr, SHARD);
  if (!res || res.ok !== 1) {
    throw new Error("console HTTP не принял команду: " + JSON.stringify(res).slice(0, 200));
  }
  return res;
}

async function readMemory(path) {
  const res = await api.memory.get(path, SHARD);
  return res && res.data;
}

/**
 * Отправляет снимок и ждёт, пока в Memory появится новый тик со stage=2.
 * Повторяет попытку: консольный канал периодически теряет команду (известная
 * проблема шарда), а один потерянный снимок роняет весь прогон.
 * @param {number} prevTick
 * @returns {Promise<Object>}
 */
async function probe(prevTick, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await send(CMD);
    const deadline = Date.now() + PROBE_TIMEOUT;
    while (Date.now() < deadline) {
      await sleep(2500);
      const data = await readMemory(PROBE).catch(() => null);
      if (data && data.stage === 2 && typeof data.t === "number" && data.t > prevTick) {
        return data;
      }
    }
    if (attempt < attempts) {
      console.log(`  (снимок не пришёл, повтор ${attempt + 1}/${attempts})`);
    }
  }
  throw new Error(
    `снимок не появился в Memory.${PROBE} за ${attempts}×${PROBE_TIMEOUT} мс ` +
      "(команда не выполняется или Memory недоступна)",
  );
}

/** Живое состояние комнат через room-objects. */
async function roomStates(roomNames) {
  const out = {};
  for (const rn of roomNames) {
    const res = await api.raw.game.roomObjects(rn, SHARD).catch(() => null);
    const objs = (res && res.objects) || [];
    const pick = type => objs.find(o => o.type === type) || null;
    const f = pick("factory");
    const s = pick("storage");
    const t = pick("terminal");
    const c = pick("controller");
    out[rn] = {
      owned: !!(c && c.user),
      user: c ? c.user : null,
      rcl: c ? c.level : -1,
      dw: c ? c.ticksToDowngrade : -1,
      fE: f ? f.store.energy || 0 : -1,
      fB: f ? f.store.battery || 0 : -1,
      fH: f && f.store.H !== undefined ? f.store.H || 0 : -1,
      fcd: f ? f.cooldownTime || 0 : -1,
      sE: s ? s.store.energy || 0 : -1,
      sB: s ? s.store.battery || 0 : -1,
      tE: t ? t.store.energy || 0 : -1,
      tB: t ? t.store.battery || 0 : -1,
    };
  }
  return out;
}

/**
 * Суммирует транзакции рынка за полуинтервал (sinceTick; untilTick].
 * money-history отдаёт страницы от новых к старым.
 */
async function moneyBetween(sinceTick, untilTick) {
  const out = { total: 0, count: 0, byRes: {}, byType: {}, batteryAmount: 0 };
  for (let page = 0; page < 15; page++) {
    const res = await api.raw.user.moneyHistory(page).catch(() => null);
    const list = (res && res.list) || [];
    let reachedOlder = false;
    for (const tx of list) {
      if (tx.shard && tx.shard !== SHARD) continue;
      if (tx.tick <= sinceTick) {
        reachedOlder = true;
        continue;
      }
      if (tx.tick > untilTick) continue;
      const change = tx.change || 0;
      const resType = (tx.market && tx.market.resourceType) || "?";
      out.total += change;
      out.count += 1;
      out.byRes[resType] = (out.byRes[resType] || 0) + change;
      out.byType[tx.type] = (out.byType[tx.type] || 0) + change;
      if (resType === "battery") out.batteryAmount += (tx.market && tx.market.amount) || 0;
    }
    if (reachedOlder || !res || !res.hasMore) break;
  }
  return out;
}

function sumBattery(states, rooms) {
  let total = 0;
  for (const rn of rooms) {
    const r = states[rn];
    if (!r) continue;
    total += Math.max(0, r.fB) + Math.max(0, r.sB) + Math.max(0, r.tB);
  }
  return total;
}

function depthOf(rooms, rn) {
  const tasks = (rooms && rooms[rn] && rooms[rn].tasks) || {};
  const depth = {};
  for (const k in tasks) if (tasks[k] && tasks[k].length) depth[k] = tasks[k].length;
  return depth;
}

function rolesOf(creeps, rn) {
  const roles = {};
  for (const name in creeps || {}) {
    const m = creeps[name] || {};
    if (m.homeRoom === rn) {
      const role = m.role || "?";
      roles[role] = (roles[role] || 0) + 1;
    }
  }
  return roles;
}

/** Комнаты, где контроллер принадлежит владельцу с наибольшим числом комнат. */
function ownedRooms(states) {
  const byUser = {};
  for (const rn in states) {
    const u = states[rn].user;
    if (u) (byUser[u] = byUser[u] || []).push(rn);
  }
  let best = [];
  for (const u in byUser) if (byUser[u].length > best.length) best = byUser[u];
  return best.sort();
}

async function main() {
  console.log(
    `\n=== live.priority.check | ${SHARD} | замеров ${SAMPLES}, пауза ${Math.round(PAUSE / 1000)} с ===`,
  );
  let prev = null;
  for (let i = 0; i < SAMPLES; i++) {
    const snap = await probe(prev ? prev.t : 0);
    const cpuStats = (await readMemory("cpuStats")) || {};
    const memRooms = (await readMemory("rooms")) || {};
    const creeps = (await readMemory("creeps")) || {};

    const allStates = await roomStates(Object.keys(memRooms));
    const rooms = ownedRooms(allStates);
    snap.states = allStates;
    snap.rooms = rooms;

    console.log(`\n--- замер ${i + 1} @${snap.t} (bucket ${snap.bucket}) cpu=${cpuStats.average}`);
    console.log(`TASK_CHAIN: ${snap.chain}`);

    for (const rn of rooms) {
      const r = allStates[rn];
      const roleMap = rolesOf(creeps, rn);
      const roles = Object.keys(roleMap)
        .sort()
        .map(k => `${k}:${roleMap[k]}`)
        .join(",");
      console.log(
        `  ${rn} RCL${r.rcl} dw=${r.dw} | фабрика E=${r.fE} B=${r.fB} H=${r.fH} cdTime=${r.fcd}` +
          ` | склад E=${r.sE} B=${r.sB} | терминал E=${r.tE} B=${r.tB}` +
          ` | очереди=${JSON.stringify(depthOf(memRooms, rn))} | роли=[${roles}]`,
      );
      if (r.fE >= 0 && r.sE >= 0 && r.sE <= FACTORY_ENERGY_GATE) {
        console.log(
          `    ⚠ ${rn}: склад ${r.sE} ≤ ${FACTORY_ENERGY_GATE} — гейт СНАБЖЕНИЯ закрыт ` +
            "(генератор fillFactoryEnergy не создаёт задач). Производство при этом " +
            "идёт из буфера фабрики: produce() склад не трогает",
        );
      }
    }

    const blocks = (cpuStats.profile && cpuStats.profile.blocks) || {};
    const blockRows = Object.keys(blocks)
      .filter(k => blocks[k].count > 0)
      .map(k => `${k}=${Math.round((blocks[k].sum / blocks[k].count) * 1000) / 1000}`)
      .sort();
    if (blockRows.length) console.log(`  CPU блоки (мс/тик): ${blockRows.join(" ")}`);

    if (!prev) {
      const ev = Object.keys(snap.ev || {})
        .sort()
        .map(k => `${k}=${snap.ev[k]}`);
      console.log(
        "  базовая линия: счётчики сброшены; накоплено с прошлого сброса: " +
          (ev.join(" ") || "нет"),
      );
    } else {
      const ticks = snap.t - prev.t;
      const ev = snap.ev || {};
      const pickupF = ev["pickup:fillFactoryEnergy"] || 0;
      const preemptF = ev["preempt:fillFactoryEnergy"] || 0;
      const doneF = ev["done:fillFactoryEnergy"] || 0;
      const pickupB = ev["pickup:collectFactoryBattery"] || 0;
      const preemptB = ev["preempt:collectFactoryBattery"] || 0;
      const doneB = ev["done:collectFactoryBattery"] || 0;

      console.log(`  ОКНО: ${ticks} тиков (${prev.t} → ${snap.t})`);
      console.log(
        `  события за окно: ${Object.keys(ev)
          .sort()
          .map(k => `${k}=${ev[k]}`)
          .join(" ") || "нет"}`,
      );
      console.log(
        `  фабрика.энергия: pickup=${pickupF} (${(pickupF / Math.max(1, ticks)).toFixed(3)}/тик) ` +
          `done=${doneF} preempt=${preemptF} ` +
          `| прервано от взятых=${pickupF ? ((preemptF / pickupF) * 100).toFixed(1) : "-"}%`,
      );
      console.log(`  фабрика.батарея: pickup=${pickupB} done=${doneB} preempt=${preemptB}`);

      const money = await moneyBetween(prev.t, snap.t);
      const creditsDelta = Math.round(snap.credits - prev.credits);
      const batteryDelta = sumBattery(snap.states, rooms) - sumBattery(prev.states, prev.rooms);
      console.log(
        `  ДОХОД за окно: транзакций ${money.count}, сумма ${Math.round(money.total)} кр ` +
          `(${(money.total / Math.max(1, ticks)).toFixed(1)} кр/тик), ` +
          `батареи продано ${money.batteryAmount}`,
      );
      console.log(
        `  баланс: кредиты ${Math.round(prev.credits)} → ${Math.round(snap.credits)} ` +
          `(Δ ${creditsDelta}, ${(creditsDelta / Math.max(1, ticks)).toFixed(1)} кр/тик)`,
      );
      console.log(
        `  батарея: запас ${sumBattery(prev.states, prev.rooms)} → ` +
          `${sumBattery(snap.states, rooms)} (Δ ${batteryDelta}), ` +
          `производство ≈ продано+Δ = ${money.batteryAmount + batteryDelta}`,
      );
      console.log(`  деньги по ресурсам: ${JSON.stringify(money.byRes)}`);
    }
    prev = snap;
    if (i < SAMPLES - 1) await sleep(PAUSE);
  }

  await send(`delete Memory.${PROBE};`).catch(() => null);
  console.log("\nГотово.");
}

main().catch(e => {
  console.error("ОШИБКА:", (e && e.message) || e);
  process.exit(1);
});
