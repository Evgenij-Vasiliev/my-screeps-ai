"use strict";
/**
 * ===================================================
 * MODULE.BARREL.TEST.JS — контракт разбиения монолитов
 * ===================================================
 * Аудит, п. 8: constants.js разложен по constants/*.js, market.manager.js —
 * на market.core/sell/buy/labImport. Разбиение не должно менять публичный
 * контракт, поэтому проверяем:
 *   1) набор имён require("./constants") ровно тот же, что до разбиения;
 *   2) barrel и доменные модули отдают ОДНИ И ТЕ ЖЕ объекты конфига — это
 *      критично там, где конфиг мутируют на месте (тесты чистят
 *      MARKET.BUY_RESOURCES, live-скрипты правят LAB_PLAN);
 *   3) market.manager отдаёт прежний публичный API и те же функции, что
 *      доменные модули (внешний код и live-скрипты ходят только через него);
 *   4) состояние запуска рынка общее для продажи и закупки: решение о защите
 *      X, принятое в market.sell, видно в market.buy, а resetRun() его снимает.
 *
 * Запуск: node tests/module.barrel.test.js
 */

// Глобалы движка, нужные модулям рынка/констант при загрузке.
global.ORDER_BUY = "buy";
global.ORDER_SELL = "sell";
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.OK = 0;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.Game = { time: 1, rooms: {} };
global.Memory = { rooms: {} };

const constants = require("../constants");
const marketManager = require("../market.manager");
const marketCore = require("../market.core");
const marketSell = require("../market.sell");
const marketBuy = require("../market.buy");
const marketLabImport = require("../market.labImport");

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

// ── 1. Публичный набор констант ──────────────────────────────────────────
console.log("\n1. require(\"./constants\") отдаёт прежний набор имён");
const EXPECTED_CONSTANTS = [
  "STORAGE",
  "TERMINAL_SUPPLY",
  "TERMINAL_NETWORK",
  "FACTORY",
  "PRESPAWN_THRESHOLD",
  "CREEP_BODIES",
  "TOWER",
  "TASK_CONFIG",
  "TASK_GEN_INTERVAL",
  "TASK_GEN_INTERVAL_DEFAULT",
  "POWER_SPAWN",
  "HARVESTER",
  "WORKER",
  "BOOTSTRAP",
  "MINER",
  "REMOTE",
  "LAB_WORKER",
  "LAB_PLAN",
  "LAB_BINDING",
  "LAB_BOOST",
  "SPAWN_QUOTA",
  "ROOM_SPAWN_QUOTA_OVERRIDES",
  "MINERAL_MIN_AMOUNT_TO_SPAWN",
  "CONTROLLER",
  "CACHE",
  "CPU",
  "MARKET",
  "X_PURCHASE",
  "LAB_PRIORITY",
  "EMPIRE",
];
check(
  "набор имён совпадает",
  JSON.stringify(Object.keys(constants)) === JSON.stringify(EXPECTED_CONSTANTS),
  Object.keys(constants).join(","),
);
check(
  "внутренние таблицы не утекли в barrel",
  !("FACTORY_RECIPES" in constants) &&
    !("REMOTE_ROUTE_TICKS" in constants) &&
    !("spawnTimeOf" in constants),
);

// ── 2. Barrel и доменные модули — одни и те же объекты ──────────────────
console.log("\n2. Barrel и constants/* — одни и те же объекты конфига");
const logistics = require("../constants/logistics");
const factory = require("../constants/factory");
const defense = require("../constants/defense");
const tasks = require("../constants/tasks");
const powerSpawn = require("../constants/powerSpawn");
const spawn = require("../constants/spawn");
const creeps = require("../constants/creeps");
const labs = require("../constants/labs");
const system = require("../constants/system");
const market = require("../constants/market");
const empire = require("../constants/empire");
check(
  "STORAGE/TERMINAL_* — из constants/logistics",
  constants.STORAGE === logistics.STORAGE &&
    constants.TERMINAL_SUPPLY === logistics.TERMINAL_SUPPLY &&
    constants.TERMINAL_NETWORK === logistics.TERMINAL_NETWORK,
);
check(
  "FACTORY/TOWER/TASK_CONFIG/POWER_SPAWN — из своих доменов",
  constants.FACTORY === factory.FACTORY &&
    constants.TOWER === defense.TOWER &&
    constants.TASK_CONFIG === tasks.TASK_CONFIG &&
    constants.POWER_SPAWN === powerSpawn.POWER_SPAWN,
);
check(
  "квоты пре-спавна и тела крипов — из spawn/creeps",
  constants.SPAWN_QUOTA === spawn.SPAWN_QUOTA &&
    constants.PRESPAWN_THRESHOLD === spawn.PRESPAWN_THRESHOLD &&
    constants.CREEP_BODIES === creeps.CREEP_BODIES &&
    constants.REMOTE === creeps.REMOTE,
);
check(
  "LAB_* — из constants/labs",
  constants.LAB_PLAN === labs.LAB_PLAN &&
    constants.LAB_BINDING === labs.LAB_BINDING &&
    constants.LAB_BOOST === labs.LAB_BOOST,
);
check(
  "CONTROLLER/CACHE/CPU — из constants/system",
  constants.CONTROLLER === system.CONTROLLER &&
    constants.CACHE === system.CACHE &&
    constants.CPU === system.CPU,
);
check(
  "MARKET/X_PURCHASE/LAB_PRIORITY — из constants/market",
  constants.MARKET === market.MARKET &&
    constants.X_PURCHASE === market.X_PURCHASE &&
    constants.LAB_PRIORITY === market.LAB_PRIORITY,
);
check(
  "мутация конфига видна через оба входа (BUY_RESOURCES)",
  constants.MARKET.BUY_RESOURCES === market.MARKET.BUY_RESOURCES,
);
check(
  "EMPIRE — из constants/empire",
  constants.EMPIRE === empire.EMPIRE,
);

// ── 3. Публичный API market.manager ──────────────────────────────────────
console.log("\n3. require(\"./market.manager\") сохранил публичный API");
const EXPECTED_MARKET_API = [
  "run",
  "sellableFrom",
  "bestBuyOrder",
  "bestSellOrder",
  "buyCandidates",
  "collectProtectedResources",
  "isProtectedResource",
  "roomResourceTotal",
  "empireResourceTotal",
  "xTerminalCandidates",
  "pickXTerminal",
  "shouldBuyX",
  "shouldBuyImport",
  "shouldBuyLabImport",
  "labImportHandled",
  "labImportActive",
  "labTerminalCandidates",
  "buyLabImport",
  "isXProtectionEnabled",
];
check(
  "набор функций совпадает",
  JSON.stringify(Object.keys(marketManager)) ===
    JSON.stringify(EXPECTED_MARKET_API),
  Object.keys(marketManager).join(","),
);
check(
  "проданные/купленные помощники — те же функции, что в доменах",
  marketManager.sellableFrom === marketSell.sellableFrom &&
    marketManager.collectProtectedResources ===
      marketSell.collectProtectedResources &&
    marketManager.shouldBuyX === marketBuy.shouldBuyX &&
    marketManager.buyLabImport === marketLabImport.buyLabImport &&
    marketManager.bestSellOrder === marketCore.bestSellOrder &&
    marketManager.roomResourceTotal === marketCore.roomResourceTotal,
);
check(
  "доменные модули не подменяют run()",
  typeof marketManager.run === "function" &&
    marketSell.run === undefined &&
    marketBuy.run === undefined &&
    marketLabImport.run === undefined,
);

// ── 4. Состояние запуска общее для продажи и закупки ─────────────────────
console.log("\n4. Состояние запуска рынка — одно на подсистемы");
marketCore.resetRun();
check(
  "resetRun() обнуляет решение о защите X",
  marketCore.state.xProtection === null &&
    marketCore.state.xTotalCache === 0 &&
    typeof marketCore.state.bookCache === "object",
);
// Решение о защите X принимает продажа (collectProtectedResources), а читает
// закупка (cachedXTotal/isXProtectionEnabled) — через общий объект состояния.
marketCore.state.xProtection = true;
marketCore.state.xTotalCache = 4242;
check(
  "закупка видит решение продажи",
  marketBuy.isXProtectionEnabled() === true &&
    marketBuy.cachedXTotal(market.X_PURCHASE.RESOURCE) === 4242,
);
marketCore.resetRun();
check(
  "после resetRun() закупка считает заново",
  marketCore.state.xProtection === null && marketCore.state.xTotalCache === 0,
);

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
