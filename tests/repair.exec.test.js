"use strict";
/**
 * ===================================================
 * REPAIR.EXEC.TEST.JS — когда задача ремонта считается выполненной
 * ===================================================
 * Пункт 3 плана (docs/REPAIR-PLAN.md:160): «дорогу считать отремонтированной
 * при 3 000 из 5 000, а не при максимуме». В коде это `isDoneRepair`
 * (task/exec.repair.js:53-59) с порогом `ROAD_DONE_HITS = 3000` (:42).
 *
 * Проверяем ровно то, что обещано, и ничего сверх:
 *   1) дорога 3 000 из 5 000 закрывает задачу (DONE) — и БЕЗ интента repair;
 *   2) дорога 2 999 из 5 000 задачу НЕ закрывает (repair вызывается);
 *   3) порог у дорог АБСОЛЮТНЫЙ: 3 000 хитов и на равнине (5 000), и на болоте
 *      (25 000), и на природной скале (750 000) — одна шкала, потому что
 *      дороге «здоровье» не нужно, а доля гнала бы болотную до 15 000, а
 *      скальную до 450 000 хитов;
 *   4) НЕ дорога закрывается только на максимуме, как было: башня 3 000 из
 *      5 000 продолжает задачу;
 *   5) пустой рюкзак на уже отремонтированной дороге → DONE, а не поход
 *      за энергией;
 *   6) связка порогов — общая с башней полоса (constants/defense.js:63-66,
 *      REPAIR): постановка ниже 2 000 хитов, завершение на 3 000, поэтому
 *      дорога 3 000 из 5 000 новую задачу не получает и очередь не крутится
 *      вхолостую;
 *   7) пункт 4 плана: у дорог абсолютный порог постановки, у не-дорог — прежняя
 *      доля 0.5 от hitsMax (раздел 6);
 *   8) пункт 5 плана: цель, которую в этом тике чинит башня, задачу не получает
 *      (раздел 7).
 *
 * Откат правки: git checkout -- task/exec.repair.js
 * Запуск: node tests/repair.exec.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("energySource") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

// Глобалы, которые читает исполнитель ремонта и его зависимости.
// Список типов структур повторяет tests/scanner.cache.test.js: scanner.js
// читает DAMAGED_TYPE_NAMES уже на загрузке модуля (scanner.js:47-58), а его
// тянет task/gen.repair.js — он нужен секции 6.
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.RESOURCE_ENERGY = "energy";
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_ROAD = "road";
global.STRUCTURE_WALL = "wall";
global.STRUCTURE_RAMPART = "rampart";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";
global.FIND_STRUCTURES = 2;
global.FIND_SOURCES = 3;
global.FIND_MINERALS = 4;

global.Memory = { creeps: {}, rooms: {} };

// Цели живут здесь: resolveTarget резолвит id через Game.getObjectById.
const objects = {};
global.Game = {
  time: 1000,
  creeps: {},
  getObjectById: id => objects[id] || null,
};

const { executeRepairStructures } = require("../task/exec.repair");
const taskManager = require("../task.manager");
const { generateRepairStructures } = require("../task/gen.repair");
const { pickRepairTarget } = require("../room/repair");

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

/** Очередь ремонта комнаты (или пустой массив). */
function queueOf(roomName) {
  const tasks = (Memory.rooms[roomName] || {}).tasks;
  return (tasks && tasks.repairStructures) || [];
}

/** Содержимое очереди — для сообщения об упавшей проверке. */
function dump(roomName) {
  return JSON.stringify(queueOf(roomName));
}

/** Задача ремонта на структуру: больше исполнителю ничего не нужно. */
function makeTask(id, structureType, hits, hitsMax) {
  objects[id] = { id, structureType, hits, hitsMax };
  return { type: "repair", targetId: id, taskId: "t_" + id };
}

/**
 * Крип со счётчиком интентов. `working` не задан — состояние как у только что
 * взятой задачи (исполнитель выставит его сам по рюкзаку).
 */
function makeCreep(energy, working) {
  const creep = {
    name: "worker_test",
    memory: working === undefined ? {} : { working },
    store: { energy },
    intents: { repair: 0 },
    room: { name: "W1N1", storage: null },
    repair: function () {
      creep.intents.repair++;
      return global.OK;
    },
    travelTo: function () {},
  };
  global.Game.creeps[creep.name] = creep;
  return creep;
}

function runCase(id, structureType, hits, hitsMax, energy, working) {
  const task = makeTask(id, structureType, hits, hitsMax);
  const creep = makeCreep(energy, working);
  return { result: executeRepairStructures(creep, task), creep };
}

console.log("1. Дорога 3 000 из 5 000: задача закрыта, энергии не потрачено");
{
  const c = runCase("road_done", STRUCTURE_ROAD, 3000, 5000, 1600, true);
  check("результат DONE", c.result === "DONE", c.result);
  check(
    "интент repair НЕ вызывался",
    c.creep.intents.repair === 0,
    `repair=${c.creep.intents.repair}`,
  );
  check(
    "состояние working снято",
    c.creep.memory.working === undefined,
    JSON.stringify(c.creep.memory),
  );
}

console.log("\n2. Дорога 2 999 из 5 000: задача продолжается");
{
  const c = runCase("road_undone", STRUCTURE_ROAD, 2999, 5000, 1600, true);
  check("результат CONTINUE", c.result === "CONTINUE", c.result);
  check(
    "интент repair вызван ровно один раз",
    c.creep.intents.repair === 1,
    `repair=${c.creep.intents.repair}`,
  );
}

console.log("\n3. Порог завершения у дорог АБСОЛЮТНЫЙ: 3 000 хитов при любом максимуме");
{
  const plain = runCase("road_plain_abs", STRUCTURE_ROAD, 3000, 5000, 1600, true);
  check("равнинная дорога 3 000 из 5 000 — DONE", plain.result === "DONE", plain.result);

  const swamp = runCase("road_swamp", STRUCTURE_ROAD, 3000, 25000, 1600, true);
  check(
    "болотная дорога 3 000 из 25 000 — DONE (доля гнала бы до 15 000)",
    swamp.result === "DONE",
    swamp.result,
  );

  const swampLow = runCase("road_swamp_low", STRUCTURE_ROAD, 2999, 25000, 1600, true);
  check("болотная дорога 2 999 из 25 000 — CONTINUE", swampLow.result === "CONTINUE", swampLow.result);

  const rock = runCase("road_rock", STRUCTURE_ROAD, 3000, 750000, 1600, true);
  check(
    "дорога на скале 3 000 из 750 000 — DONE (доля гнала бы до 450 000)",
    rock.result === "DONE",
    rock.result,
  );

  // Дорога, оставшаяся в очереди с прежних времён выше порога, закрывает
  // задачу сразу и без интента: это самолечение очереди после правки.
  const stale = runCase("road_stale", STRUCTURE_ROAD, 446600, 750000, 1600, true);
  check(
    "скальная дорога 446 600 из 750 000 — DONE без единого интента",
    stale.result === "DONE" && stale.creep.intents.repair === 0,
    `${stale.result} / repair=${stale.creep.intents.repair}`,
  );
}

console.log("\n4. Не дорога — прежнее поведение: только максимум хитов");
{
  const tower = runCase("tower_mid", STRUCTURE_TOWER, 3000, 5000, 1600, true);
  check("башня 3 000 из 5 000 — CONTINUE", tower.result === "CONTINUE", tower.result);
  check("интент repair вызван", tower.creep.intents.repair === 1, `repair=${tower.creep.intents.repair}`);

  const towerFull = runCase("tower_full", STRUCTURE_TOWER, 5000, 5000, 1600, true);
  check("башня 5 000 из 5 000 — DONE", towerFull.result === "DONE", towerFull.result);
}

console.log("\n5. Пустой рюкзак на отремонтированной дороге: DONE, а не поход за энергией");
{
  const c = runCase("road_done_empty", STRUCTURE_ROAD, 5000, 5000, 0, false);
  check("результат DONE", c.result === "DONE", c.result);
  check(
    "интент repair НЕ вызывался",
    c.creep.intents.repair === 0,
    `repair=${c.creep.intents.repair}`,
  );
}

console.log("\n6. Пункт 4: у дорог порог постановки АБСОЛЮТНЫЙ (2 000 хитов), у остальных — доля 0.5");
{
  const ROOM = "W1N1";
  Memory.rooms[ROOM] = { tasks: {} };

  const road = { id: "road_recheck", structureType: STRUCTURE_ROAD, hits: 3000, hitsMax: 5000 };
  objects[road.id] = road;

  generateRepairStructures({ roomName: ROOM, damagedStructures: [road] });
  check("дорога 3 000 из 5 000 — задачи нет", queueOf(ROOM).length === 0, dump(ROOM));

  // 2 400 из 5 000 — это 48 %, то есть НИЖЕ прежнего порога-доли 0.5: по
  // старому правилу задача была бы, по новому (хиты, не доля) — нет. Именно
  // эта проверка отличает абсолютный порог от доли.
  road.hits = 2400;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [road] });
  check(
    "дорога 2 400 из 5 000 (48 %) — задачи нет (по доле была бы)",
    queueOf(ROOM).length === 0,
    dump(ROOM),
  );

  road.hits = 2000;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [road] });
  check(
    "дорога ровно 2 000 — задачи нет (порог строгий: hits < 2 000)",
    queueOf(ROOM).length === 0,
    dump(ROOM),
  );

  road.hits = 1999;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [road] });
  check("дорога 1 999 — задача поставлена", queueOf(ROOM).length === 1, dump(ROOM));

  // Доля от максимума для дороги больше НЕ применяется: болотная дорога
  // (25 000) при 4 000 хитов — это 16 %, выше порога 50 %, и по старому правилу
  // задачи не было бы; по новому — 4 000 > 2 000, задачи тоже нет. Обе стороны
  // проверяем: 1 900 из 25 000 (7,6 %) задачу ПОЛУЧАЕТ.
  const swamp = { id: "road_swamp_task", structureType: STRUCTURE_ROAD, hits: 1900, hitsMax: 25000 };
  objects[swamp.id] = swamp;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [swamp] });
  check(
    "болотная дорога 1 900 из 25 000 — задача есть (доля не применяется)",
    queueOf(ROOM).some(t => t && t.targetId === swamp.id),
    dump(ROOM),
  );

  // А НЕ дорога по-прежнему считается долей: башня 3 000 из 5 000 — это 60 %,
  // выше порога 0.5, задачи нет; на 2 400 из 5 000 — задача есть.
  const tower = { id: "tower_task", structureType: STRUCTURE_TOWER, hits: 3000, hitsMax: 5000 };
  objects[tower.id] = tower;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [tower] });
  check(
    "башня 3 000 из 5 000 — задачи нет (доля 0.5 сохранена)",
    !queueOf(ROOM).some(t => t && t.targetId === tower.id),
    dump(ROOM),
  );

  tower.hits = 2400;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [tower] });
  check(
    "башня 2 400 из 5 000 — задача есть",
    queueOf(ROOM).some(t => t && t.targetId === tower.id),
    dump(ROOM),
  );

  // Повторный вызов в том же тике дублей не создаёт (идемпотентность).
  const before = queueOf(ROOM).length;
  generateRepairStructures({ roomName: ROOM, damagedStructures: [road, swamp, tower] });
  check("повторный вызов дублей не создал", queueOf(ROOM).length === before, dump(ROOM));

  check(
    "очередь repairStructures — индекс 7 в TASK_CHAIN",
    taskManager.TASK_CHAIN.indexOf("repairStructures") === 7,
    String(taskManager.TASK_CHAIN.indexOf("repairStructures")),
  );
}

/*
 * Пункт 5: не создавать repair-задачу на цель, которую в этом тике чинит
 * башня. Генератор спрашивает ту же функцию выбора, что и runTowerLogic
 * (room/towers.js:142) — pickRepairTarget от того же roomState.
 *
 * Гейты проверяются отдельно, чтобы пропуск не оставил структуру вообще без
 * ремонта: башня без энергии (порог role.tower.js:34) и выключенные башни
 * (systems.towers = false).
 */
console.log("\n7. Пункт 5: цель башни задачу не получает");
{
  const ROOM = "W1N2";
  Memory.rooms[ROOM] = { tasks: {} };

  const id = "road_tower_target";
  objects[id] = { id, structureType: STRUCTURE_ROAD, hits: 1000, hitsMax: 5000 };

  // Числа кэша: ровно та дорога, которую выберет pickRepairTarget (потеря
  // 4 000/5 000 = 80 %, дефицит 4 000 ≥ TOWER.REPAIR_POWER = 800).
  const cache = {
    damagedRoadIds: [id],
    damagedRoadHits: Int32Array.from([1000]),
    damagedRoadHitsMax: Int32Array.from([5000]),
    damagedRoadCount: 1,
  };
  const state = {
    roomName: ROOM,
    _structureCache: cache,
    rampartIds: [],
    storage: null,
    terminal: null,
    towers: [{ store: { energy: 800 } }],
  };

  const picked = pickRepairTarget(state);
  check(
    "башня выбрала бы именно эту цель",
    !!picked && picked.id === id,
    picked ? String(picked.id) : "null",
  );

  generateRepairStructures(state);
  check(
    "задачи на цель башни нет",
    !queueOf(ROOM).some(t => t && t.targetId === id),
    dump(ROOM),
  );

  // Башня есть, но энергии не больше порога роли — чинить не будет.
  const id2 = "road_tower_empty";
  objects[id2] = { id: id2, structureType: STRUCTURE_ROAD, hits: 1000, hitsMax: 5000 };
  cache.damagedRoadIds = [id2];
  state.towers = [{ store: { energy: 700 } }];

  generateRepairStructures(state);
  check(
    "башня без энергии (700 ≤ REPAIR_ENERGY_MIN) — задача поставлена",
    queueOf(ROOM).some(t => t && t.targetId === id2),
    dump(ROOM),
  );

  // Башен нет вовсе — пропуска тоже нет.
  const id3 = "road_no_towers";
  objects[id3] = { id: id3, structureType: STRUCTURE_ROAD, hits: 1000, hitsMax: 5000 };
  cache.damagedRoadIds = [id3];
  state.towers = [];

  generateRepairStructures(state);
  check(
    "башен нет — задача поставлена",
    queueOf(ROOM).some(t => t && t.targetId === id3),
    dump(ROOM),
  );

  // Башни выключены тумблером — пропуска быть не должно.
  const id4 = "road_towers_off";
  objects[id4] = { id: id4, structureType: STRUCTURE_ROAD, hits: 1000, hitsMax: 5000 };
  cache.damagedRoadIds = [id4];
  state.towers = [{ store: { energy: 800 } }];

  const systems = require("../systems");
  const savedTowers = systems.towers;
  systems.towers = false;

  try {
    generateRepairStructures(state);
  } finally {
    systems.towers = savedTowers;
  }

  check(
    "systems.towers = false — задача поставлена",
    queueOf(ROOM).some(t => t && t.targetId === id4),
    dump(ROOM),
  );
  check("тумблер возвращён", systems.towers === savedTowers, String(systems.towers));
}

/*
 * ОДНА ЦЕЛЬ (синхронизация с башней): и воркер, и башня читают ОДНИ пороги из
 * барреля — constants/defense.js, REPAIR. Проверяется сдвигом самого значения:
 * изменение REPAIR.ROAD_DONE_HITS обязано сдвинуть обе стороны сразу.
 */
console.log("\n8. Одна цель: воркер и башня читают общий порог (REPAIR)");
{
  const { REPAIR } = require("../constants");
  const savedDone = REPAIR.ROAD_DONE_HITS;

  try {
    REPAIR.ROAD_DONE_HITS = 4000;

    // Воркер: дорога 3 500 при новом пороге больше не «отремонтирована».
    const w = runCase("road_sync", STRUCTURE_ROAD, 3500, 5000, 1600, true);
    check("воркер: 3 500 при пороге 4 000 — CONTINUE", w.result === "CONTINUE", w.result);

    // Башня: та же дорога снова становится её целью (боевая линия её отсекала).
    const id = "road_sync_tower";
    objects[id] = { id, structureType: STRUCTURE_ROAD, hits: 3500, hitsMax: 5000 };
    const picked = pickRepairTarget({
      roomName: "W1N3",
      _structureCache: {
        damagedRoadIds: [id],
        damagedRoadHits: Int32Array.from([3500]),
        damagedRoadHitsMax: Int32Array.from([5000]),
        damagedRoadCount: 1,
      },
      rampartIds: [],
      storage: null,
      terminal: null,
      towers: [{ store: { energy: 800 } }],
    });
    check(
      "башня: та же дорога — снова цель",
      !!picked && picked.id === id,
      picked ? String(picked.id) : "null",
    );
  } finally {
    REPAIR.ROAD_DONE_HITS = savedDone;
  }

  check("порог возвращён", REPAIR.ROAD_DONE_HITS === savedDone, String(REPAIR.ROAD_DONE_HITS));

  // При боевом пороге 3 000 та же дорога (3 500) целью башни НЕ становится.
  const id2 = "road_sync_off";
  objects[id2] = { id: id2, structureType: STRUCTURE_ROAD, hits: 3500, hitsMax: 5000 };
  const picked2 = pickRepairTarget({
    roomName: "W1N3",
    _structureCache: {
      damagedRoadIds: [id2],
      damagedRoadHits: Int32Array.from([3500]),
      damagedRoadHitsMax: Int32Array.from([5000]),
      damagedRoadCount: 1,
    },
    rampartIds: [],
    storage: null,
    terminal: null,
    towers: [{ store: { energy: 800 } }],
  });
  check(
    "при боевом пороге 3 000 дорога 3 500 целью не становится",
    picked2 === null,
    picked2 ? String(picked2.id) : "null",
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
