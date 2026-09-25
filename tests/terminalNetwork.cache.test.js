"use strict";
/**
 * ===================================================
 * TERMINALNETWORK.CACHE.TEST.JS — офлайн-проверка кешей и диагностики
 * ===================================================
 * Правки (подтверждённые проблемы subagent_logistics/subagent_cpu):
 *   6. collectRoomStates перебирал весь Game.rooms каждый тик — теперь список
 *      СВОИХ комнат с терминалом кешируется в heap на CACHE.REFRESH_INTERVAL
 *      тиков, а чужие видимые комнаты в него не попадают;
 *   7. resetExports больше не пишет Memory.rooms[*].terminalExports = {} каждый
 *      тик: объект трогается, только если в нём есть заявки (Memory не «пачкается»
 *      в тики без отправок), а заявки текущего тика по-прежнему дописывает
 *      addExport;
 *   8. конфиги троек и объекты лабораторий берутся из тикового кеша:
 *      labWorker.getConfigs и Game.getObjectById вызываются один раз на комнату
 *      за тик, а не на каждый реагент и не внутри компараторов сортировки;
 *   9. ошибки Terminal.send различаются (ERR_FULL / ERR_NOT_ENOUGH_ENERGY /
 *      ERR_INVALID_ARGS / ERR_TIRED); политика отправок (false — продолжаем
 *      обход) не изменилась.
 *
 * Запуск: node tests/terminalNetwork.cache.test.js
 */

// ── Глобалы движка, нужные модулю ────────────────────────────────────────
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_POWER = "power";
global.OK = 0;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_FULL = -8;
global.ERR_INVALID_ARGS = -10;
global.ERR_TIRED = -11;

// ── Разрешение bare-require в стиле Screeps ─────────────────────────────
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

// ── Game.rooms с подсчётом перебора ключей ──────────────────────────────
const roomIterations = { n: 0 };
const labStore = {};
let objectByIdCalls = 0;

function setLabStores(stores) {
  for (const k in stores) labStore[k] = fakeStore(stores[k]);
}

/**
 * Game уровня теста: часы сохраняются между вызовами (иначе кеш, привязанный к
 * Game.time, «оживал» бы при пересоздании объекта), а перебор ключей Game.rooms
 * считается прокси — именно его убирает кеш списка комнат.
 */
function setRooms(rooms) {
  const time = global.Game && typeof global.Game.time === "number" ? global.Game.time : 1000;
  global.Game = {
    time,
    creeps: {},
    market: { calcTransactionCost: () => 100 },
    getObjectById: id => {
      objectByIdCalls++;
      return labStore[id] ? { id, store: labStore[id] } : null;
    },
    rooms: new Proxy(rooms, {
      ownKeys(target) {
        roomIterations.n++;
        return Reflect.ownKeys(target);
      },
    }),
  };
}

global.Memory = { rooms: {} };

function fakeStore(amounts) {
  return Object.assign({}, amounts);
}

function makeRoom(name, opts) {
  const options = opts || {};
  const terminal =
    options.terminal === null
      ? null
      : {
          room: { name },
          cooldown: options.cooldown || 0,
          store: fakeStore(
            Object.assign({ energy: 50000 }, options.terminalStore || {}),
          ),
          send: options.send || (() => OK),
        };
  const storage =
    options.storage === null
      ? null
      : {
          store: fakeStore(
            Object.assign({ energy: 200000 }, options.storageStore || {}),
          ),
        };
  return {
    name,
    memory: options.memory || {},
    controller: { my: options.owned === undefined ? true : options.owned },
    terminal,
    storage,
  };
}

const tn = require("../terminalNetwork");
const labWorker = require("../lab.worker");
const { CACHE, TERMINAL_NETWORK, TERMINAL_SUPPLY, LAB_BOOST } = require("../constants");

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

function resetHeap() {
  global._terminalRoomNames = undefined;
  global._terminalLabs = undefined;
}

function labMemory(configs) {
  const memory = {};
  configs.forEach((config, i) => {
    memory[i === 0 ? "labs" : "labs" + (i + 1)] = config;
  });
  return memory;
}

// ── 6. Список своих комнат с терминалом ─────────────────────────────────
{
  console.log("\n6. collectRoomStates: свои комнаты с терминалом, кеш на тик");
  resetHeap();
  roomIterations.n = 0;
  global.Memory = { rooms: {} };
  setRooms({
    A: makeRoom("A"),
    B: makeRoom("B", { terminal: null }), // своя комната без терминала
    C: makeRoom("C", { owned: false }), // ЧУЖАЯ видимая комната с терминалом
    D: makeRoom("D"),
  });

  const first = tn.collectRoomStates();
  check(
    "только свои комнаты с терминалом (A, D)",
    first.length === 2 && first[0].room.name === "A" && first[1].room.name === "D",
    first.map(s => s.room.name).join(","),
  );
  check("чужой терминал не попал в сеть", !first.some(s => s.room.name === "C"));
  check("перебор Game.rooms был один раз", roomIterations.n === 1, String(roomIterations.n));

  tn.collectRoomStates();
  Game.time++;
  tn.collectRoomStates();
  check(
    "внутри TTL список берётся из heap (без перебора)",
    roomIterations.n === 1,
    String(roomIterations.n),
  );

  // Устаревшая запись кэша не должна ломать run: терминал снесли.
  global.Game.rooms.D.terminal = null;
  const stale = tn.collectRoomStates();
  check(
    "снесённый терминал пропускается сразу",
    stale.length === 1 && stale[0].room.name === "A",
    stale.map(s => s.room.name).join(","),
  );

  Game.time += CACHE.REFRESH_INTERVAL;
  tn.collectRoomStates();
  check(
    `через CACHE.REFRESH_INTERVAL (${CACHE.REFRESH_INTERVAL}) список пересобран`,
    roomIterations.n === 2,
    String(roomIterations.n),
  );
}

// ── 7. resetExports и заявки ────────────────────────────────────────────
{
  console.log("\n7. resetExports: Memory не трогается, если заявок нет");
  resetHeap();
  global.Memory = { rooms: {} };
  setRooms({ A: makeRoom("A"), B: makeRoom("B") });
  const states = tn.collectRoomStates();

  tn.resetExports(states);
  check(
    "в тике без заявок Memory.rooms не создаётся",
    Memory.rooms.A === undefined && Memory.rooms.B === undefined,
    JSON.stringify(Memory.rooms),
  );

  Memory.rooms.A = { terminalExports: { U: 100, K: 5 } };
  tn.resetExports(states);
  check(
    "прошлые заявки сняты",
    Object.keys(Memory.rooms.A.terminalExports).length === 0,
    JSON.stringify(Memory.rooms.A.terminalExports),
  );

  tn.addExport("A", "U", 2500);
  check(
    "addExport по-прежнему пишет заявку",
    Memory.rooms.A.terminalExports.U === 2500,
    JSON.stringify(Memory.rooms.A.terminalExports),
  );
}

// ── 7b. Сквозной run(): заявка на догрузку терминала сохраняется ─────────
{
  console.log("\n7b. run(): нехватка реагента у донора превращается в заявку");
  resetHeap();
  global.Memory = { rooms: {} };
  objectByIdCalls = 0;
  setLabStores({
    A1: { U: 0 },
    A2: {},
    A3: {},
    B1: { U: 0 },
    B2: {},
    B3: {},
  });
  const cfgU = { lab1: "A1", lab2: "A2", reactor: "A3", reagent1: "U", reagent2: "H" };
  const cfgU2 = { lab1: "B1", lab2: "B2", reactor: "B3", reagent1: "U", reagent2: "H" };
  setRooms({
    A: makeRoom("A", {
      memory: labMemory([cfgU]),
      terminalStore: { U: 0 },
      storageStore: { U: 0 },
    }),
    // У донора ресурс только в storage: в терминале его меньше MIN_SEND_AMOUNT,
    // поэтому сеть ставит экспортную заявку (воркеры догрузят терминал).
    B: makeRoom("B", {
      memory: labMemory([cfgU2]),
      terminalStore: { U: 10 },
      storageStore: { U: 30000 },
    }),
  });
  Game.time += 100;

  tn.run();

  const exports = (Memory.rooms.B || {}).terminalExports || {};
  check(
    "заявка на догрузку терминала выставлена",
    exports.U >= TERMINAL_NETWORK.MIN_SEND_AMOUNT,
    JSON.stringify(exports),
  );
  check(
    "заявка не выставлена комнате-получателю",
    !Memory.rooms.A || !Memory.rooms.A.terminalExports ||
      !Memory.rooms.A.terminalExports.U,
    JSON.stringify(Memory.rooms.A),
  );
}

// ── 8. Тиковый кеш лабораторий ──────────────────────────────────────────
{
  console.log("\n8. resourceInLabs/roomUsesReagent: getObjectById и getConfigs — раз в тик");
  resetHeap();
  global.Memory = { rooms: {} };
  setLabStores({ L1: { U: 100 }, L2: { U: 30 }, L3: { U: 5 } });
  setRooms({
    A: makeRoom("A", {
      memory: labMemory([
        { lab1: "L1", lab2: "L2", reactor: "L3", reagent1: "U", reagent2: "H" },
      ]),
    }),
  });
  const room = Game.rooms.A;

  let getConfigsCalls = 0;
  const origGetConfigs = labWorker.getConfigs;
  labWorker.getConfigs = function (r) {
    getConfigsCalls++;
    return origGetConfigs.call(this, r);
  };

  objectByIdCalls = 0;
  Game.time += 100;
  const total = tn.resourceInLabs(room, "U");
  check("сумма по трём лабам", total === 135, String(total));
  check("разрешены ровно 3 уникальные лабы", objectByIdCalls === 3, String(objectByIdCalls));
  check("getConfigs вызван один раз", getConfigsCalls === 1, String(getConfigsCalls));

  const second = tn.resourceInLabs(room, "U");
  check("повторный вызов берёт кеш (0 getObjectById)", objectByIdCalls === 3 && second === 135, String(objectByIdCalls));
  check(
    "roomUsesReagent без новых обращений",
    tn.roomUsesReagent(room, "U") === true &&
      tn.roomUsesReagent(room, "Z") === false &&
      objectByIdCalls === 3 &&
      getConfigsCalls === 1,
    `${objectByIdCalls}/${getConfigsCalls}`,
  );

  Game.time++;
  objectByIdCalls = 0;
  getConfigsCalls = 0;
  tn.resourceInLabs(room, "U");
  check(
    "новый тик — кеш пересобран",
    objectByIdCalls === 3 && getConfigsCalls === 1,
    `${objectByIdCalls}/${getConfigsCalls}`,
  );

  // Одна и та же лаба в двух слотах по-прежнему считается дважды (как раньше).
  setLabStores({ L1: { U: 10 } });
  resetHeap();
  Game.time++;
  setRooms({
    A: makeRoom("A", {
      memory: labMemory([
        { lab1: "L1", lab2: "L1", reactor: null, reagent1: "U", reagent2: "H" },
      ]),
    }),
  });
  check(
    "кратность слотов сохранена (дубль id считается дважды)",
    tn.resourceInLabs(Game.rooms.A, "U") === 20,
    String(tn.resourceInLabs(Game.rooms.A, "U")),
  );

  labWorker.getConfigs = origGetConfigs;
}

// ── 8b. availableToGive: лабораторный запас донора тоже излишек ─────────
{
  console.log(
    "\n8b. availableToGive: реагент в лабораториях донора тоже считается",
  );
  // Живой shard3: у единственного производителя KH2O (E35S39) реагент лежал и в
  // терминале (1500), и в лабе его же активной тройки (2750), но сеть видела
  // только терминал и вычитала LAB_KEEP 3000 → availableToGive = 0, донора нет,
  // KH2O не уезжал НИКОГДА. По империи работала 1 реакция из 15, буст-лабы
  // стояли пустыми, бустов не было ни у одного крипа.
  resetHeap();
  global.Memory = { rooms: {} };
  Game.time += 100;
  setLabStores({ L1: { KH2O: 2750 } });
  setRooms({
    A: makeRoom("A", {
      terminalStore: { KH2O: 1500 },
      memory: labMemory([
        { lab1: "L1", lab2: "L2", reactor: "L3", reagent1: "KH2O", reagent2: "X" },
      ]),
    }),
    B: makeRoom("B"),
  });
  const states = tn.collectRoomStates();
  const donor = states.find(s => s.room.name === "A");

  check(
    "roomUsesReagent(A, KH2O): комната тратит этот реагент сама",
    tn.roomUsesReagent(Game.rooms.A, "KH2O") === true,
  );
  check(
    `1500 в терминале + 2750 в лабе → отдаёт излишек выше LAB_KEEP (${TERMINAL_NETWORK.LAB_KEEP})`,
    tn.availableToGive(donor, "KH2O") === 4250 - TERMINAL_NETWORK.LAB_KEEP,
    String(tn.availableToGive(donor, "KH2O")),
  );
  check(
    "излишек проходит порог отправки MIN_SEND_AMOUNT",
    tn.availableToGive(donor, "KH2O") >= TERMINAL_NETWORK.MIN_SEND_AMOUNT,
    String(TERMINAL_NETWORK.MIN_SEND_AMOUNT),
  );

  // Контроль: без лабораторного запаса излишек падает НИЖЕ минимальной отправки
  // — ровно так донор выглядел для сети ДО фикса (1500 − LAB_KEEP), и findDonor
  // его отбрасывал: «полный склад в лабе, но отдать нечего».
  setLabStores({ L1: {} });
  resetHeap();
  Game.time++;
  check(
    "без запаса в лабе излишка меньше MIN_SEND_AMOUNT (донор отбрасывается)",
    tn.availableToGive(donor, "KH2O") < TERMINAL_NETWORK.MIN_SEND_AMOUNT,
    String(tn.availableToGive(donor, "KH2O")),
  );
}

// ── 9. Ошибки Terminal.send различаются ─────────────────────────────────
{
  console.log("\n9. send: коды ошибок различимы, политика та же");
  resetHeap();
  global.Memory = { rooms: {} };

  const logged = [];
  const origLog = console.log;
  // Логи модуля перехватываем, но продолжаем печатать: check() пишет через
  // console.log, и без этого отчёт теста пропал бы целиком.
  console.log = (...args) => {
    const line = args.join(" ");
    logged.push(line);
    origLog(line);
  };

  function attempt(errorCode) {
    logged.length = 0;
    resetHeap();
    setRooms({
      A: makeRoom("A", {
        // Энергии в терминале донора должно хватать на комиссию
        // (TERMINAL_SUPPLY.ENERGY_MIN), иначе fitSendAmount не дойдёт до send.
        terminalStore: {
          energy: TERMINAL_SUPPLY.ENERGY_MIN + 50000,
          U: 20000,
        },
        send: () => errorCode,
      }),
      B: makeRoom("B", { terminalStore: {} }),
    });
    Game.time++;
    const from = tn.collectRoomStates()[0];
    const to = tn.collectRoomStates()[1];
    to.terminal.store.getFreeCapacity = () => 100000;
    const ok = tn.send(from, to, "U", 3000);
    return { ok, log: logged.join(" | ") };
  }

  for (const [name, code] of [
    ["ERR_FULL", ERR_FULL],
    ["ERR_NOT_ENOUGH_ENERGY", ERR_NOT_ENOUGH_ENERGY],
    ["ERR_INVALID_ARGS", ERR_INVALID_ARGS],
    ["ERR_TIRED", ERR_TIRED],
  ]) {
    const r = attempt(code);
    check(`${name}: send вернул false (политика не изменилась)`, r.ok === false);
    check(`${name}: причина названа в логе`, r.log.indexOf(name) !== -1, r.log);
  }

  const unknown = attempt(-99);
  check("неизвестный код печатается с номером", unknown.log.indexOf("-99") !== -1, unknown.log);

  const success = attempt(OK);
  check("OK: send вернул true", success.ok === true, success.log);
  check("OK: отправка залогирована", success.log.indexOf("→") !== -1, success.log);

  console.log = origLog;
  check(
    "минимальная отправка не отправляется мелочью",
    TERMINAL_NETWORK.MIN_SEND_AMOUNT === 1000 &&
      TERMINAL_SUPPLY.ENERGY_MIN > 0,
    "константы сети не менялись",
  );
}

// ── 11. Резерв конечных бустов хаба: ПОРОГ, а не полный запрет ──────────
// Семантика изменена осознанно (ТЗ «boosts для рабочих комнат»). Прежний жёсткий
// запрет (availableToGive = 0 для продукта хаба) защищал резерв экспансии, но
// блокировал экспорт бустов ЦЕЛИКОМ: бусты для рабочих комнат производит хаб, и
// в живом shard3 буст-лабы всех пяти комнат оставались пустыми, а
// Memory.__boostMetric по всем комнатам равнялся "no stock".
// Что осталось неприкосновенным: HUB_RESERVE (уходит только излишек ВЫШЕ него) и
// ресурсы, которых в таблице резервов нет вовсе — для них по-прежнему 0
// (fail-closed), и именно так заморожен запас экспансии XKHO2/XLHO2.
{
  console.log("\n11. Резерв конечных бустов E35S37: порог вместо запрета");
  resetHeap();
  global.Memory = { rooms: {} };

  const hubMemory = labMemory([
    {
      lab1: "L1",
      lab2: "L2",
      reactor: "R1",
      recipeA: { reagent1: "ZHO2", reagent2: "X", product: "XZHO2" },
      recipeB: { reagent1: "KHO2", reagent2: "X", product: "XKHO2" },
      reagent1: "ZHO2",
      reagent2: "X",
      product: "XZHO2",
      active: "A",
    },
  ]);
  Memory.rooms.E35S37 = hubMemory;
  Memory.rooms.W1N1 = {};

  const sent = [];
  // Терминал движка: send(resourceType, amount, targetRoomName).
  const spy = (roomName) => (resourceType, amount, target) => {
    sent.push({ from: roomName, to: target, resourceType, amount });
    return OK;
  };

  const hub = makeRoom("E35S37", {
    memory: hubMemory,
    // Энергия донора выше TERMINAL_SUPPLY.ENERGY_MIN: иначе неприоритетная
    // балансировка (K) не дойдёт до send и тест проверял бы не то.
    terminalStore: { energy: 200000, XZHO2: 20000, XKHO2: 5000, K: 20000 },
    send: spy("E35S37"),
  });
  const plain = makeRoom("W1N1", {
    memory: Memory.rooms.W1N1,
    terminalStore: { energy: 200000 },
    send: spy("W1N1"),
  });
  setLabStores({ L1: { ZHO2: 3000 }, L2: { X: 3000 }, R1: { XZHO2: 200 } });
  setRooms({ E35S37: hub, W1N1: plain });

  // Store с методом getFreeCapacity (как в движке): нужен пути Terminal.send.
  // Метод не enumerable, иначе он попал бы в collectResourceTypes как «ресурс».
  const withCapacity = (store, capacity) => {
    const used = () =>
      Object.keys(store).reduce((sum, k) => sum + store[k], 0);
    Object.defineProperty(store, "getFreeCapacity", {
      value: () => capacity - used(),
      enumerable: false,
    });
    Object.defineProperty(store, "getUsedCapacity", {
      value: used,
      enumerable: false,
    });
    return store;
  };
  withCapacity(hub.terminal.store, 300000);
  withCapacity(plain.terminal.store, 300000);

  const hubState = {
    room: hub,
    terminal: hub.terminal,
    storage: hub.storage,
  };

  check(
    "isHubReserve: продукт тройки хаба — резерв",
    tn.isHubReserve(hub, "XZHO2") === true,
  );
  check(
    "isHubReserve: продукт тройки НЕ хаба резервом не считается",
    tn.isHubReserve(hub, "K") === false &&
      tn.isHubReserve(plain, "XZHO2") === false,
  );
  check(
    "availableToGive у хаба = запас минус HUB_RESERVE (порог, а не ноль)",
    tn.availableToGive(hubState, "XZHO2") ===
      20000 - LAB_BOOST.HUB_RESERVE.XZHO2,
    String(tn.availableToGive(hubState, "XZHO2")),
  );
  check(
    "буст вне таблицы резервов хаб не отдаёт вовсе (fail-closed: XKHO2)",
    tn.availableToGive(hubState, "XKHO2") === 0,
    String(tn.availableToGive(hubState, "XKHO2")),
  );
  check(
    "нерезервированный ресурс хаба по-прежнему доступен (K)",
    tn.availableToGive(hubState, "K") > 0,
  );

  // Интеграционно: излишек XZHO2 уезжает, но НЕ ниже HUB_RESERVE, а запас
  // экспансии (XKHO2) не уезжает вообще.
  tn.run();
  const moved = sent.filter(
    (s) => s.from === "E35S37" && s.resourceType === "XZHO2",
  );
  const movedAmount = moved.reduce((sum, s) => sum + s.amount, 0);
  check(
    "XZHO2 из хаба уходит, но остаток не опускается ниже HUB_RESERVE",
    20000 - movedAmount >= LAB_BOOST.HUB_RESERVE.XZHO2,
    JSON.stringify(sent),
  );
  check(
    "XKHO2 (запас экспансии) из хаба не вывезен",
    !sent.some((s) => s.resourceType === "XKHO2"),
    JSON.stringify(sent),
  );

  // Второй прогон: заявка на буст больше не занимает тик (резерв W1N1 закрыт),
  // поэтому видно, что обычная балансировка ресурсов работает как прежде.
  sent.length = 0;
  plain.terminal.store.XZHO2 = TERMINAL_NETWORK.RESOURCE_DEFICIT_BELOW;
  tn.run();
  check(
    "обычный ресурс (K) хаб по-прежнему отдаёт по балансировке",
    sent.some((s) => s.resourceType === "K" && s.from === "E35S37"),
    JSON.stringify(sent),
  );
}

// ── 12. Заявки на локальный резерв бустов рабочей комнаты ───────────────
// Раньше заявок на бусты не существовало вовсе: collectLabRequests собирает
// список только из РЕАГЕНТОВ тройки, а буст — продукт. Поэтому даже при
// снятом запрете экспорта буст не уехал бы: сеть не знала, что комната в нём
// нуждается. Проверяем три состояния: ниже резерва (заявка есть), на резерве
// (заявки нет), хаб на своём резерве (отдавать нечего — заявки нет).
{
  console.log("\n12. Заявки на локальный резерв бустов (ROOM_RESERVE)");
  resetHeap();
  global.Memory = { rooms: {} };

  const hubMemory = labMemory([
    {
      lab1: "L1",
      lab2: "L2",
      reactor: "R1",
      recipeA: { reagent1: "KH2O", reagent2: "X", product: "XKH2O" },
      recipeB: { reagent1: "ZHO2", reagent2: "X", product: "XZHO2" },
      reagent1: "KH2O",
      reagent2: "X",
      product: "XKH2O",
      active: "A",
    },
  ]);
  Memory.rooms.E35S37 = hubMemory;
  Memory.rooms.W1N1 = {};

  const sent = [];
  const spy = (roomName) => (resourceType, amount, target) => {
    sent.push({ from: roomName, to: target, resourceType, amount });
    return OK;
  };
  const hub = makeRoom("E35S37", {
    memory: hubMemory,
    terminalStore: { energy: 200000, XKH2O: 12000 },
    send: spy("E35S37"),
  });
  const workerRoom = makeRoom("W1N1", {
    memory: Memory.rooms.W1N1,
    terminalStore: { energy: 200000 },
    send: spy("W1N1"),
  });
  setLabStores({ L1: { KH2O: 3000 }, L2: { X: 3000 }, R1: {} });
  setRooms({ E35S37: hub, W1N1: workerRoom });

  const states = tn.collectRoomStates();
  const boostReqs = tn.collectBoostRequests(states).filter(
    (r) => r.resourceType === "XKH2O",
  );
  check(
    "комната ниже ROOM_RESERVE запрашивает буст",
    boostReqs.length === 1 &&
      boostReqs[0].state.room.name === "W1N1" &&
      boostReqs[0].needed >= TERMINAL_NETWORK.MIN_SEND_AMOUNT,
    JSON.stringify(boostReqs),
  );
  check(
    "заявка на буст идёт с приоритетом (энергопол PRIORITY_ENERGY_FLOOR)",
    boostReqs.length === 1 && boostReqs[0].priority === 1,
    JSON.stringify(boostReqs),
  );

  // Резерв комнаты закрыт — заявки нет (иначе она занимала бы тик вечно).
  // Тик сдвигается намеренно: network мемоизирует запасы на тик
  // (terminalNetwork.availableToGive/resourceInLabs, см. getRoomLabInfo), а
  // смена складов «в середине тика» — это сценарий теста, а не живого тика: в
  // игре склады меняют крипы и реакции ДО сети, а отправка сети завершает run().
  Game.time++;
  workerRoom.terminal.store.XKH2O = LAB_BOOST.ROOM_RESERVE.XKH2O;
  check(
    "комната на своём резерве буст не запрашивает",
    tn.collectBoostRequests(tn.collectRoomStates()).filter(
      (r) => r.resourceType === "XKH2O",
    ).length === 0,
  );

  // Хаб на своём резерве: отдавать нечего — заявка не создаётся.
  Game.time++;
  workerRoom.terminal.store.XKH2O = 0;
  hub.terminal.store.XKH2O = LAB_BOOST.HUB_RESERVE.XKH2O;
  check(
    "хаб на своём резерве — заявка не создаётся (нечего отдавать)",
    tn.collectBoostRequests(tn.collectRoomStates()).filter(
      (r) => r.resourceType === "XKH2O",
    ).length === 0,
  );
}

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
