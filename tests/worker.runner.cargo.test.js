"use strict";
/**
 * ===================================================
 * WORKER.RUNNER.CARGO.TEST.JS — офлайн-проверка инварианта «Task с пустым рюкзаком»
 * ===================================================
 * Симптом (живая игра): у worker_E35S39_83058940 в рюкзаке одновременно два
 * ресурса. Причина: executor может завершить Task с остатком груза (например,
 * fillSpawnsExtensions отдал всё, что поместилось, а цель переполнилась), после
 * чего worker.runner брал следующую категорию (скажем, fillTerminalResources для
 * минерала) и делал withdraw поверх уже лежащего в рюкзаке ресурса.
 *
 * Здесь выполняется НАСТОЯЩИЙ код worker.runner + task.manager + task.executors
 * в минимально заглушённом мире Screeps:
 *   1) остаток груза + Task на ДРУГОЙ ресурс -> груз возвращается в Storage,
 *      Task не берётся (никакого withdraw «чужого» ресурса);
 *   2) остаток энергии + энергетическая Task -> груз НЕ выгружается, а доезжает
 *      до новой цели (нет лишнего рейса в Storage);
 *   3) когда рюкзак пуст -> Task берётся как обычно (поведение не сломано);
 *   4) при завершении Task флаг memory.working сбрасывается (не «перетекает» в
 *      следующую задачу с другим resourceType);
 *   8) transfer-задача в ФАЗЕ ДОСТАВКИ (working=true) НЕ прерывается
 *      приоритетной (иначе — выброшенный рейс и перепчёт Traveler);
 *   9) контроль: фаза сбора (working=false) прерывается как раньше — правка не
 *      отключила прерывание целиком.
 *
 * Запуск: node tests/worker.runner.cargo.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Разрешение bare-require в стиле Screeps (как в игре: от корня проекта) ──
const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

// ── Глобалы Screeps, используемые executor'ами ───────────────────────────
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_H = "H";
global.RESOURCE_O = "O";

// ── Store как в игре (отсутствующий ресурс = 0, видны только лежащие) ─────
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
  toString() {
    return `[room ${this.roomName} pos ${this.x},${this.y}]`;
  }
}
global.RoomPosition = RoomPosition;

// ── Мир ───────────────────────────────────────────────────────────────────
const WORLD = { objects: {} };
const ROOMS = {};

global.Game = {
  time: 1000,
  cpu: { getUsed: () => 0 },
  creeps: {},
  getObjectById: id => WORLD.objects[id] || null,
};

function makeStruct(id, x, y, roomName, capacity, contents) {
  const s = {
    id,
    pos: new RoomPosition(x, y, roomName),
    store: new Store(capacity, contents),
  };
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
  };
  ROOMS[name] = room;
  room.storage = makeStruct("ST", 25, 25, name, 1000000, {});
  return room;
}

class Creep {
  constructor(name, x, y, roomName, capacity, contents) {
    this.name = name;
    this.pos = new RoomPosition(x, y, roomName);
    this.store = new Store(capacity, contents || {});
    this.room = ROOMS[roomName];
    this.memory = { role: "worker", homeRoom: roomName };
    this.travelToCalls = [];
    this.withdrawCalls = [];
    this.transferCalls = [];
  }
  travelTo(target) {
    this.travelToCalls.push(target.id);
    this.pos = new RoomPosition(target.pos.x, target.pos.y, target.pos.roomName);
    return OK;
  }
  withdraw(target, resource, amount) {
    const near = this.pos.isNearTo(target);
    this.withdrawCalls.push({ id: target.id, resource, near });
    if (!near) return ERR_NOT_IN_RANGE;
    const room = Math.min(
      target.store[resource] || 0,
      amount === undefined ? Infinity : amount,
      this.store.getFreeCapacity(),
    );
    if (room <= 0) return ERR_FULL;
    target.store[resource] -= room;
    this.store[resource] = (this.store[resource] || 0) + room;
    return OK;
  }
  transfer(target, resource) {
    const near = this.pos.isNearTo(target);
    this.transferCalls.push({ id: target.id, resource, near });
    if (!near) return ERR_NOT_IN_RANGE;
    const move = Math.min(this.store[resource] || 0, target.store.getFreeCapacity());
    if (move <= 0) return ERR_FULL;
    this.store[resource] -= move;
    target.store[resource] = (target.store[resource] || 0) + move;
    return OK;
  }
}

function initMemory() {
  global.Memory = { rooms: { R: { tasks: {} } } };
  Game.creeps = {};
}

initMemory();
const taskManager = require("../task.manager");
const mod = require("../worker.runner");
const { TASK_CHAIN } = taskManager;

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

function queueTask(queueName, task) {
  Memory.rooms.R.tasks[queueName] = [task];
}

function makeCreep(contents) {
  const creep = new Creep("worker_E35S39_test", 25, 27, "R", 500, contents);
  Game.creeps[creep.name] = creep;
  return creep;
}

// ── 1. Остаток груза + нет Task -> сброс в Storage, Task не берётся ───────
{
  console.log("\n1. Остаток груза: не берём новую Task, пока рюкзак не пуст");
  initMemory();
  const room = makeRoom("R");
  const creep = makeCreep({ energy: 30 });
  creep.memory.taskIndex = TASK_CHAIN.indexOf("fillTerminalResources");

  // В очереди есть задача на минерал H — именно её раньше взял бы Worker и
  // дозагрузил поверх энергии.
  const mineral = makeStruct("MN", 25, 28, "R", 500000, { H: 1000 });
  const terminal = makeStruct("TM", 26, 28, "R", 300000, {});
  room.terminal = terminal;
  queueTask("fillTerminalResources", {
    taskId: "tH",
    type: "transfer",
    sourceId: mineral.id,
    targetId: terminal.id,
    resourceType: "H",
  });

  mod.run(creep);

  check(
    "чужой ресурс H не забирался",
    creep.withdrawCalls.length === 0,
    JSON.stringify(creep.withdrawCalls),
  );
  check(
    "в рюкзаке нет ресурса H",
    Object.keys(creep.store).indexOf("H") === -1,
    JSON.stringify(Object.keys(creep.store)),
  );
  check(
    "рюкзак всё ещё содержит только энергию",
    Object.keys(creep.store).length === 1 &&
      Object.keys(creep.store)[0] === "energy",
    JSON.stringify(Object.keys(creep.store)),
  );
  check(
    "начат путь к Storage",
    creep.travelToCalls[0] === room.storage.id,
    JSON.stringify(creep.travelToCalls),
  );
  check(
    "новая Task не взята",
    !creep.memory.task,
    JSON.stringify(creep.memory.task),
  );
}

// ── 2. Остаток энергии + энергетическая Task -> груз НЕ выгружается ──────
{
  console.log(
    "\n2. Остаток энергии + энергетическая Task: без рейса в Storage",
  );
  initMemory();
  const room = makeRoom("R");
  const creep = makeCreep({ energy: 30 });
  creep.memory.taskIndex = TASK_CHAIN.indexOf("fillSpawnsExtensions");

  const spawn = makeStruct("SP0", 25, 28, "R", 300, {});
  queueTask("fillSpawnsExtensions", {
    taskId: "tE",
    type: "transfer",
    sourceId: room.storage.id,
    targetId: spawn.id,
    resourceType: "energy",
  });

  mod.run(creep);

  check(
    "Task взята без выгрузки",
    creep.memory.task && creep.memory.task.taskId === "tE",
    JSON.stringify(creep.memory.task),
  );
  check(
    "в Storage ничего не возвращали",
    (room.storage.store.energy || 0) === 0,
    String(room.storage.store.energy),
  );
  check(
    "к Storage не ездили",
    creep.travelToCalls.indexOf(room.storage.id) === -1,
    JSON.stringify(creep.travelToCalls),
  );
  check(
    "остаток энергии ушёл в новую цель",
    creep.store.energy === 0 && spawn.store.energy === 30,
    JSON.stringify({ bag: creep.store.energy, target: spawn.store.energy }),
  );
}

// ── 3. Пустой рюкзак -> Task берётся как обычно ──────────────────────────
{
  console.log("\n3. Пустой рюкзак: Task берётся и резервируется");
  initMemory();
  const room = makeRoom("R");
  const creep = makeCreep({});
  creep.memory.taskIndex = TASK_CHAIN.indexOf("fillTerminalResources");

  const mineral = makeStruct("MN2", 25, 28, "R", 500000, { H: 1000 });
  const terminal = makeStruct("TM2", 26, 28, "R", 300000, {});
  room.terminal = terminal;
  queueTask("fillTerminalResources", {
    taskId: "tH2",
    type: "transfer",
    sourceId: mineral.id,
    targetId: terminal.id,
    resourceType: "H",
  });

  mod.run(creep);

  check(
    "Task взята",
    creep.memory.task && creep.memory.task.taskId === "tH2",
    JSON.stringify(creep.memory.task),
  );
  check(
    "задача зарезервирована",
    Memory.rooms.R.tasks.fillTerminalResources[0].reservedBy === creep.name,
    JSON.stringify(Memory.rooms.R.tasks.fillTerminalResources[0]),
  );
  check(
    "задача начинает выполняться (withdraw H)",
    creep.withdrawCalls.length === 1 && creep.withdrawCalls[0].resource === "H",
    JSON.stringify(creep.withdrawCalls),
  );
}

// ── 4. Завершение Task сбрасывает memory.working ─────────────────────────
{
  console.log("\n4. Завершение Task сбрасывает working (флаг не перетекает)");
  initMemory();
  makeRoom("R");
  const creep = makeCreep({ energy: 10 });
  // Цель уже полна -> executor вернёт DONE, не трогая груз.
  const spawn = makeStruct("SP", 25, 28, "R", 300, { energy: 300 });
  const task = {
    taskId: "tFill",
    type: "transfer",
    sourceId: "ST",
    targetId: spawn.id,
    resourceType: "energy",
  };
  Memory.rooms.R.tasks.fillSpawnsExtensions = [task];
  creep.memory.task = task;
  creep.memory.taskType = "fillSpawnsExtensions";
  creep.memory.working = true;

  mod.run(creep);

  check("Task завершена", creep.memory.task === null, String(creep.memory.task));
  check(
    "working сброшен",
    creep.memory.working === undefined,
    String(creep.memory.working),
  );
  check(
    "категория сброшена вместе с Task",
    creep.memory.taskType === undefined,
    String(creep.memory.taskType),
  );
  check(
    "Task удалена из очереди",
    (Memory.rooms.R.tasks.fillSpawnsExtensions || []).length === 0,
    JSON.stringify(Memory.rooms.R.tasks.fillSpawnsExtensions),
  );
}

// ── 5. Холостой Worker: пустые очереди — без обхода TASK_CHAIN ───────────
{
  console.log(
    "\n5. Холостой Worker при пустых очередях: цепочка не обходится",
  );
  initMemory();
  makeRoom("R");
  const creep = makeCreep({});

  // Счётчик вызовов экспортируемой getNextTask: их делает только сам цикл
  // worker.runner (внутренние проверки task.manager идут мимо экспорта).
  const origGetNextTask = taskManager.getNextTask;
  let chainCalls = 0;
  taskManager.getNextTask = (...args) => {
    chainCalls++;
    return origGetNextTask(...args);
  };
  mod.run(creep);
  taskManager.getNextTask = origGetNextTask;

  check(
    "цепочка категорий не пройдена (0 вызовов getNextTask)",
    chainCalls === 0,
    String(chainCalls),
  );
  check("задача не взята", !creep.memory.task, JSON.stringify(creep.memory.task));
  check(
    "категория не назначена",
    creep.memory.taskType === undefined,
    String(creep.memory.taskType),
  );
  check(
    "в комнате нет доступных Task",
    taskManager.hasAvailableTask("R") === false,
  );
}

// ── 6. Полная цель: энергию не снимаем ───────────────────────────────────
{
  console.log("\n6. Цель уже полна: энергию не снимаем, Task завершается");
  initMemory();
  const room = makeRoom("R");
  const creep = makeCreep({});
  creep.memory.taskIndex = TASK_CHAIN.indexOf("fillSpawnsExtensions");
  const full = makeStruct("SPFULL", 25, 28, "R", 300, { energy: 300 });
  queueTask("fillSpawnsExtensions", {
    taskId: "tFull",
    type: "transfer",
    sourceId: room.storage.id,
    targetId: full.id,
    resourceType: "energy",
  });

  mod.run(creep);

  check(
    "энергию не снимали (нет «осиротевшего» груза)",
    creep.withdrawCalls.length === 0,
    JSON.stringify(creep.withdrawCalls),
  );
  check(
    "Task завершена (DONE)",
    creep.memory.task === null &&
      (Memory.rooms.R.tasks.fillSpawnsExtensions || []).length === 0,
    JSON.stringify(creep.memory.task),
  );
  check(
    "в Storage ничего не добавилось",
    (room.storage.store.energy || 0) === 0,
    String(room.storage.store.energy),
  );
}

// ── 7. Груз энергии + чужая Task выше: совместимая предпочитается ────────
{
  console.log(
    "\n7. Груз энергии: берём энергетическую Task ниже, а не сбрасываем груз",
  );
  initMemory();
  const room = makeRoom("R");
  const creep = makeCreep({ energy: 30 });
  creep.memory.taskIndex = TASK_CHAIN.indexOf("fillTerminalResources");

  // Минеральная Task (индекс выше) и энергетическая Task (индекс ниже).
  const mineral = makeStruct("MN7", 25, 28, "R", 500000, { H: 1000 });
  const terminal = makeStruct("TM7", 26, 28, "R", 300000, {});
  room.terminal = terminal;
  queueTask("fillTerminalResources", {
    taskId: "tH7",
    type: "transfer",
    sourceId: mineral.id,
    targetId: terminal.id,
    resourceType: "H",
  });
  const tower = makeStruct("TW7", 24, 28, "R", 1000, { energy: 0 });
  queueTask("fillTowers", {
    taskId: "tE7",
    type: "transfer",
    sourceId: room.storage.id,
    targetId: tower.id,
    resourceType: "energy",
  });

  mod.run(creep);

  check(
    "взята энергетическая Task",
    !!creep.memory.task && creep.memory.task.taskId === "tE7",
    JSON.stringify(creep.memory.task),
  );
  check(
    "энергия не выгружена обратно в Storage",
    (room.storage.store.energy || 0) === 0,
    String(room.storage.store.energy),
  );
}

// ── 8. Фаза доставки transfer-задачи не прерывается приоритетной ─────────
{
  console.log(
    "\n8. Доставка (transfer, working=true) не прерывается ради приоритетной",
  );
  initMemory();
  makeRoom("R");
  const creep = makeCreep({ energy: 100 });
  const tower = makeStruct("TW8", 24, 28, "R", 1000, { energy: 0 });
  const spawn = makeStruct("SP8", 25, 28, "R", 300, { energy: 0 });

  const heldTask = {
    taskId: "tTower8",
    type: "transfer",
    sourceId: "ST",
    targetId: tower.id,
    resourceType: "energy",
    reservedBy: creep.name,
  };
  queueTask("fillTowers", heldTask);
  queueTask("fillSpawnsExtensions", {
    taskId: "tSpawn8",
    type: "transfer",
    sourceId: "ST",
    targetId: spawn.id,
    resourceType: "energy",
  });

  creep.memory.task = heldTask;
  creep.memory.taskType = "fillTowers";
  creep.memory.working = true;

  mod.run(creep);

  check(
    "задача доставки не прервана",
    !!creep.memory.task && creep.memory.task.taskId === "tTower8",
    JSON.stringify(creep.memory.task),
  );
  check(
    "событие preempt не записано",
    !(Memory.__taskEvents && Memory.__taskEvents["preempt:fillTowers"]),
    JSON.stringify(Memory.__taskEvents),
  );
  check(
    "приоритетная задача не перехватила воркера",
    !creep.memory.task || creep.memory.task.taskId !== "tSpawn8",
    JSON.stringify(creep.memory.task),
  );
}

// ── 9. Контроль: фаза сбора (working=false) прерывается как раньше ───────
{
  console.log("\n9. Фаза сбора (working=false) прерывается приоритетной");
  initMemory();
  const room = makeRoom("R");
  // Склад с излишком: чтобы исполнитель приоритетной задачи реально пошёл
  // снимать энергию (иначе он вернёт SKIP и задача исчезнет из очереди).
  room.storage.store.energy = 200000;
  const creep = makeCreep({});
  const tower = makeStruct("TW9", 24, 28, "R", 1000, { energy: 0 });
  const spawn = makeStruct("SP9", 25, 28, "R", 300, { energy: 0 });

  const heldTask = {
    taskId: "tTower9",
    type: "transfer",
    sourceId: "ST",
    targetId: tower.id,
    resourceType: "energy",
    reservedBy: creep.name,
  };
  queueTask("fillTowers", heldTask);
  queueTask("fillSpawnsExtensions", {
    taskId: "tSpawn9",
    type: "transfer",
    sourceId: "ST",
    targetId: spawn.id,
    resourceType: "energy",
  });

  creep.memory.task = heldTask;
  creep.memory.taskType = "fillTowers";
  creep.memory.working = false;

  mod.run(creep);

  check(
    "задача сбора прервана",
    !!creep.memory.task && creep.memory.task.taskId === "tSpawn9",
    JSON.stringify(creep.memory.task),
  );
  check(
    "событие preempt записано",
    Memory.__taskEvents && Memory.__taskEvents["preempt:fillTowers"] === 1,
    JSON.stringify(Memory.__taskEvents),
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");


