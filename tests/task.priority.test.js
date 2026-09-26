"use strict";
/**
 * ===================================================
 * TASK.PRIORITY.TEST.JS — офлайн-проверка приоритета задач
 * ===================================================
 * Инцидент 18.09.2026 (живой шард, E35S37): комната «погасла». Причина в
 * worker.runner: выбор Task начинался не с начала TASK_CHAIN, а с
 * `creep.memory.taskIndex`, который ещё и сдвигался после каждой задачи. То
 * есть «приоритетная цепочка» работала как ротация: воркер, стоявший на
 * терминале/ремонте, брал терминал/ремонт, хотя на позиции 0 лежала незакрытая
 * задача fillSpawnsExtensions. Плюс долгая задача (ремонт executor держит до
 * полного восстановления структуры) могла занять всех воркеров.
 *
 * Проверяем новый контракт:
 *   1) TASK_CHAIN — приоритет выживания (спавны → башни → ... → стройка);
 *   2) холостой воркер берёт САМУЮ приоритетную доступную Task (скан с 0),
 *      прошлая история (taskIndex) ни на что не влияет;
 *   3) воркер прерывает удерживаемую низкоприоритетную задачу, когда
 *      появляется более приоритетная (долгий ремонт не блокирует спавны);
 *   4) задача высшего приоритета не прерывается задачами ниже;
 *   5) при «чужом» грузе прерывание не делается (сначала довозим ресурс);
 *   6) легаси-задача без taskType освобождается по taskId (не «висит» на
 *      живом крипе мёртвой потребностью).
 *
 * Запуск: node tests/task.priority.test.js
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
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_ARGS = -10;
global.ERR_NO_BODYPART = -12;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_H = "H";
global.RESOURCE_O = "O";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";

function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

function Store(capacity, contents) {
  const target = {};
  for (const k of Object.keys(contents || {})) target[k] = contents[k];
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "getFreeCapacity") return () => capacity - storeUsed(t);
      if (prop === "getUsedCapacity") return () => storeUsed(t);
      if (prop === "getCapacity") return () => capacity;
      if (typeof prop === "symbol") return t[prop];
      if (prop in t) return t[prop];
      return 0;
    },
    set(t, prop, value) {
      t[prop] = value;
      return true;
    },
  });
}

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  getRangeTo(t) {
    const p = t && t.pos ? t.pos : t;
    if (p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  isNearTo(t) {
    return this.getRangeTo(t) <= 1;
  }
}
global.RoomPosition = RoomPosition;

const WORLD = { objects: {} };
const ROOMS = {};

global.Game = {
  time: 1000,
  creeps: {},
  getObjectById: id => WORLD.objects[id] || null,
};

function makeStruct(id, x, y, roomName, capacity, contents, extra) {
  const s = Object.assign(
    {
      id,
      pos: new RoomPosition(x, y, roomName),
      store: new Store(capacity, contents),
    },
    extra || {},
  );
  WORLD.objects[id] = s;
  return s;
}

function makeRoom(name) {
  const room = {
    name,
    memory: {},
    terminal: null,
    storage: null,
    controller: null,
    energyAvailable: 12600,
    energyCapacityAvailable: 12600,
  };
  ROOMS[name] = room;
  // Энергии выше резерва (STORAGE.ENERGY_MIN), чтобы исполнители могли
  // реально «начать» задачу (withdraw → CONTINUE) и мы проверяли именно
  // выбор/прерывание, а не завершение Task за один тик.
  room.storage = makeStruct("ST", 25, 25, name, 1000000, { energy: 200000 });
  return room;
}

function makeCreep(contents) {
  const creep = {
    name: "worker_R_test",
    pos: new RoomPosition(25, 27, "R"),
    store: new Store(500, contents || {}),
    room: ROOMS.R,
    memory: { role: "worker", homeRoom: "R" },
    ticksToLive: 1000,
    spawning: false,
    travelTo() {
      return OK;
    },
    withdraw() {
      return OK;
    },
    transfer() {
      return OK;
    },
    upgradeController() {
      return OK;
    },
    repair() {
      return OK;
    },
  };
  Game.creeps[creep.name] = creep;
  return creep;
}

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

function initMemory() {
  global.Memory = { rooms: { R: { tasks: {} } } };
  Game.creeps = {};
}

function queue(queueName, tasks) {
  Memory.rooms.R.tasks[queueName] = tasks;
}

initMemory();
const taskManager = require("../task.manager");
const workerRunner = require("../worker.runner");
const { TASK_CHAIN } = taskManager;

// ── 1. Порядок приоритета ────────────────────────────────────────────────
{
  console.log("\n1. TASK_CHAIN — приоритет выживания");
  const idx = t => TASK_CHAIN.indexOf(t);
  check("спавны/расширения — первые", idx("fillSpawnsExtensions") === 0);
  check(
    "башни раньше терминала/ремонта/стройки/апгрейда",
    idx("fillTowers") < idx("fillTerminalEnergy") &&
      idx("fillTowers") < idx("fillTerminalResources") &&
      idx("fillTowers") < idx("repairStructures") &&
      idx("fillTowers") < idx("buildStructures") &&
      idx("fillTowers") < idx("upgradeController"),
    JSON.stringify(TASK_CHAIN),
  );
  // Правка приоритетов по разбору «фабрика = доход, RCL не растим»: источник
  // дохода идёт сразу после жизнеобеспечения (спавны → фабрика → башни),
  // развитие уезжает в хвост.
  check(
    "фабрика (доход) выше башен, ремонта, терминала, стройки и апгрейда",
    idx("fillFactoryEnergy") < idx("fillTowers") &&
      idx("fillFactoryEnergy") < idx("repairStructures") &&
      idx("fillFactoryEnergy") < idx("fillTerminalEnergy") &&
      idx("fillFactoryEnergy") < idx("buildStructures") &&
      idx("fillFactoryEnergy") < idx("upgradeController"),
    JSON.stringify(TASK_CHAIN),
  );
  check(
    "вывоз продукта фабрики не позже её снабжения",
    idx("collectFactoryBattery") <= idx("fillFactoryEnergy"),
    JSON.stringify(TASK_CHAIN),
  );
  check(
    "стройка и апгрейд контроллера — в хвосте (развитие не цель)",
    idx("buildStructures") >= TASK_CHAIN.length - 2 &&
      idx("upgradeController") === TASK_CHAIN.length - 1,
    JSON.stringify(TASK_CHAIN),
  );
  check(
    "все 11 категорий на месте",
    TASK_CHAIN.length === 11,
    String(TASK_CHAIN.length),
  );
}

// ── Общие фикстуры сценариев ─────────────────────────────────────────────
function fixtures() {
  initMemory();
  const room = makeRoom("R");
  const spawn = makeStruct("SP", 25, 28, "R", 300, {});
  const controller = makeStruct("CT", 20, 20, "R", 0, {}, {
    ticksToDowngrade: 1000,
  });
  room.controller = controller;
  const creep = makeCreep({});
  const fillTask = {
    taskId: "tFill",
    type: "transfer",
    sourceId: room.storage.id,
    targetId: spawn.id,
    resourceType: "energy",
  };
  const upgradeTask = { taskId: "tUp", type: "upgrade", targetId: controller.id };
  return { room, spawn, controller, creep, fillTask, upgradeTask };
}

// ── 2. Холостой воркер: самая приоритетная доступная Task ───────────────
{
  console.log("\n2. Холостой воркер берёт самую приоритетную Task");

  const f = fixtures();
  // В очереди есть и upgrade (низкий приоритет), и fillSpawnsExtensions (0).
  queue("upgradeController", [f.upgradeTask]);
  queue("fillSpawnsExtensions", [f.fillTask]);

  // Имитируем «прошлую историю»: раньше воркер работал на upgrade (старый
  // индекс 3). Новая версия историю игнорирует и обязана взять спавны.
  f.creep.memory.taskIndex = 3;

  workerRunner.run(f.creep);

  check(
    "взята fillSpawnsExtensions, а не upgrade",
    f.creep.memory.taskType === "fillSpawnsExtensions",
    String(f.creep.memory.taskType),
  );
  check(
    "задача зарезервирована",
    Memory.rooms.R.tasks.fillSpawnsExtensions[0].reservedBy === f.creep.name,
    JSON.stringify(Memory.rooms.R.tasks.fillSpawnsExtensions[0]),
  );
}

// ── 3. Прерывание: долгий ремонт/апгрейд не блокирует спавны ─────────────
{
  console.log("\n3. Удерживаемая низкоприоритетная Task прерывается");

  const f = fixtures();
  const held = Object.assign({}, f.upgradeTask, { reservedBy: f.creep.name });
  queue("upgradeController", [held]);
  f.creep.memory.task = held;
  f.creep.memory.taskType = "upgradeController";
  f.creep.memory.working = true;

  // Появляется критичная задача подвоза спавнов.
  queue("fillSpawnsExtensions", [f.fillTask]);

  workerRunner.run(f.creep);

  check(
    "переключился на fillSpawnsExtensions",
    f.creep.memory.taskType === "fillSpawnsExtensions",
    String(f.creep.memory.taskType),
  );
  check(
    "старая задача освобождена (не «висит» за крипом)",
    Memory.rooms.R.tasks.upgradeController[0].reservedBy === undefined,
    JSON.stringify(Memory.rooms.R.tasks.upgradeController[0]),
  );
  check(
    "флаг фазы сброшен при прерывании",
    f.creep.memory.working === undefined,
    String(f.creep.memory.working),
  );
}

// ── 4. Высший приоритет не прерывается низшими ──────────────────────────
{
  console.log("\n4. Task спавнов не прерывается задачами ниже");

  const f = fixtures();
  const held = Object.assign({}, f.fillTask, { reservedBy: f.creep.name });
  queue("fillSpawnsExtensions", [held]);
  queue("upgradeController", [f.upgradeTask]);
  f.creep.memory.task = held;
  f.creep.memory.taskType = "fillSpawnsExtensions";

  workerRunner.run(f.creep);

  check(
    "категория осталась fillSpawnsExtensions",
    f.creep.memory.taskType === "fillSpawnsExtensions",
    String(f.creep.memory.taskType),
  );
  check(
    "upgrade не тронут",
    Memory.rooms.R.tasks.upgradeController[0].reservedBy === undefined,
    JSON.stringify(Memory.rooms.R.tasks.upgradeController[0]),
  );
}

// ── 5. «Чужой» груз: прерывание не делаем ───────────────────────────────
{
  console.log("\n5. С чужим грузом критичная Task не прерывает текущую");

  const f = fixtures();
  f.creep.store = new Store(500, { K: 30 });
  const held = Object.assign({}, f.upgradeTask, { reservedBy: f.creep.name });
  queue("upgradeController", [held]);
  queue("fillSpawnsExtensions", [f.fillTask]);
  f.creep.memory.task = held;
  f.creep.memory.taskType = "upgradeController";

  workerRunner.run(f.creep);

  check(
    "груз K сначала довозится (категория не сменилась)",
    f.creep.memory.taskType === "upgradeController",
    String(f.creep.memory.taskType),
  );
  check(
    "спавн-Task не перехвачена",
    Memory.rooms.R.tasks.fillSpawnsExtensions[0].reservedBy === undefined,
    JSON.stringify(Memory.rooms.R.tasks.fillSpawnsExtensions[0]),
  );
}

// ── 6. Миграция: легаси-задача без taskType освобождается ───────────────
{
  console.log("\n6. Легаси-задача (без taskType) освобождается по taskId");

  const f = fixtures();
  const oldTask = {
    taskId: "tOld",
    type: "transfer",
    sourceId: f.room.storage.id,
    targetId: f.spawn.id,
    resourceType: "energy",
    reservedBy: f.creep.name,
  };
  queue("fillTerminalResources", [oldTask]);
  queue("fillSpawnsExtensions", [f.fillTask]);
  f.creep.memory.task = oldTask; // без taskType — как в старой версии
  f.creep.memory.taskIndex = 4;

  workerRunner.run(f.creep);

  check(
    "старая задача освобождена",
    Memory.rooms.R.tasks.fillTerminalResources[0].reservedBy === undefined,
    JSON.stringify(Memory.rooms.R.tasks.fillTerminalResources[0]),
  );
  check(
    "взята самая приоритетная доступная",
    f.creep.memory.taskType === "fillSpawnsExtensions",
    String(f.creep.memory.taskType),
  );
}

// ── 7. Подвоз энергии в терминал: цель, а не ёмкость ─────────────────────
// Регресс на реальную ошибку, найденную при разборе приоритетов:
// executeFillTerminalEnergy останавливался только на isTargetFull(target), то
// есть задача, сгенерированная ради дефицита до TERMINAL_SUPPLY.ENERGY_TARGET,
// лила терминал до ПОЛНОЙ ёмкости (300k), вычерпывая storage и вытесняя
// снабжение фабрики. Теперь критерий остановки — ENERGY_TARGET.
{
  console.log("\n7. fillTerminalEnergy останавливается на ENERGY_TARGET");
  const executors = require("../task.executors").executors;
  const { TERMINAL_SUPPLY } = require("../constants");

  initMemory();
  const room = makeRoom("R");
  const terminal = makeStruct(
    "TERM",
    24,
    24,
    "R",
    300000,
    { energy: TERMINAL_SUPPLY.ENERGY_TARGET - 100 },
  );
  room.terminal = terminal;

  const task = {
    taskId: "tTerm",
    type: "transfer",
    sourceId: room.storage.id,
    targetId: terminal.id,
    resourceType: "energy",
  };

  const creep = makeCreep({ energy: 300 });
  creep.travelTo = () => OK;

  // Цель уже достигнута (энергия терминала >= ENERGY_TARGET) — задача закрыта
  // даже при наличии места в терминале: это и есть граница «цель ≠ ёмкость».
  terminal.store.energy = TERMINAL_SUPPLY.ENERGY_TARGET;
  let result = executors.fillTerminalEnergy(creep, task);
  check(
    "на ENERGY_TARGET задача закрывается (DONE), а не льётся до ёмкости",
    result === "DONE" && terminal.store.energy < 300000,
    `${result} energy=${terminal.store.energy}`,
  );

  // Ниже цели и есть место → работа продолжается.
  terminal.store.energy = TERMINAL_SUPPLY.ENERGY_TARGET - 100;
  result = executors.fillTerminalEnergy(creep, task);
  check(
    "ниже ENERGY_TARGET задача продолжается (CONTINUE)",
    result === "CONTINUE",
    `${result} energy=${terminal.store.energy}`,
  );

  // Полный терминал закрывается и телом (не только по цели).
  terminal.store.energy = 300000;
  result = executors.fillTerminalEnergy(creep, task);
  check("полный терминал — DONE", result === "DONE", String(result));

  // Защита от обесточивания: storage на резерве → задачу не начинаем.
  const emptyCreep = makeCreep({});
  emptyCreep.travelTo = () => OK;
  terminal.store.energy = TERMINAL_SUPPLY.ENERGY_TARGET - 100;
  room.storage.store.energy = 1000;
  result = executors.fillTerminalEnergy(emptyCreep, task);
  check(
    "storage ниже резерва — энергия из склада не берётся (SKIP)",
    result === "SKIP",
    `${result} storage=${room.storage.store.energy}`,
  );

  // ГЕЙТ ПОДВОЗА (правка 25.09.2026): порог — резерв склада 150000, а не
  // 195000. Прежние 195000 были выше живого склада (191–195k), и цель терминала
  // 100000 оставалась недостижимой.
  const { STORAGE } = require("../constants");
  room.storage.store.energy = STORAGE.ENERGY_MIN;
  result = executors.fillTerminalEnergy(emptyCreep, task);
  check(
    "склад ровно на резерве 150000 — энергия не берётся (SKIP)",
    result === "SKIP",
    `${result} storage=${room.storage.store.energy}`,
  );

  room.storage.store.energy = STORAGE.ENERGY_MIN + 1;
  result = executors.fillTerminalEnergy(emptyCreep, task);
  check(
    "склад 150001 — энергия берётся (CONTINUE), порог больше не 195000",
    result === "CONTINUE",
    `${result} storage=${room.storage.store.energy}`,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
