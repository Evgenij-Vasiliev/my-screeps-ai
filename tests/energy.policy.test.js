/**
 * Тест энергетической лестницы (energy.policy.js + ENERGY_POLICY в constants).
 *
 * Проверяет поведение ступени: рост по порогам, гистерезис 15k, дно 160k,
 * одну ступень за проверку, выключение подсистем по имени и флаг systems.policy.
 * Офлайн: Memory/Game — заглушки, шард не нужен.
 */
const assert = require("assert");
const path = require("path");

global.RESOURCE_ENERGY = "energy";
global.Memory = { rooms: {} };
global.Game = { time: 1000 };

const { ENERGY_POLICY } = require("../constants");
const policy = require("../energy.policy");

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? " — " + extra : ""));
  }
}

function makeRoom(name) {
  return { name, storage: { store: { energy: 0 } } };
}

// Один тик = EVAL_EVERY тиков, чтобы ступень гарантированно пересчиталась.
function tick(room, energy, times) {
  room.storage.store.energy = energy;
  for (let i = 0; i < (times || 1); i++) {
    Game.time += ENERGY_POLICY.EVAL_EVERY;
    policy.band(room);
  }
  return policy.band(room);
}

console.log("\n1. Пустая комната — только ядро");
{
  const room = makeRoom("E1S1");
  check("band === 0", tick(room, 0) === 0, "band=" + policy.band(room));
  check("лабы выключены", policy.allows(room, "labs") === false);
  check("неизвестное имя — false", policy.allows(room, "nope") === false);
}

console.log("\n2. Рост по порогам (одна ступень за проверку)");
{
  const room = makeRoom("E2S2");
  tick(room, 165000);
  const afterOne = policy.band(room);
  check("165k → ступень 1 (башни)", afterOne === 1, "band=" + afterOne);
  check("башни включены", policy.allows(room, "towers") === true);
  check("ремонт ещё выключен", policy.allows(room, "repair") === false);

  tick(room, 180000, 4);
  check("180k → апгрейд включён", policy.allows(room, "upgrade") === true);
  check("лабы ещё выключены", policy.allows(room, "labs") === false);

  tick(room, 200000, 2);
  check("200k → лабы включены", policy.allows(room, "labs") === true);
  check("бусты ещё выключены (210k)", policy.allows(room, "boost") === false);

  tick(room, 215000, 1);
  check("215k → бусты включены", policy.allows(room, "boost") === true);
  check("фабрика ещё выключена (225k)", policy.allows(room, "factory") === false);

  tick(room, 230000, 1);
  check("230k → фабрика включена", policy.allows(room, "factory") === true);
  check("продажа ещё выключена (240k)", policy.allows(room, "marketSell") === false);

  tick(room, 245000, 1);
  check("245k → продажа включена", policy.allows(room, "marketSell") === true);
}

console.log("\n3. Гистерезис 15k: у порога не мигает");
{
  const room = makeRoom("E3S3");
  tick(room, 200000, 6); // дойти до лаб
  const on = policy.allows(room, "labs");
  tick(room, 181000); // ниже порога 195k, но выше 195-15=180k
  check("лабы были включены", on === true);
  check("181k — лабы ОСТАЮТСЯ включены", policy.allows(room, "labs") === true);
  tick(room, 179000);
  check("179k — лабы выключаются", policy.allows(room, "labs") === false);
}

console.log("\n4. Дно: ниже 160k ступень не растёт вниз бесконечно");
{
  const room = makeRoom("E4S4");
  tick(room, 300000, 20);
  const high = policy.band(room);
  tick(room, 100000, 20);
  check("было > 0", high > 0, "high=" + high);
  check("упало до 0", policy.band(room) === 0, "band=" + policy.band(room));
  check("башни выключены", policy.allows(room, "towers") === false);
}

console.log("\n5. Флаги systems.policy");
{
  const systems = require("../systems");
  const room = makeRoom("E5S5");
  tick(room, 400000, 30);
  check("marketBuy выключен флагом при любом складе", policy.allows(room, "marketBuy") === false);
  const saved = systems.policy.marketBuy;
  systems.policy.marketBuy = true;
  check("при policy.marketBuy=true — включается по ступени 270k", policy.allows(room, "marketBuy") === true);
  systems.policy.marketBuy = saved;
}

console.log("\n6. Конфиг: монотонность и зазоры");
{
  const bands = ENERGY_POLICY.BANDS;
  let monotone = true;
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].on <= bands[i - 1].on) monotone = false;
  }
  check("пороги строго возрастают", monotone);
  check(
    "первый порог выше дна на запас",
    bands[0].on - ENERGY_POLICY.OFF_FLOOR >= 5000,
    bands[0].on + " vs " + ENERGY_POLICY.OFF_FLOOR,
  );
  check("гистерезис положителен", ENERGY_POLICY.HYSTERESIS > 0);
  check(
    "ступеней меньше 12",
    bands.length <= 12,
    "bands=" + bands.length,
  );
}

console.log("\nИтого: " + pass + " PASS, " + fail + " FAIL, " + (pass + fail) + " всего");
process.exit(fail === 0 ? 0 : 1);
