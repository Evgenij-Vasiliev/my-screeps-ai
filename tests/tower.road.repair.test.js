"use strict";
/**
 * ===================================================
 * TOWER.ROAD.REPAIR.TEST.JS — ремонт дорог башнями (E35S37)
 * ===================================================
 * Симптом: дороги разрушались, потому что комната восстанавливала ~1 тайл за
 * TOWER.REPAIR_INTERVAL: на всю комнату была ОДНА цель, все башни били в неё,
 * а ремонт выполнялся только в тик, кратный 15.
 *
 * Проверяем контракт правки:
 *   1) структура/дорога ремонтируется КАЖДЫЙ тик, а не только в тик интервала;
 *   2) цель башни — третий аргумент (room.manager раздаёт по одной на башню),
 *      он имеет приоритет над общей roomData.damagedTarget;
 *   3) полная структура (hits === hitsMax) не получает интент;
 *   4) в бою (roomData.underAttack) ремонт структур/дорог не делается;
 *   5) стены/валы сохраняют прежний контракт: только в тик интервала.
 *
 * Запуск: node tests/tower.road.repair.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Глобалы Screeps ──────────────────────────────────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.RESOURCE_ENERGY = "energy";
global.TOWER_FALLOFF_RANGE = 10;
global.STRUCTURE_ROAD = "road";

const { TOWER } = require("../constants");
const roleTower = require("../role.tower");

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

/** @param {number} x @param {number} y @param {number} hits @param {number} hitsMax */
function makeStructure(id, structureType, hits, hitsMax, x = 25, y = 25) {
  return { id, structureType, hits, hitsMax, pos: { x, y } };
}

function makeTower(energy = 1000) {
  const repaired = [];
  return {
    repaired,
    tower: {
      pos: {
        x: 25,
        y: 25,
        inRangeTo: (target, range) =>
          Math.max(
            Math.abs(target.pos.x - 25),
            Math.abs(target.pos.y - 25),
          ) <= range,
        findInRange: list => list,
        findClosestByRange: list => list[0] || null,
      },
      store: { energy },
      attack: () => OK,
      heal: () => OK,
      repair: target => {
        repaired.push(target.id);
        return OK;
      },
    },
  };
}

// ── 1. Ремонт структуры/дороги идёт КАЖДЫЙ тик ───────────────────────────
{
  console.log("\n1. Тик НЕ кратен REPAIR_INTERVAL — дорога всё равно ремонтируется");
  const { tower, repaired } = makeTower();
  const road = makeStructure("road1", STRUCTURE_ROAD, 2000, 5000);
  const roomData = { damagedTarget: road };

  for (const time of [100, 101, 102]) {
    global.Game = { time };
    roleTower.run(tower, roomData);
  }

  check(
    "три тика подряд — три интента ремонта дороги",
    repaired.join(",") === "road1,road1,road1",
    repaired.join(","),
  );
}

// ── 2. Своя цель на башню (третий аргумент) ───────────────────────────────
{
  console.log("\n2. Третий аргумент (цель башни) приоритетнее общей damagedTarget");
  const { tower, repaired } = makeTower();
  const roadShared = makeStructure("shared", STRUCTURE_ROAD, 2000, 5000);
  const roadOwn = makeStructure("own", STRUCTURE_ROAD, 1000, 5000);

  global.Game = { time: 101 };
  roleTower.run(tower, { damagedTarget: roadShared }, roadOwn);

  check("башня бьёт в СВОЮ цель", repaired.join(",") === "own", repaired.join(","));
}

// ── 3. Полная структура не получает интент ────────────────────────────────
{
  console.log("\n3. Цель с hits === hitsMax не ремонтируется (интент = зря потраченное действие)");
  const { tower, repaired } = makeTower();
  const fullRoad = makeStructure("full", STRUCTURE_ROAD, 5000, 5000);

  global.Game = { time: 101 };
  roleTower.run(tower, { damagedTarget: fullRoad }, fullRoad);

  check("интентов нет", repaired.length === 0, repaired.join(","));
}

// ── 4. В бою ремонт структур/дорог выключен ──────────────────────────────
{
  console.log("\n4. roomData.underAttack — ремонт дорог не трогает энергию башен");
  const { tower, repaired } = makeTower();
  const road = makeStructure("road1", STRUCTURE_ROAD, 2000, 5000);

  global.Game = { time: 101 };
  roleTower.run(tower, { damagedTarget: road, underAttack: true }, road);

  check("в бою дорога не ремонтируется", repaired.length === 0, repaired.join(","));
}

// ── 5. Стены: прежний интервал сохранён ──────────────────────────────────
{
  console.log("\n5. Стены/валы — только в тик REPAIR_INTERVAL (контракт не изменён)");
  const { tower, repaired } = makeTower();
  const wall = makeStructure("wall1", "constructedWall", 500, 100000);

  global.Game = { time: 101 };
  roleTower.run(tower, { wallTarget: wall, damagedTarget: null });

  const noIntentOffInterval = repaired.length === 0;

  global.Game = { time: 105 }; // 105 % TOWER.REPAIR_INTERVAL === 0
  roleTower.run(tower, { wallTarget: wall, damagedTarget: null });

  check(
    "вне интервала стена не ремонтируется",
    noIntentOffInterval,
    JSON.stringify(repaired),
  );
  check(
    `в тик, кратный ${TOWER.REPAIR_INTERVAL}, стена ремонтируется`,
    repaired.join(",") === "wall1",
    repaired.join(","),
  );
}

// ── 6. Атака по-прежнему выше ремонта ────────────────────────────────────
{
  console.log("\n6. Атака вытесняет ремонт (приоритет не изменился)");
  const { tower, repaired } = makeTower();
  const road = makeStructure("road1", STRUCTURE_ROAD, 2000, 5000);
  const enemy = { id: "enemy", pos: { x: 26, y: 25 } };

  global.Game = { time: 101 };
  roleTower.run(
    tower,
    { hostiles: [enemy], healers: null, woundedCreep: null, damagedTarget: road },
    road,
  );

  check("ремонта нет при враге в зоне", repaired.length === 0, repaired.join(","));
}

console.log(`\nИТОГО: passed=${passed} failed=${failed}`);
if (failed > 0) process.exitCode = 1;
