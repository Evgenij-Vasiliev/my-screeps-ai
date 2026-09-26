"use strict";
/**
 * ===================================================
 * FACTORY.MANAGER.TEST.JS — офлайн-проверка производства фабрики
 * ===================================================
 * Инцидент (живой шард, 5 комнат RCL8): фабрики стояли с battery = 0, хотя
 * структура, снабжение и вывоз продукта в коде были. Найдено две причины:
 *   1) TASK_CONFIG.factory = false — room.manager вообще не вызывал
 *      factory.manager, поэтому produce() не вызывался;
 *   2) даже при включённом флаге produce() был недостижим: снабжение
 *      (fillFactoryEnergy) заливало store до 100 % (`getFreeCapacity(...) === 0`
 *      как условие остановки), а manager отказывался варить при
 *      `store.getFreeCapacity() <= 0` — хотя движок считает место как
 *      `used − components + amount > capacity` (screeps/engine,
 *      StructureFactory.prototype.produce), то есть залитая сырьём фабрика
 *      варить МОЖЕТ.
 *
 * Проверяем:
 *   1) конфиг: три фабричных флага СОВПАДАЮТ (инвариант, а не «все true»),
 *      рецепт/резерв/пороги на месте, обе категории задач (fillFactoryEnergy,
 *      collectFactoryBattery) по-прежнему в TASK_CHAIN;
 *   2) manager реально доходит до produce() — в том числе на ПОЛНОЙ фабрике;
 *   3) manager не вызывает produce() без сырья и в cooldown; порог склада на
 *      produce() НЕ влияет — produce() не трогает storage, а запирает только
 *      уже доставленную в фабрику энергию (см. §4 docs/INCOME-AND-PREEMPTION-CHECK.md);
 *   4) снабжение оставляет резерв под результат (store не заливается под 100 %);
 *   5) collectFactoryBattery не сломан и вывозит ЧУЖОЙ ресурс (не компонент
 *      рецепта и не продукт) — живой случай: 8850 H в фабрике E35S39;
 *   6) executor fillFactoryEnergy останавливается на резерве;
 *   7) решение не ломает будущие рецепты (таблица RECIPES, а не «хардкод
 *      battery»): синтетический рецепт с другим выходом работает.
 *
 * Запуск: node tests/factory.manager.test.js
 */

global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_INVALID_ARGS = -10;
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_H = "H";

global.Game = { time: 0, creeps: {}, getObjectById: () => null };
global.Memory = { rooms: { R: { tasks: {} } } };

// ── Разрешение bare-require в стиле Screeps ──────────────────────────────
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

const factoryManager = require("../factory.manager");
const taskGenerators = require("../task.generators");
const taskExecutors = require("../task.executors");
const { FACTORY, STORAGE, TERMINAL_SUPPLY, TASK_CONFIG, TASK_GEN_INTERVAL } = require("../constants");
const { TASK_CHAIN } = require("../task.manager");

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

// ── Заглушки структур ────────────────────────────────────────────────────
function makeStore(capacity, contents) {
  const data = Object.assign({}, contents || {});
  const used = () =>
    Object.keys(data).reduce((sum, k) => sum + (data[k] || 0), 0);
  return new Proxy(data, {
    get(t, prop) {
      if (prop === "getFreeCapacity") return () => capacity - used();
      if (prop === "getUsedCapacity") return () => used();
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

const FACTORY_CAPACITY = 50000;

function makeFactory(contents) {
  const produced = [];
  return {
    id: "F1",
    cooldown: 0,
    store: makeStore(FACTORY_CAPACITY, contents),
    produced,
    produce(resourceType) {
      produced.push(resourceType);
      return OK;
    },
  };
}

function makeStorage(energy) {
  return { id: "ST", store: makeStore(1000000, { energy }) };
}

function makeTerminal(energy) {
  return { id: "TE", store: makeStore(300000, { energy }) };
}

const STORAGE_PLENTY = STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER + 1;
// Терминал по умолчанию «здоров» — на цели ENERGY_TARGET. Тесты энергобюджета
// (раздел 4b) опускают его ниже цели явно.
const TERMINAL_HEALTHY = TERMINAL_SUPPLY.ENERGY_TARGET;

function roomState(factory, energy, terminalEnergy) {
  return {
    roomName: "R",
    factory,
    storage: makeStorage(energy),
    terminal: makeTerminal(
      terminalEnergy === undefined ? TERMINAL_HEALTHY : terminalEnergy,
    ),
  };
}

function resetTasks() {
  Memory.rooms.R.tasks = {};
  global._taskScan = undefined;
  global._taskIdSeq = 0;
}

function fillTasks() {
  return Memory.rooms.R.tasks.fillFactoryEnergy || [];
}

function collectTasks() {
  return Memory.rooms.R.tasks.collectFactoryBattery || [];
}

// ── 1. Конфиг ────────────────────────────────────────────────────────────
{
  console.log("\n1. Контракт конфига: три флага, рецепт и резерв");
  // Здесь держим ИНВАРИАНТ «три фабричных флага совпадают» (все вкл ИЛИ все
  // выкл), а не конкретное состояние «все true»: вкл/выкл контура — решение
  // владельца, и тест не должен с ним спорить. Инвариант ловит опасную
  // половинчатость: снабжение без производства (голодание) или производство
  // без вывоза (затор продукта). Каждый флаг обязан быть булевым: сравнение
  // трёх `undefined` тоже «совпало» бы, пропустив опечатку в имени ключа.
  // За фактический расход энергии отвечает гейт canTakeStorageEnergy
  // (раздел 4b), а не значение флага, поэтому он проверяется независимо.
  const factoryFlags = [
    ["factory", TASK_CONFIG.factory],
    ["fillFactoryEnergy", TASK_CONFIG.fillFactoryEnergy],
    ["collectFactoryBattery", TASK_CONFIG.collectFactoryBattery],
  ];
  const factoryFlagsAreBooleans = factoryFlags.every(
    ([, value]) => typeof value === "boolean",
  );
  const factoryFlagsAgree = factoryFlags.every(
    ([, value]) => value === factoryFlags[0][1],
  );
  check(
    "три фабричных флага совпадают (все вкл или все выкл)",
    factoryFlagsAreBooleans && factoryFlagsAgree,
    factoryFlags.map(([name, value]) => `${name}=${value}`).join(" "),
  );
  check(
    "активный рецепт описан в RECIPES",
    FACTORY.ACTIVE_RECIPE === "battery" &&
      !!FACTORY.RECIPES[FACTORY.ACTIVE_RECIPE],
    FACTORY.ACTIVE_RECIPE,
  );
  const recipe = FACTORY.RECIPES[FACTORY.ACTIVE_RECIPE];
  check(
    "порог сырья не изменился (600 энергии)",
    recipe.components.energy === 600,
    String(recipe.components.energy),
  );
  check("выход рецепта не изменился (50)", recipe.amount === 50, String(recipe.amount));
  check(
    "BATTERY_ENERGY_COST берётся из рецепта (единый источник)",
    FACTORY.BATTERY_ENERGY_COST === recipe.components.energy,
    String(FACTORY.BATTERY_ENERGY_COST),
  );
  check(
    "PRODUCT_RESERVE = выход продукта (> 0)",
    FACTORY.PRODUCT_RESERVE === recipe.amount && FACTORY.PRODUCT_RESERVE > 0,
    String(FACTORY.PRODUCT_RESERVE),
  );
  check(
    "обе категории задач остались в TASK_CHAIN",
    TASK_CHAIN.indexOf("fillFactoryEnergy") !== -1 &&
      TASK_CHAIN.indexOf("collectFactoryBattery") !== -1,
  );
  check(
    "троттлинг обеих категорий на месте",
    typeof TASK_GEN_INTERVAL.fillFactoryEnergy === "number" &&
      typeof TASK_GEN_INTERVAL.collectFactoryBattery === "number",
  );
}

// Разделы 2–6 проверяют ЛОГИКУ фабрики (manager, генераторы, исполнители).
// Флаги уже включены в шипнутом конфиге (см. раздел 1); выставляем их здесь
// повторно, чтобы проверки логики не зависели от значения конфига.
TASK_CONFIG.factory = true;
TASK_CONFIG.fillFactoryEnergy = true;
TASK_CONFIG.collectFactoryBattery = true;

// ── 2. produce() реально вызывается ──────────────────────────────────────
{
  console.log("\n2. Производство доходит до factory.produce()");

  const full = makeFactory({ energy: FACTORY_CAPACITY });
  factoryManager.run(roomState(full, STORAGE_PLENTY));
  check(
    "ПОЛНАЯ фабрика (50 000/50 000 энергии) всё равно варит",
    full.produced.length === 1 && full.produced[0] === "battery",
    JSON.stringify(full.produced),
  );

  const reserveEdge = makeFactory({
    energy: FACTORY_CAPACITY - FACTORY.PRODUCT_RESERVE,
  });
  factoryManager.run(roomState(reserveEdge, STORAGE_PLENTY));
  check(
    "фабрика на границе резерва варит",
    reserveEdge.produced.join(",") === "battery",
    JSON.stringify(reserveEdge.produced),
  );

  const withProduct = makeFactory({ energy: 49400, battery: FACTORY.PRODUCT_RESERVE });
  factoryManager.run(roomState(withProduct, STORAGE_PLENTY));
  check(
    "фабрика с неизвезённым продуктом продолжает варить",
    withProduct.produced.join(",") === "battery",
    JSON.stringify(withProduct.produced),
  );

  const empty = makeFactory({});
  factoryManager.run(roomState(empty, STORAGE_PLENTY));
  check(
    "пустая фабрика не варит (нет сырья)",
    empty.produced.length === 0,
    JSON.stringify(empty.produced),
  );
}

// ── 3. Гейты manager ─────────────────────────────────────────────────────
{
  console.log("\n3. Гейты: сырьё, cooldown, резерв storage, отсутствие фабрики");

  const noFactory = { roomName: "R", factory: null, storage: makeStorage(STORAGE_PLENTY) };
  let threw = false;
  try {
    factoryManager.run(noFactory);
  } catch {
    threw = true;
  }
  check("без фабрики manager не падает", threw === false);

  const short = makeFactory({ energy: 599 });
  factoryManager.run(roomState(short, STORAGE_PLENTY));
  check("599 энергии < 600 — не варит", short.produced.length === 0);

  const cooling = makeFactory({ energy: FACTORY_CAPACITY });
  cooling.cooldown = 7;
  factoryManager.run(roomState(cooling, STORAGE_PLENTY));
  check("cooldown > 0 — не варит", cooling.produced.length === 0);

  // produce() НЕ трогает склад: энергия уже лежит в фабрике. Поэтому порог
  // склада на производство не влияет — иначе доставленная энергия запирается
  // (живой инцидент E37S38: 40 731 энергии, 956 тиков без варки). Резерв склада
  // защищает генератор снабжения (блок 4), а не manager.
  const atReserve = makeFactory({ energy: FACTORY_CAPACITY });
  factoryManager.run(
    roomState(
      atReserve,
      STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER,
    ),
  );
  check(
    "storage на пороге резерва — варит (produce не трогает склад)",
    atReserve.produced.length === 1,
  );

  const zeroStorage = makeFactory({ energy: FACTORY_CAPACITY });
  factoryManager.run(roomState(zeroStorage, 0));
  check(
    "пустой склад — всё равно варит, если в фабрике есть сырьё",
    zeroStorage.produced.length === 1,
  );

  const aboveReserve = makeFactory({ energy: FACTORY_CAPACITY });
  factoryManager.run(roomState(aboveReserve, STORAGE_PLENTY));
  check("storage выше резерва — варит", aboveReserve.produced.length === 1);
}

// ── 4. Снабжение оставляет резерв под результат ──────────────────────────
{
  console.log("\n4. Снабжение не заполняет store под 100 %");
  resetTasks();

  // Регрессия инцидента: фабрика полна энергии — задача снабжения НЕ нужна.
  const fullEnergy = makeFactory({ energy: FACTORY_CAPACITY });
  taskGenerators.generateFillFactoryEnergy(roomState(fullEnergy, STORAGE_PLENTY));
  check(
    "полная энергией фабрика: задача снабжения не создаётся",
    fillTasks().length === 0,
    JSON.stringify(fillTasks()),
  );

  // Резерв уже достигнут (свободно ровно PRODUCT_RESERVE) — тоже не создаётся.
  resetTasks();
  const atReserve = makeFactory({ energy: 49900, battery: 50 });
  taskGenerators.generateFillFactoryEnergy(roomState(atReserve, STORAGE_PLENTY));
  check(
    "свободно ровно PRODUCT_RESERVE: снабжение остановлено",
    fillTasks().length === 0,
    JSON.stringify(fillTasks()),
  );

  // Есть место сверх резерва — задача создаётся.
  resetTasks();
  const hasRoom = makeFactory({ energy: 49000 });
  taskGenerators.generateFillFactoryEnergy(roomState(hasRoom, STORAGE_PLENTY));
  const queued = fillTasks();
  check("есть место сверх резерва: задача создана", queued.length === 1, JSON.stringify(queued));
  check(
    "задача ведёт storage → фабрика и везёт энергию",
    queued[0] &&
      queued[0].type === "transfer" &&
      queued[0].sourceId === "ST" &&
      queued[0].targetId === "F1" &&
      queued[0].resourceType === RESOURCE_ENERGY,
    JSON.stringify(queued[0]),
  );

  // Дедуп: повторный прогон не плодит копии.
  taskGenerators.generateFillFactoryEnergy(roomState(hasRoom, STORAGE_PLENTY));
  check("дедуп: вторая задача не создаётся", fillTasks().length === 1, String(fillTasks().length));

  // Резерв storage (экономический порог) не тронут.
  resetTasks();
  const hungry = makeFactory({});
  taskGenerators.generateFillFactoryEnergy(
    roomState(hungry, STORAGE.ENERGY_MIN * FACTORY.ENERGY_RESERVE_MULTIPLIER),
  );
  check(
    "storage на своём резерве: снабжение не запускается",
    fillTasks().length === 0,
    JSON.stringify(fillTasks()),
  );

  // Нет storage — нет задачи.
  resetTasks();
  taskGenerators.generateFillFactoryEnergy({ roomName: "R", factory: hungry, storage: null });
  check("без storage задача не создаётся", fillTasks().length === 0);
}

// ── 4b. Энергобюджет: фабрика не трогает склад, пока терминал ниже цели ──
{
  console.log("\n4b. Фабрика — последняя в очереди: резерв терминала обязателен");
  const hungry = makeFactory({});

  // Склад с излишком, но терминал ниже ENERGY_TARGET — задача НЕ создаётся.
  resetTasks();
  taskGenerators.generateFillFactoryEnergy(
    roomState(hungry, STORAGE_PLENTY, TERMINAL_SUPPLY.ENERGY_TARGET - 1),
  );
  check(
    "терминал ниже цели: задача снабжения не создаётся",
    fillTasks().length === 0,
    JSON.stringify(fillTasks()),
  );

  // Терминал ровно на цели — задача создаётся (гейт строгий только к складу).
  resetTasks();
  taskGenerators.generateFillFactoryEnergy(
    roomState(hungry, STORAGE_PLENTY, TERMINAL_SUPPLY.ENERGY_TARGET),
  );
  check(
    "терминал на цели: задача снабжения создаётся",
    fillTasks().length === 1,
    JSON.stringify(fillTasks()),
  );

  // Пустой терминал (сток обнулён) — фабрика тоже не берёт энергию.
  resetTasks();
  taskGenerators.generateFillFactoryEnergy(roomState(hungry, STORAGE_PLENTY, 0));
  check(
    "пустой терминал: задача снабжения не создаётся",
    fillTasks().length === 0,
    JSON.stringify(fillTasks()),
  );

  // Нет терминала (разрушенная комната) — энергию из склада не берём.
  resetTasks();
  taskGenerators.generateFillFactoryEnergy({
    roomName: "R",
    factory: hungry,
    storage: makeStorage(STORAGE_PLENTY),
    terminal: null,
  });
  check("нет терминала: задача снабжения не создаётся", fillTasks().length === 0);

  // Единое условие для генератора и исполнителя — сама функция контракта.
  check(
    "canTakeStorageEnergy: склад выше резерва + терминал на цели",
    factoryManager.canTakeStorageEnergy(
      makeStorage(STORAGE_PLENTY),
      makeTerminal(TERMINAL_SUPPLY.ENERGY_TARGET),
    ) === true,
  );
  check(
    "canTakeStorageEnergy: терминал ниже цели — отказ",
    factoryManager.canTakeStorageEnergy(
      makeStorage(STORAGE_PLENTY),
      makeTerminal(TERMINAL_SUPPLY.ENERGY_TARGET - 1),
    ) === false,
  );
}

// ── 5. collectFactoryBattery не сломан ───────────────────────────────────
{
  console.log("\n5. Вывоз продукта (collectFactoryBattery) работает как раньше");
  resetTasks();
  const withBattery = makeFactory({ energy: 49400, battery: 50 });
  taskGenerators.generateCollectFactoryBattery(
    roomState(withBattery, STORAGE_PLENTY),
  );
  const queued = collectTasks();
  check("есть product: задача вывоза создана", queued.length === 1, JSON.stringify(queued));
  check(
    "задача ведёт фабрика → storage и везёт battery",
    queued[0] &&
      queued[0].sourceId === "F1" &&
      queued[0].targetId === "ST" &&
      queued[0].resourceType === RESOURCE_BATTERY,
    JSON.stringify(queued[0]),
  );

  resetTasks();
  const noBattery = makeFactory({ energy: 49400 });
  taskGenerators.generateCollectFactoryBattery(
    roomState(noBattery, STORAGE_PLENTY),
  );
  check("нет product: задача не создаётся", collectTasks().length === 0);

  // Чужой ресурс (не компонент рецепта и не продукт) тоже вывозится: живой
  // случай — 8850 H в фабрике E35S39. Энергия — компонент рецепта, её не трогаем.
  resetTasks();
  const withForeign = makeFactory({ energy: 49400, H: 8850 });
  taskGenerators.generateCollectFactoryBattery(
    roomState(withForeign, STORAGE_PLENTY),
  );
  const foreign = collectTasks().filter(t => t.resourceType === RESOURCE_H);
  check(
    "чужой ресурс H: задача вывоза создана",
    foreign.length === 1,
    JSON.stringify(collectTasks()),
  );
  check(
    "задача на H ведёт фабрика → storage",
    foreign[0] &&
      foreign[0].sourceId === "F1" &&
      foreign[0].targetId === "ST" &&
      foreign[0].resourceType === RESOURCE_H,
    JSON.stringify(foreign[0]),
  );

  resetTasks();
  const both = makeFactory({ energy: 40000, H: 8850, battery: 50 });
  taskGenerators.generateCollectFactoryBattery(
    roomState(both, STORAGE_PLENTY),
  );
  const types = collectTasks()
    .map(t => t.resourceType)
    .sort();
  check(
    "battery и чужой H: две независимые задачи",
    types.join(",") === "H,battery",
    JSON.stringify(types),
  );
}

// ── 5b. Executor вывоза: работает и с чужим ресурсом ─────────────────────
{
  console.log("\n5b. Executor collectFactoryBattery вывозит чужой ресурс");
  const execute = taskExecutors.executors.collectFactoryBattery;
  const factory = makeFactory({ H: 8850 });
  const storage = makeStorage(0);
  Game.getObjectById = id => (id === "F1" ? factory : storage);

  const calls = { withdraw: [], transfer: [] };
  const task = {
    type: "transfer",
    sourceId: "F1",
    targetId: "ST",
    resourceType: RESOURCE_H,
  };

  const collector = {
    memory: {},
    store: makeStore(1000, {}),
    withdraw(target, resourceType) {
      calls.withdraw.push(resourceType);
      return OK;
    },
    transfer() {
      return OK;
    },
    travelTo() {},
  };
  const res = execute(collector, task);
  check("чужой H: executor не отклоняет задачу", res === "CONTINUE", res);
  check(
    "чужой H: withdraw с resourceType H",
    calls.withdraw.length === 1 && calls.withdraw[0] === RESOURCE_H,
    JSON.stringify(calls),
  );

  const carrier = {
    memory: { working: true },
    store: makeStore(1000, { H: 500 }),
    withdraw() {
      return OK;
    },
    transfer(target, resourceType) {
      calls.transfer.push(resourceType);
      return OK;
    },
    travelTo() {},
  };
  const res2 = execute(carrier, task);
  check(
    "чужой H: доставка в storage",
    res2 === "CONTINUE" &&
      calls.transfer[calls.transfer.length - 1] === RESOURCE_H,
    JSON.stringify(calls),
  );
}

// ── 6. Executor снабжения уважает резерв ─────────────────────────────────
{
  console.log("\n6. Executor fillFactoryEnergy останавливается на резерве");
  const execute = taskExecutors.executors.fillFactoryEnergy;

  function makeCreep(energy, working) {
    const calls = { withdraw: [], transfer: [], travel: 0 };
    const creep = {
      memory: {},
      store: makeStore(1000, energy ? { energy } : {}),
      room: { storage: null, terminal: null },
      withdraw(target, resourceType) {
        calls.withdraw.push(resourceType);
        return OK;
      },
      transfer(target, resourceType, amount) {
        calls.transfer.push({ resourceType, amount });
        return OK;
      },
      travelTo() {
        calls.travel++;
      },
      calls,
    };
    if (working !== undefined) creep.memory.working = working;
    return creep;
  }

  const storage = makeStorage(STORAGE_PLENTY);
  const satisfied = makeFactory({ energy: FACTORY_CAPACITY - FACTORY.PRODUCT_RESERVE });
  Game.getObjectById = id => (id === "F1" ? satisfied : storage);
  const task = {
    type: "transfer",
    sourceId: "ST",
    targetId: "F1",
    resourceType: RESOURCE_ENERGY,
  };

  // Фаза доставки: сырьё набрано, резерв на месте → задача завершается.
  const delivering = makeCreep(400, true);
  const res1 = execute(delivering, task);
  check("доставка на резерве: DONE", res1 === "DONE", res1);
  check("доставка на резерве: transfer не вызывался", delivering.calls.transfer.length === 0);

  // Фаза доставки, фабрике нужно сырьё → переносим.
  const hungryFactory = makeFactory({});
  Game.getObjectById = id => (id === "F1" ? hungryFactory : storage);
  const delivering2 = makeCreep(400, true);
  const res2 = execute(delivering2, task);
  check("фабрике нужно сырьё: CONTINUE", res2 === "CONTINUE", res2);
  check(
    "фабрике нужно сырьё: transfer вызван",
    delivering2.calls.transfer.length === 1 &&
      delivering2.calls.transfer[0].resourceType === RESOURCE_ENERGY,
    JSON.stringify(delivering2.calls.transfer),
  );

  // Партия режется по границе резерва: свободно 200, резерв 50 → везём 150,
  // иначе один рейс (400) съел бы весь резерв под продукт.
  const nearFull = makeFactory({ energy: FACTORY_CAPACITY - 200 });
  Game.getObjectById = id => (id === "F1" ? nearFull : storage);
  const delivering3 = makeCreep(400, true);
  const res3 = execute(delivering3, task);
  check("доставка у границы резерва: CONTINUE", res3 === "CONTINUE", res3);
  check(
    "партия ограничена резервом (150 вместо 400)",
    delivering3.calls.transfer.length === 1 &&
      delivering3.calls.transfer[0].amount === 150,
    JSON.stringify(delivering3.calls.transfer),
  );

  // Резерв уже съеден, сырья не хватает (store забит другим ресурсом):
  // amount не задаём — фабрике важнее получить сырьё.
  const stuffed = makeFactory({ energy: 100, H: 49850 });
  Game.getObjectById = id => (id === "F1" ? stuffed : storage);
  const delivering4 = makeCreep(400, true);
  execute(delivering4, task);
  check(
    "резерв съеден и сырья нет: доставка без ограничения (amount не задан)",
    delivering4.calls.transfer.length === 1 &&
      delivering4.calls.transfer[0].amount === undefined,
    JSON.stringify(delivering4.calls.transfer),
  );

  // Фаза сбора: снабжение уже закончено → не идём за энергией.
  const collector = makeCreep(0);
  collector.room.storage = storage;
  collector.room.terminal = makeTerminal(TERMINAL_HEALTHY);
  Game.getObjectById = id => (id === "F1" ? satisfied : storage);
  const res4 = execute(collector, task);
  check("сбор при готовом снабжении: DONE", res4 === "DONE", res4);
  check("сбор при готовом снабжении: withdraw не вызывался", collector.calls.withdraw.length === 0);

  // Фаза сбора при нужде в сырье → идём в storage.
  const collector2 = makeCreep(0);
  collector2.room.storage = storage;
  collector2.room.terminal = makeTerminal(TERMINAL_HEALTHY);
  Game.getObjectById = id => (id === "F1" ? hungryFactory : storage);
  const res5 = execute(collector2, task);
  check("сбор при нужде: CONTINUE", res5 === "CONTINUE", res5);
  check(
    "сбор при нужде: withdraw из storage",
    collector2.calls.withdraw.join(",") === RESOURCE_ENERGY,
    JSON.stringify(collector2.calls.withdraw),
  );

  // Энергобюджет в исполнителе: терминал ниже цели — задачу снимаем и НЕ
  // забираем энергию со склада (иначе уже стоящая в очереди задача продолжала
  // бы выедать склад после просадки терминала).
  const collector3 = makeCreep(0);
  collector3.room.storage = storage;
  collector3.room.terminal = makeTerminal(TERMINAL_SUPPLY.ENERGY_TARGET - 1);
  Game.getObjectById = id => (id === "F1" ? hungryFactory : storage);
  const res6 = execute(collector3, task);
  check("терминал ниже цели: исполнитель снимает задачу (SKIP)", res6 === "SKIP", res6);
  check(
    "терминал ниже цели: withdraw не вызывался",
    collector3.calls.withdraw.length === 0,
    JSON.stringify(collector3.calls.withdraw),
  );
}

// ── 7. Будущие рецепты: логика читает RECIPES, а не «хардкод battery» ────
{
  console.log("\n7. Новый рецепт в RECIPES работает без правок логики");
  const previousRecipe = FACTORY.ACTIVE_RECIPE;
  FACTORY.RECIPES.testcom = { components: { energy: 600, H: 100 }, amount: 300 };
  FACTORY.ACTIVE_RECIPE = "testcom";

  const ok = makeFactory({ energy: 600, H: 100 });
  factoryManager.run(roomState(ok, STORAGE_PLENTY));
  check(
    "новый рецепт: produce вызван с его именем",
    ok.produced.join(",") === "testcom",
    JSON.stringify(ok.produced),
  );

  const noH = makeFactory({ energy: 5000 });
  factoryManager.run(roomState(noH, STORAGE_PLENTY));
  check("новый рецепт: без второго компонента не варит", noH.produced.length === 0);

  // Выход больше, чем свободное место: правило движка (used − components + amount).
  const huge = { components: { energy: 100 }, amount: FACTORY_CAPACITY + 1 };
  FACTORY.RECIPES.huge = huge;
  FACTORY.ACTIVE_RECIPE = "huge";
  const cramped = makeFactory({ energy: 100 });
  factoryManager.run(roomState(cramped, STORAGE_PLENTY));
  check(
    "новый рецепт: не хватает места — produce не вызывается",
    cramped.produced.length === 0,
  );

  const spacious = makeFactory({ energy: 100 });
  spacious.store = makeStore(FACTORY_CAPACITY * 2, { energy: 100 });
  factoryManager.run(roomState(spacious, STORAGE_PLENTY));
  check(
    "новый рецепт: места хватает — produce вызывается",
    spacious.produced.join(",") === "huge",
    JSON.stringify(spacious.produced),
  );

  delete FACTORY.RECIPES.testcom;
  delete FACTORY.RECIPES.huge;
  FACTORY.ACTIVE_RECIPE = previousRecipe;
  check(
    "конфиг восстановлен (battery)",
    FACTORY.ACTIVE_RECIPE === "battery" &&
      Object.keys(FACTORY.RECIPES).join(",") === "battery",
    FACTORY.ACTIVE_RECIPE,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
