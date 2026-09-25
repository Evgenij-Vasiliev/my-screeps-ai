"use strict";
/**
 * API-сверка задеплоенного кода (только чтение): GET /api/user/code?branch=test.
 * Запуск: node tests/live.verify.labboost.deploy.js
 * Токен: SCREEPS_TOKEN или .screeps.json (см. screeps.token.js).
 */
const { resolveToken } = require("../screeps.token");
const TOKEN = resolveToken();
const BRANCH = "test";

const CHECKS = [
  // Рынок разбит (аудит, п. 8): market.manager — только run() и бюджет
  // сделок, торговля живёт в market.buy / market.sell / market.labImport,
  // общие помощники — в market.core.
  ["market.buy", "function buyX"],
  ["market.buy", "function shouldBuyX"],
  ["market.core", "function empireResourceTotal"],
  ["market.buy", "function isXProtectionEnabled"],
  ["market.manager", "ЗАКУПКА ИДЁТ ПЕРВОЙ"],
  ["lab.recipes", "function ensureBoostLab"],
  ["lab.recipes", "function priorityLevel"],
  ["lab.recipes", "function isFinalHub"],
  ["terminalNetwork", "prioritizeLabRequests"],
  ["lab.manager", "ensureBoostLab(room)"],
  // Константы разложены по constants/*; проверяем и barrel, и домены.
  ["constants", "X_PURCHASE"],
  ["constants", "LAB_PRIORITY"],
  ["constants/market", "X_PURCHASE"],
  ["constants/labs", "LAB_PLAN"],
  ["constants/labs", "6a0074d69760eb01439b776a"],
  // U добавлен в закупку: минерал U в E37S38 выработан (380 единиц), а U —
  // единственное сырьё добычного буста XUHO2. Готовые бусты добавлены позже:
  // производство X-бустов заморожено логистикой реагентов (LAB_KEEP), поэтому
  // закупка буст-минералов работает как подстраховка.
  ["constants/market", 'BUY_RESOURCES: ["X", "O", "Z", "H", "U", "XKH2O", "XZHO2", "XUHO2"]'],
  ["constants/market", "IMPORT:"],
  ["constants/market", "XKH2O: { LOW: 4500, HIGH: 13500, MAX_AMOUNT: 3000 }"],
  ["constants/market", "BUY_ENERGY_FLOOR: 10000"],
  ["constants/labs", "LAB_BINDING"],
  ["constants/market", "LOW: 10000"],
  ["constants/market", "HIGH: 25000"],
  // Бустовая часть ТЗ: политика с резервами и получение буста из складов комнаты.
  ["constants/labs", 'from: "room"'],
  ["constants/labs", "HUB_RESERVE"],
  ["constants/labs", "ROOM_RESERVE"],
  ["constants/labs", "BOOST_SHIP_AMOUNT"],
  ["terminalNetwork", "collectBoostRequests"],
  ["terminalNetwork", "roomReserve"],
  ["role.miner", "harvestBoostedWork"],
  ["boost.manager", "policyBoostResources"],
  ["lab.recipes", "function ensureTriples"],
  ["lab.recipes", "function reactionReady"],
  ["lab.manager", "ensureTriples(room)"],
  ["lab.manager", "reactionAmount"],
  ["terminalNetwork", "isHubReserve"],
  ["boost.manager", "BOOST_PER_PART = 30"],
  ["room.manager", "labManager.run"],
  ["boost.manager", "BOOST_POLICY"],
  ["traveler", "travelTo"],
  ["task.manager", "TASK_CHAIN"],
];

const NEED = ["main","empire","room.manager","terminalNetwork","market.manager","market.core","market.sell","market.buy","market.labImport","lab.manager","lab.recipes","lab.worker","boost.manager","constants","constants/logistics","constants/factory","constants/defense","constants/tasks","constants/powerSpawn","constants/spawn","constants/creeps","constants/labs","constants/system","constants/market","defense.manager","remote.manager","powerSpawn.manager","factory.manager","cpuMonitor"];

(async () => {
  const url = `https://screeps.com/api/user/code?branch=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, { headers: { "X-Token": TOKEN } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const body = await res.json();
  const code = body.modules || body;
  const names = Object.keys(code).sort();
  console.log("ветка:", BRANCH, "| модулей:", names.length);
  console.log(names.join(" "));
  let miss = 0;
  for (const [mod, needle] of CHECKS) {
    const ok = code[mod] ? String(code[mod]).indexOf(needle) !== -1 : false;
    if (!ok) miss++;
    console.log((ok ? "OK   " : "MISS ") + mod + " :: " + needle);
  }
  const absent = NEED.filter(m => !code[m]);
  console.log("нет модулей:", absent.join(",") || "нет");
  console.log("Итого MISS:", miss);
  if (absent.length || miss) process.exit(1);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
