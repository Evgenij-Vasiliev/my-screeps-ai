"use strict";
/**
 * ===================================================
 * ENERGYSOURCE.TEST.JS — жёсткий пол резерва Storage
 * ===================================================
 * Лимит владельца: «в хранилище не может быть меньше 150 000». Прежний
 * withdrawFromStorage проверял только ФАКТ «резерв ещё цел»
 * (`storageEnergy > STORAGE.ENERGY_MIN`), а забор шёл полным `withdraw()` до
 * всего рюкзака крипа: при складе 150 001 и свободных 300 один воркер оставлял
 * 149 701. Теперь amount = min(свободно у крипа, остаток сверх резерва),
 * поэтому склад не уходит ниже STORAGE.ENERGY_MIN.
 *
 * Проверяем:
 *   1) объём забора обрезан остатком сверх резерва;
 *   2) на резерве и ниже — забора нет (false, withdraw не вызывается);
 *   3) свободное место крипа меньше излишка — забираем по рюкзаку;
 *   4) ignoreReserve=true (аварийный режим) пол игнорирует;
 *   5) при ERR_NOT_IN_RANGE крип едет к складу, объём тот же;
 *   6) нет storage — false.
 *
 * Запуск: node tests/energySource.test.js
 */

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.RESOURCE_ENERGY = "energy";
global.Game = { time: 0, creeps: {}, getObjectById: () => null };

const energySource = require("../energySource");
const { STORAGE } = require("../constants");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

/**
 * Заглушка Storage: реальный store.energy меняется на withdraw, чтобы проверять
 * «пол» по ФАКТИЧЕСКОМУ остатку, а не только по аргументу amount.
 */
function makeStorage(energy) {
  const structure = {
    id: "ST",
    store: { energy },
  };
  structure.storeData = structure.store; // читаемость
  return structure;
}

function makeCreep(storage, free, withdrawResult) {
  const calls = { withdraw: [], travel: 0 };
  return {
    room: { storage },
    store: {
      getFreeCapacity() {
        return free;
      },
    },
    withdraw(target, resourceType, amount) {
      calls.withdraw.push({ target, resourceType, amount });
      const result = withdrawResult === undefined ? OK : withdrawResult;
      if (result === OK && target && target.store) {
        target.store.energy -= amount;
      }
      return result;
    },
    travelTo() {
      calls.travel++;
    },
    calls,
  };
}

// ── 1. Объём обрезан остатком сверх резерва ──────────────────────────────
{
  console.log("\n1. Забор не опускает склад ниже резерва");
  const storage = makeStorage(STORAGE.ENERGY_MIN + 300);
  const creep = makeCreep(storage, 1000);
  const ok = energySource.withdrawFromStorage(creep);

  check("забор разрешён (true)", ok === true);
  check(
    "amount = излишек сверх резерва (300), а не весь рюкзак",
    creep.calls.withdraw.length === 1 && creep.calls.withdraw[0].amount === 300,
    JSON.stringify(creep.calls.withdraw),
  );
  check(
    "ФАКТ: склад остался ровно на резерве",
    storage.store.energy === STORAGE.ENERGY_MIN,
    String(storage.store.energy),
  );
}

// ── 2. На резерве и ниже забора нет ──────────────────────────────────────
{
  console.log("\n2. Склад на резерве или ниже — забора нет");
  const atFloor = makeStorage(STORAGE.ENERGY_MIN);
  const creep1 = makeCreep(atFloor, 1000);
  check("на резерве: false", energySource.withdrawFromStorage(creep1) === false);
  check("на резерве: withdraw не вызывался", creep1.calls.withdraw.length === 0);

  const below = makeStorage(STORAGE.ENERGY_MIN - 1);
  const creep2 = makeCreep(below, 1000);
  check("ниже резерва: false", energySource.withdrawFromStorage(creep2) === false);
  check("ниже резерва: withdraw не вызывался", creep2.calls.withdraw.length === 0);

  const empty = makeStorage(0);
  const creep3 = makeCreep(empty, 1000);
  check("пустой склад: false", energySource.withdrawFromStorage(creep3) === false);
}

// ── 3. Рюкзак крипа меньше излишка — забираем по рюкзаку ─────────────────
{
  console.log("\n3. Ограничение по свободному месту крипа");
  const storage = makeStorage(STORAGE.ENERGY_MIN + 5000);
  const creep = makeCreep(storage, 400);
  energySource.withdrawFromStorage(creep);
  check(
    "amount = свободное место крипа (400)",
    creep.calls.withdraw.length === 1 && creep.calls.withdraw[0].amount === 400,
    JSON.stringify(creep.calls.withdraw),
  );
  check(
    "склад остался выше резерва",
    storage.store.energy === STORAGE.ENERGY_MIN + 4600,
    String(storage.store.energy),
  );

  // Рюкзак полон — брать нечего, это не «действие начато».
  const fullStore = makeStorage(STORAGE.ENERGY_MIN + 5000);
  const fullCreep = makeCreep(fullStore, 0);
  check(
    "полный рюкзак: false и withdraw не вызывался",
    energySource.withdrawFromStorage(fullCreep) === false &&
      fullCreep.calls.withdraw.length === 0,
  );
}

// ── 4. Аварийный режим игнорирует пол ────────────────────────────────────
{
  console.log("\n4. ignoreReserve=true — аварийный режим");
  const storage = makeStorage(1000);
  const creep = makeCreep(storage, 1000);
  const ok = energySource.withdrawFromStorage(creep, true);
  check("аварийный режим: забор разрешён", ok === true);
  check(
    "аварийный режим: amount = весь остаток склада",
    creep.calls.withdraw.length === 1 && creep.calls.withdraw[0].amount === 1000,
    JSON.stringify(creep.calls.withdraw),
  );
  check("аварийный режим: склад опустошён", storage.store.energy === 0);
}

// ── 5. ERR_NOT_IN_RANGE — едем к складу, объём тот же ────────────────────
{
  console.log("\n5. ERR_NOT_IN_RANGE — движение к складу");
  const storage = makeStorage(STORAGE.ENERGY_MIN + 250);
  const creep = makeCreep(storage, 1000, ERR_NOT_IN_RANGE);
  const ok = energySource.withdrawFromStorage(creep);
  check("возврат true (действие начато)", ok === true);
  check("travelTo вызван один раз", creep.calls.travel === 1);
  check(
    "amount всё равно обрезан (250)",
    creep.calls.withdraw.length === 1 && creep.calls.withdraw[0].amount === 250,
    JSON.stringify(creep.calls.withdraw),
  );
  check("склад не изменился (до склада не дошли)", storage.store.energy === STORAGE.ENERGY_MIN + 250);
}

// ── 6. Нет склада — false ────────────────────────────────────────────────
{
  console.log("\n6. Нет Storage");
  const creep = makeCreep(null, 1000);
  check("без склада: false", energySource.withdrawFromStorage(creep) === false);
  check("без склада: withdraw не вызывался", creep.calls.withdraw.length === 0);
}

// ── 7. Много воркеров за тик не пробивают пол ────────────────────────────
{
  console.log("\n7. Несколько воркеров в одном тике");
  const storage = makeStorage(STORAGE.ENERGY_MIN + 500);
  let accessed = 0;
  for (let i = 0; i < 5; i++) {
    const creep = makeCreep(storage, 1000);
    if (energySource.withdrawFromStorage(creep)) accessed++;
  }
  check(
    "пол пробит не был",
    storage.store.energy === STORAGE.ENERGY_MIN,
    String(storage.store.energy),
  );
  check(
    "часть воркеров ушла без энергии",
    accessed >= 1 && accessed < 5,
    String(accessed),
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
