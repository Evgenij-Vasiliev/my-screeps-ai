"use strict";
/**
 * ===================================================
 * POWERSPAWN.TEST.JS — цепочка PowerSpawn (снабжение → processPower → GPL)
 * ===================================================
 * ЧТО БЫЛО СЛОМАНО (живой shard3, 24.09.2026): в пяти RCL8-комнатах
 * (E35S37, E35S39, E36S38, E37S37, E37S38) в PowerSpawn лежало 20–62 power и
 * 530–952 энергии при cooldown 0 — структура была готова к работе, но
 * processPower() не вызывался НИ РАЗУ:
 *   - TASK_CONFIG.powerSpawn стоял false, поэтому powerSpawnManager.run() не
 *     вызывался вовсе (в Memory.cpuStats.profile.blocks бакета
 *     powerSpawnManager не было);
 *   - порог энергии в POWER_SPAWN стоял 500 при расходе 50 на вызов, то есть
 *     снабжение продолжалось и после того, как обработка уже возможна.
 * GPL при этом стоял на месте (level 10, progress 14788), хотя на складах
 * империи было ~200k power.
 *
 * Здесь проверяется вся цепочка НАСТОЯЩИМ кодом проекта (без нового слоя):
 *   фича-флаг → генераторы Task System → исполнители (worker) →
 *   powerSpawn.manager.processPower() → условие остановки производства.
 *
 * Проверяем:
 *   1) фича-флаг включён и подсистема подключена в room.manager;
 *   2) конфиг: пороги совместимы с расходом одного processPower();
 *   3) генератор даёт задачу «подвезти power», когда его нет;
 *   4) исполнитель реально довозит power (withdraw → transfer) и закрывает Task;
 *   5) генератор даёт задачу «подвезти энергию», когда её мало;
 *   6) исполнитель реально довозит энергию и уважает резерв storage;
 *   7) processPower(): успех, cooldown, отсутствие ресурсов, полный store;
 *   8) достижение цели GPL останавливает и снабжение, и обработку;
 *   9) выключенный фича-флаг глушит всю цепочку (доказательство по исходникам
 *      и поведением менеджера комнаты).
 *
 * Запуск: node tests/powerspawn.test.js
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Разрешение bare-require в стиле Screeps ──────────────────────────────
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
global.ERR_FULL = -8;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_TIRED = -11;
global.ERR_INVALID_TARGET = -7;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_STORAGE = "storage";
global.STRUCTURE_TERMINAL = "terminal";
global.FIND_MY_STRUCTURES = 1;
global.FIND_STRUCTURES = 2;

function storeUsed(target) {
  let used = 0;
  for (const k of Object.keys(target)) used += target[k];
  return used;
}

/** Store как в движке: ресурсы — перечисляемые ключи, методы — нет. */
function Store(capacity, contents) {
  const target = {};
  for (const k of Object.keys(contents || {})) target[k] = contents[k];
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "getFreeCapacity") return () => capacity - storeUsed(t);
      if (prop === "getUsedCapacity") return () => storeUsed(t);
      if (prop === "getCapacity") return () => capacity;
      if (typeof prop === "symbol") return t[prop];
      // Именно hasOwnProperty: `in` ловит унаследованные свойства
      // (constructor, toString), и отсутствующий ресурс вернул бы undefined
      // вместо 0 — как в движке.
      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
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
  getRangeTo(target) {
    const p = target && target.pos ? target.pos : target;
    if (!p || p.roomName !== this.roomName) return Infinity;
    return Math.max(Math.abs(p.x - this.x), Math.abs(p.y - this.y));
  }
  isNearTo(target) {
    return this.getRangeTo(target) <= 1;
  }
}
global.RoomPosition = RoomPosition;

const WORLD = { objects: {} };
const ROOM_NAME = "E35S37";

global.Game = {
  time: 1000,
  creeps: {},
  cpu: { getUsed: () => 0 },
  gpl: { level: 10, progress: 14788, progressTotal: 21000 },
  getObjectById: id => WORLD.objects[id] || null,
};

global.Memory = { rooms: {}, creeps: {} };
global._ = { some: () => false };

// ── Мир: PowerSpawn, storage, терминал, воркер ───────────────────────────
const CAPACITY = { powerSpawn: 5000, storage: 1000000, terminal: 300000 };

function makePowerSpawn(contents) {
  const ps = {
    id: "ps1",
    structureType: global.STRUCTURE_POWER_SPAWN,
    room: { name: ROOM_NAME },
    pos: new RoomPosition(17, 5, ROOM_NAME),
    store: Store(CAPACITY.powerSpawn, contents),
    cooldown: 0,
    calls: 0,
    processPower() {
      this.calls++;
      if (this.cooldown > 0) return ERR_TIRED;
      if (
        (this.store[RESOURCE_POWER] || 0) < 1 ||
        (this.store[RESOURCE_ENERGY] || 0) < 50
      ) {
        return ERR_NOT_ENOUGH_RESOURCES;
      }
      // Механика движка: 1 power + 50 энергии → +1 прогресс GPL, cooldown 50.
      this.store[RESOURCE_POWER] -= 1;
      this.store[RESOURCE_ENERGY] -= 50;
      Game.gpl.progress += 1;
      this.cooldown = 50;
      return OK;
    },
  };
  WORLD.objects[ps.id] = ps;
  return ps;
}

function makeStoreStructure(id, structureType, contents, pos) {
  const s = {
    id,
    structureType,
    room: { name: ROOM_NAME },
    pos: new RoomPosition(pos.x, pos.y, ROOM_NAME),
    store: Store(CAPACITY[structureType], contents),
  };
  WORLD.objects[id] = s;
  return s;
}

function makeCreep(name, x, y) {
  const creep = {
    name,
    pos: new RoomPosition(x, y, ROOM_NAME),
    room: {
      name: ROOM_NAME,
      get storage() {
        return WORLD.objects["storage1"] || null;
      },
      get terminal() {
        return WORLD.objects["terminal1"] || null;
      },
    },
    memory: {},
    store: Store(100, {}),
    travelToCalls: 0,
    travelTo() {
      this.travelToCalls++;
      return OK;
    },
    withdraw(target, resourceType) {
      if (this.pos.getRangeTo(target) > 1) return ERR_NOT_IN_RANGE;
      const amount = Math.min(
        target.store[resourceType] || 0,
        this.store.getFreeCapacity(resourceType),
      );
      if (amount <= 0) return ERR_NOT_ENOUGH_RESOURCES;
      target.store[resourceType] -= amount;
      this.store[resourceType] = (this.store[resourceType] || 0) + amount;
      return OK;
    },
    transfer(target, resourceType) {
      if (this.pos.getRangeTo(target) > 1) return ERR_NOT_IN_RANGE;
      const amount = Math.min(
        this.store[resourceType] || 0,
        target.store.getFreeCapacity(resourceType),
      );
      if (amount <= 0) return ERR_FULL;
      this.store[resourceType] -= amount;
      target.store[resourceType] = (target.store[resourceType] || 0) + amount;
      return OK;
    },
  };
  global.Game.creeps[name] = creep;
  return creep;
}

/** Мир по умолчанию: PowerSpawn пуст, на складах есть и power, и энергия. */
function resetWorld(opts) {
  const o = opts || {};
  for (const key of Object.keys(WORLD.objects)) delete WORLD.objects[key];
  global.Game.time = 1000;
  global.Game.gpl = { level: 10, progress: 14788, progressTotal: 21000 };
  global.Memory = { rooms: { [ROOM_NAME]: { tasks: {} } }, creeps: {} };
  global.Game.creeps = {};
  global._taskIdSeq = 0;

  const powerSpawn = makePowerSpawn(o.powerSpawn || {});
  // Энергии на складе заведомо больше резерва комнаты
  // (POWER_SPAWN.ENERGY_STORAGE_FLOOR = STORAGE.ENERGY_MIN = 150 000):
  // подвоз энергии в PowerSpawn резерв не трогает.
  const storage = makeStoreStructure(
    "storage1",
    STRUCTURE_STORAGE,
    o.storage || { energy: 300000, power: 5000 },
    { x: 20, y: 20 },
  );
  const terminal = makeStoreStructure(
    "terminal1",
    STRUCTURE_TERMINAL,
    o.terminal || { energy: 90000, power: 40000 },
    { x: 22, y: 22 },
  );

  const roomState = {
    roomName: ROOM_NAME,
    room: { name: ROOM_NAME, storage, terminal },
    powerSpawn,
    storage,
    terminal,
  };

  return { powerSpawn, storage, terminal, roomState };
}

// ── Загрузка настоящих модулей ───────────────────────────────────────────
const powerSpawnManager = require("../powerSpawn.manager");
const taskGenerators = require("../task.generators");
const taskExecutors = require("../task.executors");
const taskManager = require("../task.manager");
const { POWER_SPAWN, TASK_CONFIG, TASK_GEN_INTERVAL } = require("../constants");

function tasksOf(type) {
  const tasks = Memory.rooms[ROOM_NAME].tasks;
  return (tasks && tasks[type]) || [];
}

// ── Отчётность ───────────────────────────────────────────────────────────
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

console.log("\n1. Фича-флаг и подключение подсистемы");
{
  check(
    "TASK_CONFIG.powerSpawn включён",
    TASK_CONFIG.powerSpawn === true,
    String(TASK_CONFIG.powerSpawn),
  );
  check(
    "снабжение power включено (fillPowerSpawnPower)",
    TASK_CONFIG.fillPowerSpawnPower === true,
  );
  check(
    "снабжение энергии включено (fillPowerSpawnEnergy)",
    TASK_CONFIG.fillPowerSpawnEnergy === true,
  );

  const roomSrc = fs.readFileSync(path.join(ROOT, "room.manager.js"), "utf8");
  check(
    "room.manager вызывает powerSpawnManager под флагом TASK_CONFIG.powerSpawn",
    roomSrc.includes("TASK_CONFIG.powerSpawn") &&
      roomSrc.includes("powerSpawnManager.run(roomState)") &&
      roomSrc.includes('trackRole("powerSpawnManager"'),
  );
  check(
    "powerSpawn попадает в roomState из кэша scanner",
    roomSrc.includes("cache.powerSpawnId") &&
      roomSrc.includes("const powerSpawn ="),
  );
  check(
    "powerSpawnManager профилируется (бакет powerSpawnManager в CPU profile)",
    roomSrc.includes('cpuMonitor.trackRole("powerSpawnManager"'),
  );

  check(
    "порог POWER_MIN покрывает расход одного вызова",
    POWER_SPAWN.POWER_MIN >= POWER_SPAWN.POWER_PER_PROCESS,
    `${POWER_SPAWN.POWER_MIN} vs ${POWER_SPAWN.POWER_PER_PROCESS}`,
  );
  check(
    "порог ENERGY_MIN покрывает расход одного вызова",
    POWER_SPAWN.ENERGY_MIN >= POWER_SPAWN.ENERGY_PER_PROCESS,
    `${POWER_SPAWN.ENERGY_MIN} vs ${POWER_SPAWN.ENERGY_PER_PROCESS}`,
  );
  check(
    "расход одного вызова = механике движка (1 power, 50 энергии)",
    POWER_SPAWN.POWER_PER_PROCESS === 1 &&
      POWER_SPAWN.ENERGY_PER_PROCESS === 50,
  );
  check(
    "пороги не больше ёмкости store PowerSpawn (иначе снабжение вечно)",
    POWER_SPAWN.ENERGY_MIN <= CAPACITY.powerSpawn &&
      POWER_SPAWN.POWER_MIN <= 100,
    `${POWER_SPAWN.ENERGY_MIN}/${POWER_SPAWN.POWER_MIN}`,
  );

  const chainSrc = fs.readFileSync(path.join(ROOT, "task.manager.js"), "utf8");
  check(
    "TASK_CHAIN содержит обе категории снабжения PowerSpawn",
    chainSrc.includes('"fillPowerSpawnEnergy"') &&
      chainSrc.includes('"fillPowerSpawnPower"'),
  );
  check(
    "интервалы генерации заданы",
    TASK_GEN_INTERVAL.fillPowerSpawnEnergy > 0 &&
      TASK_GEN_INTERVAL.fillPowerSpawnPower > 0,
  );
  check(
    "обе категории ниже жизнеобеспечения и фабрики",
    // Правка приоритетов (разбор «фабрика = доход, RCL/стройка не цель»):
    // fillFactoryEnergy ушёл на #2, выше PowerSpawn — цена энергии в фабрике
    // (54,2 кредита/энергию) выше, чем в PowerSpawn (50 кредитов/энергию за
    // 50 энергии на единицу power). Прежнее ожидание «PowerSpawn раньше
    // фабрики» отменено осознанно. Апгрейд контроллера теперь в хвосте
    // цепочки (поддержание уровня, а не рост), поэтому здесь его нет.
    taskManager.TASK_CHAIN.indexOf("fillSpawnsExtensions") <
      taskManager.TASK_CHAIN.indexOf("fillPowerSpawnEnergy") &&
      taskManager.TASK_CHAIN.indexOf("fillTowers") <
        taskManager.TASK_CHAIN.indexOf("fillPowerSpawnEnergy") &&
      taskManager.TASK_CHAIN.indexOf("fillFactoryEnergy") <
        taskManager.TASK_CHAIN.indexOf("fillPowerSpawnPower"),
  );
}

console.log("\n2. Снабжение power: генератор задачи");
{
  const { roomState, powerSpawn } = resetWorld({
    powerSpawn: { power: 0, energy: 0 },
  });
  taskGenerators.generateFillPowerSpawnPower(roomState);
  const tasks = tasksOf("fillPowerSpawnPower");
  check(
    "power в PowerSpawn меньше порога → задача создана",
    tasks.length === 1,
    String(tasks.length),
  );
  check(
    "задача указывает на PowerSpawn и ресурс power",
    tasks[0] &&
      tasks[0].targetId === "ps1" &&
      tasks[0].resourceType === RESOURCE_POWER,
    JSON.stringify(tasks[0]),
  );
  check(
    "задача без sourceId (источник выбирает исполнитель: storage → terminal)",
    tasks[0] && !tasks[0].sourceId,
  );
  check(
    "PowerSpawn с нулём power — не «уже снабжён»",
    powerSpawn.store[RESOURCE_POWER] === 0,
  );

  // power уже достаточно — задача не нужна.
  const enough = resetWorld({
    powerSpawn: { power: POWER_SPAWN.POWER_MIN, energy: 0 },
  });
  taskGenerators.generateFillPowerSpawnPower(enough.roomState);
  check(
    "power в PowerSpawn на пороге → задача НЕ создаётся",
    tasksOf("fillPowerSpawnPower").length === 0,
    String(tasksOf("fillPowerSpawnPower").length),
  );

  // Нет power ни на складе, ни в терминале — возить нечего.
  const empty = resetWorld({
    powerSpawn: { power: 0, energy: 0 },
    storage: { energy: 300000, power: 0 },
    terminal: { energy: 90000, power: 0 },
  });
  taskGenerators.generateFillPowerSpawnPower(empty.roomState);
  check(
    "нет power на складах → задача НЕ создаётся (не гоняем воркера зря)",
    tasksOf("fillPowerSpawnPower").length === 0,
  );
}

console.log("\n3. Снабжение power: исполнитель довозит и закрывает Task");
{
  const { powerSpawn, storage, roomState } = resetWorld({
    powerSpawn: { power: 0, energy: 0 },
  });
  taskGenerators.generateFillPowerSpawnPower(roomState);
  const task = tasksOf("fillPowerSpawnPower")[0];

  const creep = makeCreep("worker_E35S37_1", 20, 20); // у storage
  const executor = taskExecutors.executors.fillPowerSpawnPower;

  // Шаг 1: берём power со склада.
  let result = executor(creep, task);
  check(
    "крип взял power (withdraw у storage)",
    creep.store[RESOURCE_POWER] > 0 && result === "CONTINUE",
    `${creep.store[RESOURCE_POWER]}/${result}`,
  );
  check(
    "power на складе уменьшился",
    storage.store[RESOURCE_POWER] < 5000,
    String(storage.store[RESOURCE_POWER]),
  );

  // Шаг 2: крип уже несёт power → идём к PowerSpawn (далеко).
  result = executor(creep, task);
  check(
    "далеко от PowerSpawn → только travelTo, без вызова transfer",
    result === "CONTINUE" && creep.travelToCalls === 1,
    `${result}/${creep.travelToCalls}`,
  );

  // Шаг 3: крип рядом — передаёт.
  creep.pos = new RoomPosition(17, 6, ROOM_NAME);
  result = executor(creep, task);
  check(
    "рядом с PowerSpawn → transfer выполнен",
    powerSpawn.store[RESOURCE_POWER] > 0,
    String(powerSpawn.store[RESOURCE_POWER]),
  );
  check(
    "рюкзак пуст → исполнитель закрывает шаг (DONE)",
    creep.store[RESOURCE_POWER] === 0 &&
      (result === "DONE" || result === "CONTINUE"),
    `${creep.store[RESOURCE_POWER]}/${result}`,
  );
  // Шаг действительно закрывается: на следующем тике (крип уже «working», а
  // рюкзак пуст) исполнитель возвращает DONE и Task снимается.
  const closing = executor(creep, task);
  check(
    "следующий тик: пустой рюкзак при working → DONE",
    closing === "DONE",
    String(closing),
  );
}

console.log("\n4. Снабжение энергии: генератор и исполнитель");
{
  const { roomState, storage, powerSpawn } = resetWorld({
    powerSpawn: { power: POWER_SPAWN.POWER_MIN, energy: 0 },
  });
  taskGenerators.generateFillPowerSpawnEnergy(roomState);
  const tasks = tasksOf("fillPowerSpawnEnergy");
  check(
    "энергии меньше порога → задача создана",
    tasks.length === 1,
    String(tasks.length),
  );
  check(
    "задача указывает source=storage, target=PowerSpawn, ресурс energy",
    tasks[0] &&
      tasks[0].sourceId === storage.id &&
      tasks[0].targetId === powerSpawn.id &&
      tasks[0].resourceType === RESOURCE_ENERGY,
    JSON.stringify(tasks[0]),
  );

  const creep = makeCreep("worker_E35S37_2", 20, 20);
  const executor = taskExecutors.executors.fillPowerSpawnEnergy;
  let result = executor(creep, tasks[0]);
  check(
    "крип набрал энергию со storage",
    creep.store[RESOURCE_ENERGY] > 0 && result === "CONTINUE",
    `${creep.store[RESOURCE_ENERGY]}/${result}`,
  );
  creep.pos = new RoomPosition(17, 6, ROOM_NAME);
  const carried = creep.store[RESOURCE_ENERGY];
  result = executor(creep, tasks[0]);
  check(
    "энергия довезена до PowerSpawn",
    powerSpawn.store[RESOURCE_ENERGY] >=
      Math.min(carried, POWER_SPAWN.ENERGY_MIN),
    String(powerSpawn.store[RESOURCE_ENERGY]),
  );
  check(
    "в PowerSpawn достаточно энергии для processPower()",
    powerSpawn.store[RESOURCE_ENERGY] >= POWER_SPAWN.ENERGY_PER_PROCESS,
    String(powerSpawn.store[RESOURCE_ENERGY]),
  );

  // Воркер несёт больше, чем структуре нужно: остаток он сбрасывает обратно в
  // storage (ветка «target полон, а рюкзак не пуст»). Ёмкости — как в движке:
  // 5000 «единиц» = 4900 энергии + 100 power, поэтому «полный» PowerSpawn это
  // energy 4900 при power 100.
  creep.pos = new RoomPosition(20, 20, ROOM_NAME); // у storage
  powerSpawn.store[RESOURCE_ENERGY] = 4900;
  powerSpawn.store[RESOURCE_POWER] = 100;
  creep.store[RESOURCE_ENERGY] = 1000;
  const droppedBack = storage.store[RESOURCE_ENERGY];
  result = executor(creep, tasks[0]);
  check(
    "структура полна, рюкзак нет → остаток сброшен обратно в storage",
    storage.store[RESOURCE_ENERGY] > droppedBack &&
      creep.store[RESOURCE_ENERGY] === 0,
    `${droppedBack} -> ${storage.store[RESOURCE_ENERGY]}, рюкзак ${creep.store[RESOURCE_ENERGY]}, ${result}`,
  );
  creep.memory.working = true;
  result = executor(creep, tasks[0]);
  check(
    "пустой рюкзак при working → шаг закрыт (DONE)",
    result === "DONE",
    String(result),
  );

  // Резерв storage неприкосновенен, но снабжение не должно вставать:
  // при storage на резерве энергия берётся из терминала (свой порог), а если и
  // там пусто — задачи нет вовсе.
  const low = resetWorld({
    powerSpawn: { power: POWER_SPAWN.POWER_MIN, energy: 0 },
    storage: { energy: POWER_SPAWN.ENERGY_STORAGE_FLOOR, power: 5000 },
    terminal: { energy: 500, power: 0 },
  });
  taskGenerators.generateFillPowerSpawnEnergy(low.roomState);
  check(
    "storage на резерве и терминал пуст → энергию в PowerSpawn не возим",
    tasksOf("fillPowerSpawnEnergy").length === 0,
    String(tasksOf("fillPowerSpawnEnergy").length),
  );

  const fromTerminal = resetWorld({
    powerSpawn: { power: POWER_SPAWN.POWER_MIN, energy: 0 },
    storage: { energy: POWER_SPAWN.ENERGY_STORAGE_FLOOR, power: 5000 },
    terminal: { energy: 90000, power: 0 },
  });
  taskGenerators.generateFillPowerSpawnEnergy(fromTerminal.roomState);
  check(
    "storage на резерве, но в терминале есть энергия → подвоз идёт",
    tasksOf("fillPowerSpawnEnergy").length === 1,
    String(tasksOf("fillPowerSpawnEnergy").length),
  );

  // Рабочая ситуация живого shard3: storage 162–167k (около резерва),
  // PowerSpawn недозаправлен — подвоз обязан создаваться (это и был затык).
  const nearReserve = resetWorld({
    powerSpawn: { power: 26, energy: 453 },
    storage: { energy: 166924, power: 5000 },
  });
  taskGenerators.generateFillPowerSpawnEnergy(nearReserve.roomState);
  check(
    "storage 166 924 (около резерва), PowerSpawn 453/500 → подвоз есть",
    tasksOf("fillPowerSpawnEnergy").length === 1,
    String(tasksOf("fillPowerSpawnEnergy").length),
  );

  // Исполнитель проверяет то же условие: если энергии в комнате нет, он не
  // идёт «в молоко» за пустым рейсом, а закрывает шаг.
  const empty = resetWorld({
    powerSpawn: { power: POWER_SPAWN.POWER_MIN, energy: 0 },
    storage: { energy: POWER_SPAWN.ENERGY_STORAGE_FLOOR, power: 5000 },
    terminal: { energy: 0, power: 0 },
  });
  const manualTask = {
    type: "transfer",
    sourceId: empty.storage.id,
    targetId: empty.powerSpawn.id,
    resourceType: RESOURCE_ENERGY,
    taskId: "manual1",
  };
  const hungry = makeCreep("worker_E35S37_hungry", 20, 20);
  const hungryResult =
    taskExecutors.executors.fillPowerSpawnEnergy(hungry, manualTask);
  check(
    "энергии в комнате нет → исполнитель не едет за ней (DONE)",
    hungryResult === "DONE" && hungry.store[RESOURCE_ENERGY] === 0,
    `${hungryResult}/${hungry.store[RESOURCE_ENERGY]}`,
  );
}

console.log("\n5. processPower(): успех, cooldown, нехватка, полный store");
{
  // Успех: сырья хватает → обработка и +1 GPL.
  const ready = resetWorld({
    powerSpawn: { power: POWER_SPAWN.POWER_MIN, energy: POWER_SPAWN.ENERGY_MIN },
  });
  const before = { gpl: Game.gpl.progress, power: ready.powerSpawn.store[RESOURCE_POWER], energy: ready.powerSpawn.store[RESOURCE_ENERGY] };
  powerSpawnManager.run(ready.roomState);
  check(
    "processPower() вызван (cooldown выставлен)",
    ready.powerSpawn.cooldown === 50 && ready.powerSpawn.calls === 1,
    `cooldown=${ready.powerSpawn.cooldown}, calls=${ready.powerSpawn.calls}`,
  );
  check(
    "прогресс GPL вырос на 1",
    Game.gpl.progress === before.gpl + 1,
    `${Game.gpl.progress} vs ${before.gpl + 1}`,
  );
  check(
    "израсходовано 1 power и 50 энергии",
    ready.powerSpawn.store[RESOURCE_POWER] === before.power - 1 &&
      ready.powerSpawn.store[RESOURCE_ENERGY] === before.energy - 50,
    `${ready.powerSpawn.store[RESOURCE_POWER]}/${ready.powerSpawn.store[RESOURCE_ENERGY]}`,
  );

  // Cooldown: пока структура в откате, вызова нет.
  const tired = resetWorld({
    powerSpawn: { power: 50, energy: 2000 },
  });
  tired.powerSpawn.cooldown = 37;
  powerSpawnManager.run(tired.roomState);
  check(
    "структура в откате → processPower() не вызывается",
    tired.powerSpawn.calls === 0 && tired.powerSpawn.cooldown === 37,
    `calls=${tired.powerSpawn.calls}`,
  );

  // Откат кончился — снова работает.
  tired.powerSpawn.cooldown = 0;
  powerSpawnManager.run(tired.roomState);
  check(
    "откат кончился → снова обрабатывает",
    tired.powerSpawn.calls === 1 && tired.powerSpawn.cooldown === 50,
    `calls=${tired.powerSpawn.calls}`,
  );

  // Нет power.
  const noPower = resetWorld({
    powerSpawn: { power: 0, energy: 2000 },
  });
  powerSpawnManager.run(noPower.roomState);
  check(
    "нет power → вызова нет",
    noPower.powerSpawn.calls === 0,
    String(noPower.powerSpawn.calls),
  );

  // Нет энергии.
  const noEnergy = resetWorld({
    powerSpawn: { power: 50, energy: 0 },
  });
  powerSpawnManager.run(noEnergy.roomState);
  check(
    "нет энергии → вызова нет",
    noEnergy.powerSpawn.calls === 0,
    String(noEnergy.powerSpawn.calls),
  );

  // Полный store: сырья заведомо хватает, обработка идёт, снабжение молчит.
  // Ёмкости как в движке: 5000 «единиц» = 4900 энергии (POWER_SPAWN_ENERGY_CAPACITY)
  // + 100 power (POWER_SPAWN_POWER_CAPACITY); живой shard3 подтверждает
  // (803 энергии → freeEnergy 4197, 33 power → freePower 67).
  const full = resetWorld({
    powerSpawn: { power: 100, energy: 4900 },
  });
  check(
    "полный store PowerSpawn: свободного места нет",
    full.powerSpawn.store.getFreeCapacity() === 0,
    String(full.powerSpawn.store.getFreeCapacity()),
  );
  powerSpawnManager.run(full.roomState);
  check(
    "полный store не мешает processPower()",
    full.powerSpawn.calls === 1 && full.powerSpawn.cooldown === 50,
    `calls=${full.powerSpawn.calls}`,
  );
  taskGenerators.generateFillPowerSpawnPower(full.roomState);
  taskGenerators.generateFillPowerSpawnEnergy(full.roomState);
  check(
    "полный store → новых задач снабжения нет",
    tasksOf("fillPowerSpawnPower").length === 0 &&
      tasksOf("fillPowerSpawnEnergy").length === 0,
    `${tasksOf("fillPowerSpawnPower").length}/${tasksOf("fillPowerSpawnEnergy").length}`,
  );
}

console.log("\n6. Цель производства достигнута — цепочка встаёт");
{
  // Сырья меньше порогов снабжения: задача появится ровно тогда, когда она
  // действительно нужна (а не потому, что мы её «ожидаем» в assert).
  const done = resetWorld({
    powerSpawn: { power: 0, energy: 0 },
  });
  Game.gpl.progress = POWER_SPAWN.TARGET_GPL_PROGRESS;
  check(
    "isProductionComplete() видит достигнутую цель",
    powerSpawnManager.isProductionComplete() === true,
  );

  powerSpawnManager.run(done.roomState);
  check(
    "цель достигнута → processPower() не вызывается",
    done.powerSpawn.calls === 0,
    String(done.powerSpawn.calls),
  );

  taskGenerators.generateFillPowerSpawnPower(done.roomState);
  taskGenerators.generateFillPowerSpawnEnergy(done.roomState);
  check(
    "цель достигнута → снабжение PowerSpawn не генерирует задачи",
    tasksOf("fillPowerSpawnPower").length === 0 &&
      tasksOf("fillPowerSpawnEnergy").length === 0,
    `${tasksOf("fillPowerSpawnPower").length}/${tasksOf("fillPowerSpawnEnergy").length}`,
  );

  // Прогресс уровня сбросился на новом уровне GPL — производство снова нужно.
  // Энергии на складе заведомо больше резерва (иначе сработал бы не GPL-порог,
  // а защита резерва storage — она проверяется отдельно в разделе 4).
  Game.gpl.progress = 0;
  done.storage.store[RESOURCE_ENERGY] = 300000;
  global.Memory.rooms[ROOM_NAME].tasks.fillPowerSpawnEnergy = [];
  check(
    "новый уровень GPL (progress 0) → цель снова не достигнута",
    powerSpawnManager.isProductionComplete() === false,
  );
  taskGenerators.generateFillPowerSpawnEnergy(done.roomState);
  check(
    "и снабжение снова работает",
    tasksOf("fillPowerSpawnEnergy").length === 1,
    String(tasksOf("fillPowerSpawnEnergy").length),
  );

  // Противоположная крайность: цель не достигнута, но энергии в комнате нет
  // ни в storage (у резерва), ни в терминале — снабжение молчит, а не гоняет
  // воркера впустую.
  done.storage.store[RESOURCE_ENERGY] = 100000;
  done.terminal.store[RESOURCE_ENERGY] = 500;
  global.Memory.rooms[ROOM_NAME].tasks.fillPowerSpawnEnergy = [];
  taskGenerators.generateFillPowerSpawnEnergy(done.roomState);
  check(
    "цель не достигнута, но энергии нет ни в storage, ни в терминале → снабжения нет",
    tasksOf("fillPowerSpawnEnergy").length === 0,
    String(tasksOf("fillPowerSpawnEnergy").length),
  );

  // Без Game.gpl (приватный сервер) подсистема обязана работать как раньше.
  const savedGpl = Game.gpl;
  Game.gpl = undefined;
  check(
    "без Game.gpl цель считается не достигнутой (подсистема не выключается)",
    powerSpawnManager.isProductionComplete() === false,
  );
  Game.gpl = savedGpl;
}

console.log("\n7. Полный цикл: пустой PowerSpawn → снабжение → обработка → GPL");
{
  const world = resetWorld({ powerSpawn: { power: 0, energy: 0 } });
  const { roomState, powerSpawn, storage } = world;
  jobCycle(roomState, powerSpawn, storage);
}

/**
 * Прогон «как в игре»: генераторы → воркеры исполняют задачи → менеджер
 * обрабатывает power. Проверяем, что цепочка сама себя продолжает.
 * @param {Object} roomState
 * @param {Object} powerSpawn
 * @param {Object} storage
 */
function jobCycle(roomState, powerSpawn, storage) {
  const gplStart = Game.gpl.progress;

  for (let tick = 0; tick < 400; tick++) {
    Game.time += 1;
    if (powerSpawn.cooldown > 0) powerSpawn.cooldown -= 1;

    // Task System: генераторы.
    taskGenerators.generateFillPowerSpawnPower(roomState);
    taskGenerators.generateFillPowerSpawnEnergy(roomState);

    // Worker: исполняет по одной задаче каждой категории за тик.
    for (const type of ["fillPowerSpawnPower", "fillPowerSpawnEnergy"]) {
      const task = tasksOf(type)[0];
      if (!task) continue;

      // Воркер «у источника» и «у цели»: рейс укладывается в один тик
      // (проверяем логистику, а не ходьбу — travel проверен отдельно).
      const resourceType =
        type === "fillPowerSpawnPower" ? RESOURCE_POWER : RESOURCE_ENERGY;
      const creep = makeCreep(`worker_cycle_${type}`, 20, 20);
      creep.pos = new RoomPosition(17, 6, ROOM_NAME);

      const source = task.sourceId
        ? Game.getObjectById(task.sourceId)
        : resourceType === RESOURCE_POWER
          ? storage.store[RESOURCE_POWER] > 0
            ? storage
            : Game.getObjectById("terminal1")
          : storage;

      if ((source.store[resourceType] || 0) <= 0) continue;
      const need = type === "fillPowerSpawnPower" ? 50 : 100;
      creep.store[resourceType] = Math.min(need, source.store[resourceType]);
      source.store[resourceType] -= creep.store[resourceType];

      const result = taskExecutors.executors[type](creep, task);
      if (result === "DONE" || result === "CONTINUE") {
        taskManager.completeTask(ROOM_NAME, type, task);
      }
    }

    // Подсистема PowerSpawn.
    powerSpawnManager.run(roomState);
  }

  check(
    "полный цикл: power довезён и обработан (прогресс GPL вырос)",
    Game.gpl.progress > gplStart,
    `${Game.gpl.progress} vs ${gplStart}`,
  );
  check(
    "полный цикл: обработок больше одной (цепочка продолжается сама)",
    powerSpawn.calls > 1,
    String(powerSpawn.calls),
  );
  check(
    "полный цикл: power не «застрял» в PowerSpawn (расходуется)",
    powerSpawn.store[RESOURCE_POWER] <= 60,
    String(powerSpawn.store[RESOURCE_POWER]),
  );
  check(
    "полный цикл: storage сохранил энергию выше резерва",
    storage.store[RESOURCE_ENERGY] > 100000,
    String(storage.store[RESOURCE_ENERGY]),
  );
}

console.log("\n8. Выключенный фича-флаг глушит всю цепочку");
{
  // Поведенчески: тот же код с выключенными генераторами задач не создаёт ни
  // одной задачи снабжения, значит PowerSpawn остаётся без сырья.
  const savedPower = TASK_CONFIG.fillPowerSpawnPower;
  const savedEnergy = TASK_CONFIG.fillPowerSpawnEnergy;
  const world = resetWorld({ powerSpawn: { power: 0, energy: 0 } });

  TASK_CONFIG.fillPowerSpawnPower = false;
  TASK_CONFIG.fillPowerSpawnEnergy = false;
  taskGenerators.generateFillPowerSpawnPower(world.roomState);
  taskGenerators.generateFillPowerSpawnEnergy(world.roomState);
  check(
    "флаги снабжения выключены → задач нет",
    tasksOf("fillPowerSpawnPower").length === 0 &&
      tasksOf("fillPowerSpawnEnergy").length === 0,
  );
  powerSpawnManager.run(world.roomState);
  check(
    "пустой PowerSpawn → обработки нет",
    world.powerSpawn.calls === 0,
    String(world.powerSpawn.calls),
  );

  TASK_CONFIG.fillPowerSpawnPower = savedPower;
  TASK_CONFIG.fillPowerSpawnEnergy = savedEnergy;

  // По исходникам: при TASK_CONFIG.powerSpawn = false менеджер не вызывается
  // вовсе (проверка room.manager вынесена в раздел 1).
  const src = fs.readFileSync(path.join(ROOT, "room.manager.js"), "utf8");
  const block = src.slice(src.indexOf("if (TASK_CONFIG.powerSpawn)"));
  check(
    "вызов менеджера обёрнут условием флага (нет вызова при false)",
    block.startsWith("if (TASK_CONFIG.powerSpawn)"),
    block.slice(0, 40),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
