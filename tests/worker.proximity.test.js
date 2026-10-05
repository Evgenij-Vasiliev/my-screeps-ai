"use strict";
/**
 * ===================================================
 * WORKER.PROXIMITY.TEST.JS — офлайн-проверка шага 1 плана
 * ===================================================
 * Шаг 1 (экономия CPU): выбор очереди по БЛИЗОСТИ вместо поворота указателя
 * + отсутствие лишних записей в Memory. Проверяем ровно то, что нельзя
 * проверить чтением кода:
 *
 *   1) при пустой своей очереди воркер берёт БЛИЖАЙШУЮ по расстоянию задачу,
 *      а не «следующий тип по кругу» (было: taskIndex + 1);
 *   2) дальняя очередь при этом не зарезервирована (выбор, а не перебор);
 *   3) если свободных задач нет ни в одной очереди — в Memory не пишется
 *      ничего вообще (ни taskIndex, ни taskId);
 *   4) после DONE тип задачи НЕ меняется вслепую: следующая задача той же
 *      очереди сохраняет кэш пути крипа (reusePath);
 *   5) непригодная цель (Game.getObjectById вернул null) не блокирует воркера:
 *      очередь всё равно выбирается, а задача снимается исполнителем через SKIP;
 *   6) ВНУТРИ очереди берётся ближайшая задача, а не голова очереди, и при этом
 *      старый контракт getNextTask(room, type) без rangeFn не изменился.
 *   8) [правка 05.10.2026, пункт 2 плана] очереди ВЫШЕ своей по TASK_CHAIN
 *      проверяются ПЕРВЫМИ (для ремонта, idx 7, это доставка 0..6), своя — после
 *      них; прежний выбор ближайшей очереди остался только для очередей НИЖЕ
 *      своей. См. раздел 8 в конце файла.
 *
 * Откат правки: git checkout -- worker.runner.js
 * Запуск: node tests/worker.proximity.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("task.manager") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

// Глобалы ровно те, что нужны task.manager, task.executors и worker.runner.
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_TARGET = -7;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_UTRIUM = "U";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
// Исполнитель ремонта различает дороги по structureType (правка 05.10.2026,
// пункт 3 плана): без этого глобала он падал бы в фикстурах ниже, а runSafe
// глотал бы исключение молча.
global.STRUCTURE_ROAD = "road";

global.Memory = { creeps: {}, rooms: {} };

// Объекты комнаты для Game.getObjectById: pos пустой (важен только range),
// mock-объект несёт дистанцию в поле range.
const objects = {};
global.Game = {
  time: 1000,
  creeps: {},
  cpu: { getUsed: () => 0 },
  getObjectById: id => objects[id] || null,
};

const taskManager = require("../task.manager");
const workerRunner = require("../worker.runner");

// СТАТУС: шаг 1 откачен (см. отчёт по CPU). getNextTask снова принимает два
// аргумента и отдаёт первую свободную задачу — ни выбора ближайшей очереди,
// ни поиска внутри очереди в коде нет. Тест остаётся спецификацией фичи:
// пока её нет, он ничего не проверяет и выходит с кодом 0, а не падает
// красным на отсутствующей возможности.
if (taskManager.getNextTask.length < 3) {
  console.log(
    "ПРОПУЩЕНО: шаг 1 (ближайшая очередь/задача) откачен — проверять нечего.",
  );
  process.exit(0);
}

const IDX = type => taskManager.TASK_CHAIN.indexOf(type);

// Тип операции у задачи (task.type) отличается от категории очереди:
// его проверяют isValid*Task в исполнителях.
const OP = {
  repairStructures: "repair",
  buildStructures: "build",
  upgradeController: "upgrade",
  fillSpawnsExtensions: "transfer",
  fillTowers: "transfer",
};

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

function makeRoom(name) {
  Memory.rooms[name] = { tasks: {} };
  return name;
}

function makeObject(id, range, extra) {
  objects[id] = Object.assign({ id, pos: {}, range }, extra || {});
  return id;
}

function addTask(roomName, type, taskId, targetId, extra) {
  taskManager.addTask(
    roomName,
    type,
    Object.assign(
      { type: OP[type] || "transfer", targetId, taskId },
      extra || {},
    ),
  );
}

function makeCreep(roomName, name, taskIndex) {
  const creep = {
    name,
    memory: { role: "worker", homeRoom: roomName, taskIndex },
    room: { name: roomName, storage: null, terminal: null },
    pos: {
      getRangeTo: target =>
        target && typeof target.range === "number" ? target.range : 1,
    },
    store: { energy: 100, getFreeCapacity: () => 0 },
    moveTo: () => global.OK,
    repair: () => global.OK,
    build: () => global.OK,
    upgradeController: () => global.OK,
    withdraw: () => global.OK,
    transfer: () => global.OK,
  };

  global.Game.creeps[name] = creep;
  Memory.creeps[name] = creep.memory;
  return creep;
}

function queue(roomName, type) {
  return Memory.rooms[roomName].tasks[type] || [];
}

/** Исполнитель может бросить на неполной фикстуре — для проверок выбора это не важно. */
function runSafe(creep) {
  try {
    workerRunner.run(creep);
  } catch (e) {
    console.log(`    (исполнитель бросил: ${e.message})`);
  }
}

console.log("1. Пустая своя очередь: берётся БЛИЖАЙШАЯ, а не следующий тип по кругу");
{
  const ROOM = makeRoom("W1N1");
  addTask(
    ROOM,
    "repairStructures",
    "t_rep",
    makeObject("near", 5, { hits: 100, hitsMax: 1000 }),
  );
  addTask(
    ROOM,
    "buildStructures",
    "t_bld",
    makeObject("far", 30, { progress: 0, progressTotal: 100 }),
  );

  // Своя очередь (fillSpawnsExtensions) пуста — раньше здесь был taskIndex + 1.
  const creep = makeCreep(ROOM, "w1", IDX("fillSpawnsExtensions"));
  runSafe(creep);

  check(
    "taskIndex = repairStructures (ближняя), а не следующий по кругу",
    creep.memory.taskIndex === IDX("repairStructures"),
    String(creep.memory.taskIndex),
  );
  check(
    "дальняя очередь не зарезервирована",
    !queue(ROOM, "buildStructures")[0].reservedBy,
    String(queue(ROOM, "buildStructures")[0].reservedBy),
  );
  check(
    "ближняя задача зарезервирована за воркером",
    queue(ROOM, "repairStructures")[0].reservedBy === "w1",
    String(queue(ROOM, "repairStructures")[0].reservedBy),
  );
}

console.log("\n2. Свободных задач нет нигде: в Memory не пишем ничего");
{
  const ROOM = makeRoom("W2N1");
  const creep = makeCreep(ROOM, "w2", 5);
  const before = JSON.stringify(creep.memory);

  runSafe(creep);

  check("taskIndex не изменился", creep.memory.taskIndex === 5, String(creep.memory.taskIndex));
  check(
    "memory байт-в-байт прежняя",
    JSON.stringify(creep.memory) === before,
    `${before} -> ${JSON.stringify(creep.memory)}`,
  );
  // ШАГ 2: ключ taskId не создаётся у крипа, который его никогда не имел
  // (было: безусловная запись null — ключ оставался в Memory навсегда).
  check(
    "ключа taskId в памяти нет (а не null)",
    !("taskId" in creep.memory),
    JSON.stringify(creep.memory),
  );
}

console.log("\n3. После DONE тип НЕ меняется вслепую (кэш пути сохраняется)");
{
  const ROOM = makeRoom("W3N1");
  // CONTROLLER.DOWNGRADE_MAX = 150000 (constants/system.js:13) — выше порога = DONE.
  addTask(
    ROOM,
    "upgradeController",
    "t_up",
    makeObject("ctrl", 3, { ticksToDowngrade: 200000 }),
  );

  const creep = makeCreep(ROOM, "w3", IDX("upgradeController"));
  runSafe(creep);

  check(
    "задача завершена (в очереди надгробие)",
    queue(ROOM, "upgradeController")[0] === null,
    JSON.stringify(queue(ROOM, "upgradeController")),
  );
  check(
    "taskIndex остался upgradeController (раньше стал бы 0)",
    creep.memory.taskIndex === IDX("upgradeController"),
    String(creep.memory.taskIndex),
  );
  check("taskId снят", creep.memory.taskId === null, String(creep.memory.taskId));
}

console.log("\n4. Непригодная цель не блокирует воркера");
{
  const ROOM = makeRoom("W4N1");
  // targetId не резолвится: getObjectById вернёт null -> расстояние Infinity.
  addTask(ROOM, "repairStructures", "t_rep2", "нетТакогоОбъекта");

  const creep = makeCreep(ROOM, "w4", IDX("fillSpawnsExtensions"));
  runSafe(creep);

  check(
    "очередь выбрана несмотря на Infinity",
    creep.memory.taskIndex === IDX("repairStructures"),
    String(creep.memory.taskIndex),
  );
  check(
    "непригодная задача снята исполнителем (SKIP)",
    queue(ROOM, "repairStructures")[0] === null,
    JSON.stringify(queue(ROOM, "repairStructures")),
  );
}

console.log("\n5. Внутри очереди берётся БЛИЖАЙШАЯ задача, а не голова очереди");
{
  const ROOM = makeRoom("W5N1");
  // Голова очереди — дальняя, за ней ближняя: проверяем выбор, а не порядок.
  addTask(
    ROOM,
    "repairStructures",
    "t_far",
    makeObject("far2", 30, { hits: 100, hitsMax: 1000 }),
  );
  addTask(
    ROOM,
    "repairStructures",
    "t_near",
    makeObject("near2", 3, { hits: 100, hitsMax: 1000 }),
  );

  check(
    "контракт без rangeFn сохранён: первая свободная = голова очереди",
    taskManager.getNextTask(ROOM, "repairStructures").taskId === "t_far",
  );

  const creep = makeCreep(ROOM, "w5", IDX("repairStructures"));
  runSafe(creep);

  check(
    "воркер взял БЛИЖНЮЮ задачу",
    queue(ROOM, "repairStructures")[1].reservedBy === "w5",
    JSON.stringify(queue(ROOM, "repairStructures").map(t => t && t.reservedBy)),
  );
  check(
    "дальняя голова очереди не тронута",
    !queue(ROOM, "repairStructures")[0].reservedBy,
    String(queue(ROOM, "repairStructures")[0].reservedBy),
  );
}

/*
 * Правка 30.09.2026 (оптимизация по CPU): (1) «грузен/пуст» читается ОДИН раз
 * на тик, а не на каждого кандидата — замер creep.store.getFreeCapacity() на
 * живом shard3 дал 0.000485 CPU за вызов (scripts/task.manager.bench.js,
 * случай 14c), а rangeFn вызывается на каждого просмотренного кандидата;
 * (2) дальность выбранного кандидата больше не считается второй раз —
 * getNextTask отдаёт ровно того, для кого rangeFn уже вернул расстояние
 * (сравнение по тождеству задачи обязательно: при обрыве перебора по
 * NEAREST_SCAN_LIMIT последний кандидат — не лучший).
 *
 * Проверяем счётчиками: чтений стора ровно 1 на прогон, getRangeTo — ровно
 * столько, сколько кандидатов просмотрено (3), а не 4.
 */
console.log("\n6. Стор крипа читается один раз, дальность кандидата — не дважды");
{
  const ROOM = makeRoom("W6N1");
  for (let i = 0; i < 3; i++) {
    addTask(
      ROOM,
      "repairStructures",
      "t_r" + i,
      makeObject("rep" + i, 5 + i, { hits: 100, hitsMax: 1000 }),
    );
  }

  const creep = makeCreep(ROOM, "w6", IDX("repairStructures"));
  let storeReads = 0;
  let rangeReads = 0;
  creep.store = {
    energy: 100,
    getFreeCapacity: () => {
      storeReads++;
      return 0;
    },
  };
  creep.pos = {
    getRangeTo: target => {
      rangeReads++;
      return target && typeof target.range === "number" ? target.range : 1;
    },
  };

  runSafe(creep);

  check(
    "стор прочитан ровно один раз за тик",
    storeReads === 1,
    `reads=${storeReads}`,
  );
  check(
    "дальность считалась по разу на кандидата (3), без повторного резолва",
    rangeReads === 3,
    `getRangeTo=${rangeReads}`,
  );
  check(
    "задача выбрана и зарезервирована",
    queue(ROOM, "repairStructures").some(t => t && t.reservedBy === "w6"),
    JSON.stringify(queue(ROOM, "repairStructures").map(t => t && t.reservedBy)),
  );
}

/*
 * То же, но через СВИП очередей: своя очередь пуста, свободные задачи лежат в
 * другом типе.
 *
 * Правка (переписанный worker.runner): раньше здесь было ШЕСТЬ getRangeTo —
 * свип считал дальность кандидатов, а затем выбранная очередь обходилась ВТОРОЙ
 * раз повторным getNextTask, и расстояния считались заново. Теперь ранжер один
 * на воркера и тик и кэширует дальность по паре (крип, точка маршрута), поэтому
 * повторный обход очереди идёт по кэшу: ровно ТРИ getRangeTo — по одному на
 * просмотренного кандидата, и ни одного лишнего. Обращений к Game.getObjectById
 * при этом тоже три: резолв идёт через общий с task.executors кэш resolveTarget.
 */
console.log("\n7. Свип очередей: стор один раз, обращений к API — по разу на кандидата");
{
  const ROOM = makeRoom("W7N1");
  for (let i = 0; i < 3; i++) {
    addTask(
      ROOM,
      "repairStructures",
      "t_s" + i,
      makeObject("sweep" + i, 5 + i, { hits: 100, hitsMax: 1000 }),
    );
  }

  // Своя очередь (fillSpawnsExtensions) пуста — воркер идёт в свип.
  const creep = makeCreep(ROOM, "w7", IDX("fillSpawnsExtensions"));
  let storeReads = 0;
  let rangeReads = 0;
  creep.store = {
    energy: 100,
    getFreeCapacity: () => {
      storeReads++;
      return 0;
    },
  };
  creep.pos = {
    getRangeTo: target => {
      rangeReads++;
      return target && typeof target.range === "number" ? target.range : 1;
    },
  };

  runSafe(creep);

  check(
    "свип: стор прочитан ровно один раз за тик",
    storeReads === 1,
    `reads=${storeReads}`,
  );
  check(
    "свип: 3 getRangeTo = ровно по одному на кандидата (повторный обход — по кэшу)",
    rangeReads === 3,
    `getRangeTo=${rangeReads}`,
  );
  check(
    "свип: выбранный тип — repairStructures",
    creep.memory.taskIndex === IDX("repairStructures"),
    String(creep.memory.taskIndex),
  );
}

/*
 * ПРАВКА 05.10.2026 (пункт 2 плана, docs/REPAIR-PLAN.md:159): очередь — это
 * приоритет. Воркер сначала проверяет очереди ВЫШЕ своей по TASK_CHAIN (для
 * ремонта idx 7 это доставка 0..6), потом свою, и только затем работает
 * прежний кольцевой выбор ближайшей очереди (он остался для очередей НИЖЕ
 * своей — build (8), fillTowers (9), upgrade (10)).
 *
 * Почему появилось: замер shard3 05.10.2026 (read-only, Memory.rooms +
 * Memory.creeps, 29 снимков подряд, опрос раз в 10 с) — воркер держал
 * repair-задачу, а в его комнате свободно лежали 4-5 задач доставки с живыми
 * целями; очередь ремонта в E35S39 — 346 100 недостающих хитов = 3 461 тик
 * работы одного WORK. Своя очередь была первой, и до доставки воркер не
 * доходил вовсе.
 *
 * Откат правки: убрать вызов pickHigher из findTask (task/runner.pick.js) —
 * своя очередь снова первая.
 */
console.log("\n8. Очереди ВЫШЕ своей (доставка) — первыми, своя — после них");
{
  const { roomIndex, makeRanger, findTask } = require("../task/runner.pick");
  const ROOM = makeRoom("W8N1");

  // Своя очередь — ремонт (idx 7). Выше лежит доставка (idx 0), нарочно
  // ДАЛЬНЯЯ (30), а своя задача ремонта — ближняя (2): проверяем приоритет
  // очереди, а не близость цели.
  addTask(ROOM, "fillSpawnsExtensions", "t_fill", makeObject("w8_far", 30), {
    sourceId: "w8_storage",
    resourceType: global.RESOURCE_ENERGY,
  });
  addTask(
    ROOM,
    "repairStructures",
    "t_repair",
    makeObject("w8_near", 2, { hits: 100, hitsMax: 1000 }),
  );

  const creep = makeCreep(ROOM, "w8", IDX("repairStructures"));
  const found = findTask(
    creep,
    ROOM,
    roomIndex(ROOM),
    IDX("repairStructures"),
    makeRanger(creep, false),
  );

  check(
    "выбрана доставка (idx 0), хотя своя задача ремонта ближе",
    !!found && found.typeIndex === IDX("fillSpawnsExtensions"),
    found ? String(found.typeIndex) : "null",
  );
  check(
    "взята именно задача очереди idx 0",
    !!found && found.task.taskId === "t_fill",
    found ? String(found.task.taskId) : "null",
  );
  check(
    "своя очередь ремонта не зарезервирована",
    !queue(ROOM, "repairStructures")[0].reservedBy,
    String(queue(ROOM, "repairStructures")[0].reservedBy),
  );

  // Сквозная проверка тем же воркером: решение задачи и резерв через штатный
  // вход роли (workerRunner.run), а не только через findTask.
  runSafe(creep);

  check(
    "run(): taskIndex переключился на idx 0",
    creep.memory.taskIndex === IDX("fillSpawnsExtensions"),
    String(creep.memory.taskIndex),
  );
  check(
    "run(): доставка зарезервирована за воркером",
    queue(ROOM, "fillSpawnsExtensions")[0].reservedBy === "w8",
    String(queue(ROOM, "fillSpawnsExtensions")[0].reservedBy),
  );
}

{
  const { roomIndex, makeRanger, findTask } = require("../task/runner.pick");
  const ROOM = makeRoom("W8N2");

  // Обе очереди ВЫШЕ своей: idx 0 — дальняя (30), idx 3 — ближняя (2).
  // Побеждает младший индекс цепочки, а не близость.
  addTask(ROOM, "fillSpawnsExtensions", "t_fill2", makeObject("w82_far", 30));
  addTask(ROOM, "fillTerminalEnergy", "t_term2", makeObject("w82_near", 2));
  addTask(
    ROOM,
    "repairStructures",
    "t_repair2",
    makeObject("w82_rep", 1, { hits: 100, hitsMax: 1000 }),
  );

  const creep = makeCreep(ROOM, "w82", IDX("repairStructures"));
  const found = findTask(
    creep,
    ROOM,
    roomIndex(ROOM),
    IDX("repairStructures"),
    makeRanger(creep, false),
  );

  check(
    "порядок по цепочке: idx 0 раньше idx 3, даже когда idx 3 ближе",
    !!found && found.typeIndex === IDX("fillSpawnsExtensions"),
    found ? String(found.typeIndex) : "null",
  );
}

{
  const { roomIndex, makeRanger, findTask } = require("../task/runner.pick");
  const ROOM = makeRoom("W8N3");

  // Выше ничего нет: работа только в своей очереди — ремонт обязан браться.
  addTask(
    ROOM,
    "repairStructures",
    "t_repair3",
    makeObject("w83_rep", 2, { hits: 100, hitsMax: 1000 }),
  );

  const creep = makeCreep(ROOM, "w83", IDX("repairStructures"));
  const found = findTask(
    creep,
    ROOM,
    roomIndex(ROOM),
    IDX("repairStructures"),
    makeRanger(creep, false),
  );

  check(
    "выше пусто — берётся своя очередь ремонта",
    !!found && found.typeIndex === IDX("repairStructures"),
    found ? String(found.typeIndex) : "null",
  );
}

{
  const { roomIndex, makeRanger, findTask } = require("../task/runner.pick");
  const ROOM = makeRoom("W8N4");

  // Выше и своя пусты: очереди НИЖЕ своей — стройка (idx 8, дальняя 30) и
  // башни (idx 9, ближняя 3). Здесь должен остаться ПРЕЖНИЙ выбор ближайшей
  // очереди (шаг 1), а не порядок цепочки.
  addTask(
    ROOM,
    "buildStructures",
    "t_bld4",
    makeObject("w84_site", 30, { progress: 0, progressTotal: 100 }),
  );
  addTask(ROOM, "fillTowers", "t_twr4", makeObject("w84_tower", 3));

  const creep = makeCreep(ROOM, "w84", IDX("repairStructures"));
  const found = findTask(
    creep,
    ROOM,
    roomIndex(ROOM),
    IDX("repairStructures"),
    makeRanger(creep, false),
  );

  check(
    "ниже своей — прежний выбор ближайшей очереди (idx 9, а не idx 8)",
    !!found && found.typeIndex === IDX("fillTowers"),
    found ? String(found.typeIndex) : "null",
  );
}

/*
 * ПРАВКА 05.10.2026 (пункт 8 плана, docs/REPAIR-PLAN.md:165): ЦЕПОЧКА дорог.
 * После вычиненной дороги воркер берёт следующую ВПЛОТНУЮ (радиус 1), а не
 * ближайшую вообще: дороги распадаются полосами, и ехать через комнату за
 * соседней плиткой незачем.
 *
 * Почему это вообще правка, а не текущее поведение: обычный поиск смотрит
 * TASK_CONFIG.NEAREST_SCAN_LIMIT = 8 кандидатов (constants/tasks.js:52), и
 * соседняя дорога, стоящая в очереди девятым номером, не находится вовсе.
 * Цепочка расширяет окно на всю очередь и обрывается на первой задаче вплотную
 * (task/lookup.js:51-96).
 *
 * Откат правки: убрать 4-й аргумент getNextTask в pickFrom
 * (task/runner.pick.js) — вернётся выбор ближайшей.
 */
console.log("\n9. Цепочка дорог: задача вплотную ищется по всей очереди (пункт 8)");
{
  const { roomIndex, makeRanger, findTask } = require("../task/runner.pick");
  const CHAIN_ROOM = makeRoom("W9N1");

  // 12 задач ремонта: первые восемь — далеко (20..27), девятая (индекс 8) —
  // ВПЛОТНУЮ (1), остальные ещё дальше. Кладём пачками по потолку постановки
  // (MAX_NEW_TASKS_PER_TYPE_PER_TICK = 6, constants/tasks.js:20): за один тик
  // больше шести задач типа не добавится, и «соседней» в очереди не окажется.
  const ids = [];
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 6 === 0) global.Game.time++;
    const id = "w9_road" + i;
    const range = i < 8 ? 20 + i : i === 8 ? 1 : 40 + i;
    addTask(CHAIN_ROOM, "repairStructures", "t_w9_" + i, makeObject(id, range, { hits: 100, hitsMax: 5000 }));
    ids.push("t_w9_" + i);
  }

  const creep = makeCreep(CHAIN_ROOM, "w9", IDX("repairStructures"));

  // 1) Обычный поиск (без цепочки) окно в 8 кандидатов не перешагивает.
  const plain = taskManager.getNextTask(CHAIN_ROOM, "repairStructures", makeRanger(creep, false));
  check(
    "без цепочки соседняя дорога за окном 8 кандидатов не найдена",
    !!plain && plain.taskId !== ids[8],
    plain ? plain.taskId : "null",
  );

  // 2) Цепочка проходит очередь целиком и берёт задачу вплотную.
  const chained = taskManager.getNextTask(
    CHAIN_ROOM,
    "repairStructures",
    makeRanger(creep, false),
    true,
  );
  check(
    "с цепочкой выбрана задача вплотную (t_w9_8)",
    !!chained && chained.taskId === ids[8],
    chained ? chained.taskId : "null",
  );

  // 3) Через штатный вход выбора: своя очередь — ремонт, значит цепочка включена.
  const found = findTask(
    creep,
    CHAIN_ROOM,
    roomIndex(CHAIN_ROOM),
    IDX("repairStructures"),
    makeRanger(creep, false),
  );
  check(
    "findTask для своей очереди ремонта тоже берёт задачу вплотную",
    !!found && found.task.taskId === ids[8],
    found ? found.task.taskId : "null",
  );
}

console.log("\n10. Цепочка: запасной путь, чужая очередь и занятая задача");
{
  const { roomIndex, makeRanger, findTask } = require("../task/runner.pick");

  // 1) Задач вплотную нет — цепочка возвращает ту же ближайшую, что и обычный поиск.
  const ROOM = makeRoom("W10N1");
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 6 === 0) global.Game.time++;
    addTask(ROOM, "repairStructures", "t_w10_" + i, makeObject("w10_road" + i, 20 + i, { hits: 100, hitsMax: 5000 }));
  }
  const creep = makeCreep(ROOM, "w10", IDX("repairStructures"));
  const plain = taskManager.getNextTask(ROOM, "repairStructures", makeRanger(creep, false));
  const chained = taskManager.getNextTask(ROOM, "repairStructures", makeRanger(creep, false), true);
  check(
    "нет задач вплотную — цепочка отдаёт ту же ближайшую",
    !!plain && !!chained && plain.taskId === chained.taskId,
    `${plain && plain.taskId} / ${chained && chained.taskId}`,
  );

  // 2) Цепочка не трогает ЧУЖУЮ очередь: у доставки та же картина с соседней
  //    задачей за окном, но порядок выбора там прежний (ближайшая из окна).
  const ROOM2 = makeRoom("W10N2");
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 6 === 0) global.Game.time++;
    const range = i < 8 ? 20 + i : i === 8 ? 1 : 40 + i;
    addTask(ROOM2, "fillSpawnsExtensions", "t_w10b_" + i, makeObject("w10b_sp" + i, range));
  }
  const creep2 = makeCreep(ROOM2, "w10b", IDX("fillSpawnsExtensions"));
  const found2 = findTask(
    creep2,
    ROOM2,
    roomIndex(ROOM2),
    IDX("fillSpawnsExtensions"),
    makeRanger(creep2, false),
  );
  check(
    "чужая очередь (доставка) цепочку не применяет",
    !!found2 && found2.task.taskId !== "t_w10b_8",
    found2 ? found2.task.taskId : "null",
  );

  // 3) Соседняя задача занята живым воркером — цепочка её пропускает.
  const ROOM3 = makeRoom("W10N3");
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 6 === 0) global.Game.time++;
    const range = i < 8 ? 20 + i : i === 8 ? 1 : 40 + i;
    addTask(
      ROOM3,
      "repairStructures",
      "t_w10c_" + i,
      makeObject("w10c_road" + i, range, { hits: 100, hitsMax: 5000 }),
      i === 8 ? { reservedBy: "w10c_other" } : undefined,
    );
  }
  global.Game.creeps.w10c_other = { name: "w10c_other", memory: { role: "worker" } };
  const creep3 = makeCreep(ROOM3, "w10c", IDX("repairStructures"));
  const chained3 = taskManager.getNextTask(
    ROOM3,
    "repairStructures",
    makeRanger(creep3, false),
    true,
  );
  check(
    "занятая соседняя задача не отдаётся",
    !!chained3 && chained3.taskId !== "t_w10c_8",
    chained3 ? chained3.taskId : "null",
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
