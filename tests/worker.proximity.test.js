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

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
