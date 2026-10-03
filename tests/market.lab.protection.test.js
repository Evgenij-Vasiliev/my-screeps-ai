"use strict";
/**
 * ===================================================
 * MARKET.LAB.PROTECTION.TEST.JS — офлайн-проверка защиты ресурсов лаб от продажи
 * ===================================================
 * Что проверяется:
 *   1) реагенты и продукты ОБОИХ рецептов тройки защищены (Memory.rooms[*].labs*);
 *   2) буст-ресурсы буст-лабы защищены (config.boost);
 *   3) ресурсы резервов LAB_BOOST.ROOM_RESERVE/HUB_RESERVE защищены;
 *   4) power и X (RESOURCE_CATALYST) защищены ВСЕГДА, даже без конфигов лаб;
 *   5) соединение, не входящее ни в один рецепт (KO), НЕ защищено — защита не
 *      должна останавливать рынок целиком;
 *   6) конфиги ЧУЖИХ комнат в защиту не попадают.
 *
 * Запуск: node tests/market.lab.protection.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("loadShed") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

/* ── Глобалы движка: ровно те, что нужны market.manager при загрузке ──────── */
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_HYDROGEN = "H";
global.RESOURCE_OXYGEN = "O";
global.RESOURCE_UTRIUM = "U";
global.RESOURCE_LEMERGIUM = "L";
global.RESOURCE_KEANIUM = "K";
global.RESOURCE_ZYNTHIUM = "Z";
global.RESOURCE_CATALYST = "X";
global.RESOURCES_ALL = [
  global.RESOURCE_ENERGY,
  global.RESOURCE_POWER,
  global.RESOURCE_BATTERY,
  global.RESOURCE_HYDROGEN,
  global.RESOURCE_OXYGEN,
  global.RESOURCE_UTRIUM,
  global.RESOURCE_LEMERGIUM,
  global.RESOURCE_KEANIUM,
  global.RESOURCE_ZYNTHIUM,
  global.RESOURCE_CATALYST,
];
global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.OK = 0;

global.Memory = { rooms: {} };
global.Game = {
  time: 1000,
  rooms: {},
  market: { credits: 0, calcTransactionCost: () => 0 },
  cpu: { bucket: 10000, limit: 20, getUsed: () => 0 },
};

const marketManager = require("../market.manager");
const { LAB_BOOST } = require("../constants");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

/* ── Фикстура: своя комната с тройкой и буст-лабой + чужая комната ───────── */
const ownRoom = {
  name: "E35S37",
  controller: { my: true },
  memory: {
    labs: {
      lab1: "l1",
      lab2: "l2",
      reactor: "r1",
      reagent1: "KH2O",
      reagent2: "X",
      product: "XKH2O",
      recipeA: { reagent1: "KH2O", reagent2: "X", product: "XKH2O" },
      recipeB: { reagent1: "ZHO2", reagent2: "X", product: "XZHO2" },
    },
    boostLab: "b1",
  },
};

const foreignRoom = {
  name: "W9N9",
  controller: { my: false },
  memory: {
    labs: {
      lab1: "f1",
      lab2: "f2",
      reactor: "f3",
      recipeA: { reagent1: "UO", reagent2: "OH", product: "UHO2" },
      recipeB: { reagent1: "ZO", reagent2: "OH", product: "ZHO2" },
    },
  },
};

global.Game.rooms = { E35S37: ownRoom, W9N9: foreignRoom };
global.Memory.rooms = { E35S37: ownRoom.memory, W9N9: foreignRoom.memory };

const protectedResources = marketManager.collectProtectedResources();

console.log("1. Реагенты и продукты ОБОИХ рецептов защищены");
check("reagent1 активного рецепта (KH2O)", protectedResources.KH2O === true);
check("reagent2 активного рецепта (X)", protectedResources.X === true);
check("продукт активного рецепта (XKH2O)", protectedResources.XKH2O === true);
check("реагент ВТОРОГО рецепта (ZHO2)", protectedResources.ZHO2 === true);
check("продукт ВТОРОГО рецепта (XZHO2)", protectedResources.XZHO2 === true);

console.log("\n2. Буст-ресурсы политики LAB_BOOST защищены");
let boostRowMissed = null;
for (const role in LAB_BOOST.BOOST_POLICY) {
  for (const row of LAB_BOOST.BOOST_POLICY[role]) {
    if (protectedResources[row.resource] !== true) {
      boostRowMissed = `${role}: ${row.resource}`;
    }
  }
}
check(
  "все ресурсы BOOST_POLICY защищены",
  boostRowMissed === null,
  boostRowMissed,
);

console.log("\n3. Ресурсы резервов бустов защищены");
let reserveMissed = null;
for (const map of [LAB_BOOST.ROOM_RESERVE, LAB_BOOST.HUB_RESERVE]) {
  for (const resourceType in map) {
    if (protectedResources[resourceType] !== true) {
      reserveMissed = resourceType;
    }
  }
}
check("ROOM_RESERVE и HUB_RESERVE защищены", reserveMissed === null, reserveMissed);
// T1-контур (правка 02.10.2026): UO и KH — расходники массового буста майнеров
// и воркеров, они обязаны быть защищены и политикой, и резервами.
check("T1-контур: UO защищён", protectedResources.UO === true);
check("T1-контур: KH защищён", protectedResources.KH === true);

console.log("\n4. power и X защищены всегда");
check("power защищён", protectedResources[global.RESOURCE_POWER] === true);
check(
  "X (RESOURCE_CATALYST) защищён",
  protectedResources[global.RESOURCE_CATALYST] === true,
);
// Без конфигов вообще: защита не должна зависеть от Memory.rooms.
const savedRooms = global.Game.rooms;
global.Game.rooms = {};
const bare = marketManager.collectProtectedResources();
global.Game.rooms = savedRooms;
check(
  "при пустом Game.rooms power и X всё равно защищены",
  bare[global.RESOURCE_POWER] === true &&
    bare[global.RESOURCE_CATALYST] === true,
);

console.log("\n5. Постороннее соединение НЕ защищено");
check("KO не защищён", protectedResources.KO === undefined);
check("energy не защищён", protectedResources[global.RESOURCE_ENERGY] === undefined);

console.log("\n6. Конфиги чужих комнат в защиту не попадают");
// ПРОБЫ ОБЯЗАНЫ БЫТЬ НЕЙТРАЛЬНЫМИ. С 02.10.2026 UO и KH входят в T1-контур:
// они перечислены в BOOST_POLICY и в ROOM_RESERVE/HUB_RESERVE, поэтому защищены
// ГЛОБАЛЬНО — этой пробой проверять нечего. UHO2 и OH встречаются только
// в конфиге чужой комнаты этой фикстуры.
check("UHO2 из чужой комнаты не защищён", protectedResources.UHO2 === undefined);
check("OH из чужой комнаты не защищён", protectedResources.OH === undefined);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
