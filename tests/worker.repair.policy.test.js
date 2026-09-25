"use strict";
/**
 * ===================================================
 * WORKER.REPAIR.POLICY.TEST.JS — тело воркера + C2 (дороги башням)
 * ===================================================
 * Контракт, зафиксированный решением владельца:
 *
 *   B) тело воркера — перевозчик, а не ремонтник: {work:2, carry:10, move:12},
 *      цена 1300 = WORKER.NORMAL_BODY_ENERGY (по нему spawn.manager решает,
 *      поднимать ли комнату аварийным телом — рассинхрон ломает аварийный спавн);
 *   C2) дороги ремонтируют БАШНИ, а не воркеры: генератор не создаёт на них
 *      задач, исполнитель снимает уже стоящие (SKIP), а башня выбирает цель по
 *      ДОЛЕ остатка хитов, иначе дорога с hitsMax 5000 не доходит до неё никогда.
 *
 * Основание (живой shard3, tick ~83161815): 80 задач ремонта, все 80 — дороги
 * E35S37, долг 258k хитов = ~2.6k энергии при REPAIR_COST 0.01; WORK у воркера
 * нужен только repair/build/upgrade, стройки нет, апгрейд включается лишь при
 * ticksToDowngrade < 50000 и его не было ни в одной комнате.
 *
 * Запуск: node tests/worker.repair.policy.test.js
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

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_TARGET = -7;
global.RESOURCE_ENERGY = "energy";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_SPAWN = "spawn";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";

global.Memory = { rooms: {} };
const WORLD = { objects: {} };
global.Game = {
  time: 1000,
  creeps: {},
  getObjectById: (id) => WORLD.objects[id] || null,
};

let passed = 0;
let failed = 0;
function ok(name, condition, extra) {
  if (condition) {
    passed++;
    console.log("  ok — " + name);
  } else {
    failed++;
    console.log("  FAIL — " + name + (extra ? " [" + extra + "]" : ""));
  }
}

function makeStructure(id, structureType, hits, hitsMax) {
  const s = { id, structureType, hits, hitsMax, pos: { x: 10, y: 10, roomName: "R" } };
  WORLD.objects[id] = s;
  return s;
}

const { CREEP_BODIES, WORKER } = require("../constants");
const taskGenerators = require("../task.generators");
const executors = require("../task.executors").executors;

// ── 1. Тело воркера и его цена ───────────────────────────────────────────
{
  console.log("\n1. Тело воркера: перевозчик (work 2 / carry 10 / move 12)");
  const body = CREEP_BODIES.worker;
  ok(
    "состав тела совпадает с решением",
    body.work === 2 && body.carry === 10 && body.move === 12,
    JSON.stringify(body),
  );
  const cost = body.work * 100 + body.carry * 50 + body.move * 50;
  ok("цена тела 1300", cost === 1300, String(cost));
  ok(
    "WORKER.NORMAL_BODY_ENERGY совпадает с ценой тела",
    WORKER.NORMAL_BODY_ENERGY === cost,
    `${WORKER.NORMAL_BODY_ENERGY} vs ${cost}`,
  );
  // Усталость на равнине: 2 «тяжёлых» части на каждую не-MOVE часть.
  const heavy = body.work + body.carry;
  ok(
    "на равнине усталости нет без буста (12 MOVE × 2 ≥ 2 × 12)",
    body.move * 2 >= heavy * 2,
    `${body.move * 2} vs ${heavy * 2}`,
  );
}

// ── 2. Генератор не создаёт задачи ремонта на дороги ─────────────────────
{
  console.log("\n2. C2: дороги не попадают в очередь воркеров");
  Memory.rooms.R = { tasks: {} };
  const road = makeStructure("road1", STRUCTURE_ROAD, 2500, 5000); // 50 %
  const roadCritical = makeStructure("road2", STRUCTURE_ROAD, 300, 5000); // 6 %
  const lab = makeStructure("lab1", STRUCTURE_LAB, 600, 1500); // 40 %
  const spawn = makeStructure("spawn1", STRUCTURE_SPAWN, 4000, 5000); // 80 %

  taskGenerators.generateRepairStructures({
    roomName: "R",
    damagedStructures: [road, roadCritical, lab, spawn],
  });

  const queue = (Memory.rooms.R.tasks.repairStructures || []).map((t) => t.targetId);
  ok("задача на повреждённую лабу создана", queue.indexOf("lab1") !== -1, queue.join(","));
  ok("задача на дорогу 50 % НЕ создана", queue.indexOf("road1") === -1, queue.join(","));
  ok(
    "задача на дорогу 6 % тоже НЕ создана (исключение без порога-лазейки)",
    queue.indexOf("road2") === -1,
    queue.join(","),
  );
  ok("здоровая структура (80 %) не попала", queue.indexOf("spawn1") === -1, queue.join(","));
  ok("в очереди ровно одна задача", queue.length === 1, String(queue.length));
}

// ── 3. Исполнитель снимает уже стоящие дорожные задачи ───────────────────
{
  console.log("\n3. C2: исполнитель возвращает SKIP на дорогу");
  const creep = {
    memory: {},
    store: { energy: 300, getFreeCapacity: () => 0 },
    room: { name: "R", storage: null, terminal: null },
    repair: () => OK,
    travelTo: () => OK,
  };

  const roadResult = executors.repairStructures(creep, {
    type: "repair",
    targetId: "road1",
  });
  ok("дорога → SKIP (задача снимется)", roadResult === "SKIP", String(roadResult));

  const labResult = executors.repairStructures(creep, {
    type: "repair",
    targetId: "lab1",
  });
  ok(
    "повреждённая лаба → CONTINUE (воркер ремонтирует как раньше)",
    labResult === "CONTINUE",
    String(labResult),
  );
}

// ── 4. Башня обязана видеть дорогу ───────────────────────────────────────
{
  console.log("\n4. C2: цель башни — по доле остатка хитов, дороги в списке");
  const roomSrc = fs.readFileSync(path.join(ROOT, "room.manager.js"), "utf8");
  ok(
    "room.manager считает долю hits/hitsMax (иначе дорога не доходит до башни)",
    roomSrc.includes("s.hits / s.hitsMax"),
  );
  ok(
    "дороги собираются в damagedStructures (room.manager.js)",
    roomSrc.includes("collectDamaged(roads, damagedStructures)"),
  );
  const towerSrc = fs.readFileSync(path.join(ROOT, "role.tower.js"), "utf8");
  ok(
    "башня ремонтирует damagedTarget (role.tower.js)",
    towerSrc.includes("tower.repair(damagedTarget)"),
  );
}

// ── 5. Воркер — фолбэк для того, чего не достаёт башня ───────────────────
{
  console.log("\n5. Воркер ремонтирует только то, что вне радиуса башен");
  global.TOWER_FALLOFF_RANGE = 20;

  Memory.rooms.R = { tasks: {} };
  const tower = { pos: { x: 25, y: 25 } }; // башня в центре комнаты

  // Внутри радиуса (чебышёв 15 ≤ 20) — это работа башни.
  const nearLab = makeStructure("labNear", STRUCTURE_LAB, 600, 1500);
  nearLab.pos = { x: 10, y: 10, roomName: "R" };

  // Вне радиуса (чебышёв max(24,24) = 24 > 20) — башня не достанет никогда.
  const farLab = makeStructure("labFar", STRUCTURE_LAB, 600, 1500);
  farLab.pos = { x: 1, y: 1, roomName: "R" };

  taskGenerators.generateRepairStructures({
    roomName: "R",
    damagedStructures: [nearLab, farLab],
    towers: [tower],
  });

  const queue = (Memory.rooms.R.tasks.repairStructures || []).map(
    (t) => t.targetId,
  );
  ok(
    "структура в радиусе башни задачи не получила",
    queue.indexOf("labNear") === -1,
    queue.join(","),
  );
  ok(
    "структура вне радиуса башни — задача воркеру создана",
    queue.indexOf("labFar") !== -1,
    queue.join(","),
  );
  ok("в очереди ровно одна задача", queue.length === 1, queue.join(","));

  // Комната без башен: воркер — единственный ремонтник, задачи создаются.
  Memory.rooms.R = { tasks: {} };
  taskGenerators.generateRepairStructures({
    roomName: "R",
    damagedStructures: [nearLab],
    towers: [],
  });
  const noTowerQueue = (Memory.rooms.R.tasks.repairStructures || []).map(
    (t) => t.targetId,
  );
  ok(
    "в комнате без башен задача всё равно создаётся (иначе не отремонтирует никто)",
    noTowerQueue.indexOf("labNear") !== -1,
    noTowerQueue.join(","),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
