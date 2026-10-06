"use strict";
/**
 * ===================================================
 * ECON.TEST.JS — политика постоянного роста запасов (econ.js)
 * ===================================================
 * Проверяется ровно то, ради чего модуль написан (требование владельца
 * 05.10.2026: «никаких целей — это тренд: и хранилище, и терминал должны
 * расти постоянно, приход всегда опережает расход»):
 *
 *   1) храповик склада: максимум растёт и НИКОГДА не падает;
 *   2) запись в Memory только при превышении ECON.WRITE_QUANTUM
 *      (Memory сериализуется целиком каждый тик — empire.js:21-25);
 *   3) пол склада = max(STORAGE.ENERGY_MIN, максимум - FLEX_STORAGE):
 *      ниже 150 000 храповик не опускает поведение, пока не набрал высоту;
 *   4) свободные средства не отрицательны и считаются от пола;
 *   5) доля терминала = (склад + терминал) x TERMINAL_SHARE — рост
 *      распределяется, поэтому растут ОБА хранилища;
 *   6) econ.canFillTerminal — ОДНО условие для генератора и исполнителя:
 *      нет места / доля достигнута / свободных меньше полного рейса → нельзя;
 *   7) разделение исходов для исполнителя: «терминал на доле» — это DONE,
 *      «склад ещё не может дать» — это SKIP (иначе задача-зомби в очереди);
 *   8) точки отката без перевыгрузки: Memory.econOff и ECON.ENABLED
 *      возвращают ПРЕЖНЕЕ условие (склад > 195 000, терминал < ENERGY_TARGET);
 *   9) на отсутствующих структурах (до RCL 4/6) ничего не падает.
 *
 * Числа сверены с живым замером shard3 (tick 83449927): склады 189 637..
 * 196 153, терминалы 98 141..112 993 — при них ПРЕЖНЕЕ условие наполнения
 * (склад > 195 000) не выполнялось практически никогда.
 *
 * Запуск: node tests/econ.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("econ") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

global.RESOURCE_ENERGY = "energy";
global.Memory = {};
// Game.time нужен регулятору роста (econ.trackGrowth) — в бою его даёт движок.
global.Game = { time: 1000 };

const { STORAGE, TERMINAL_SUPPLY, ECON } = require("../constants");
const econ = require("../econ");

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

const ROOM = "W1N1";
const TERMINAL_CAPACITY = 300000;

/** Склад с заданной энергией. getFreeCapacity считает остаток до миллиона. */
function makeStorage(energy) {
  return {
    store: {
      [RESOURCE_ENERGY]: energy,
      getFreeCapacity: () => 1000000 - energy,
    },
  };
}

/**
 * Терминал: energy энергии, otherResources — занято неэнергетическими
 * ресурсами (живой замер: их ~145 000), capacity — ёмкость (300 000).
 */
function makeTerminal(energy, otherResources = 0, capacity = TERMINAL_CAPACITY) {
  return {
    store: {
      [RESOURCE_ENERGY]: energy,
      getFreeCapacity: () => capacity - energy - otherResources,
    },
  };
}

function roomState(storageEnergy, terminalEnergy, otherResources = 0) {
  return {
    roomName: ROOM,
    storage: storageEnergy === null ? null : makeStorage(storageEnergy),
    terminal: terminalEnergy === null ? null : makeTerminal(terminalEnergy, otherResources),
  };
}

function resetEconMemory() {
  delete Memory.econ;
  delete Memory.econOff;
}

console.log("\n1. Храповик: максимум растёт и не падает");
resetEconMemory();
const r1 = roomState(196000, 100000);
econ.observe(r1);
check("первое наблюдение зафиксировало максимум склада", econ.storageHighWater(ROOM) === 196000, String(econ.storageHighWater(ROOM)));
check("и максимум терминала", econ.terminalHighWater(ROOM) === 100000, String(econ.terminalHighWater(ROOM)));

econ.observe(roomState(190000, 95000));
check(
  "падение запаса максимум НЕ опускает (ratchet)",
  econ.storageHighWater(ROOM) === 196000 && econ.terminalHighWater(ROOM) === 100000,
  `${econ.storageHighWater(ROOM)}/${econ.terminalHighWater(ROOM)}`,
);

econ.observe(roomState(199000, 101000));
check("рост выше максимума записывается", econ.storageHighWater(ROOM) === 199000, String(econ.storageHighWater(ROOM)));

console.log("\n2. Запись в Memory — только при превышении WRITE_QUANTUM");
const before = Memory.econ.s[ROOM];
econ.observe(roomState(before + ECON.WRITE_QUANTUM - 1, 101000));
check(
  "прирост меньше кванта в Memory не пишется",
  Memory.econ.s[ROOM] === before,
  `${Memory.econ.s[ROOM]} vs ${before}`,
);

econ.observe(roomState(before + ECON.WRITE_QUANTUM + 1, 101000));
check(
  "прирост больше кванта записывается",
  Memory.econ.s[ROOM] === before + ECON.WRITE_QUANTUM + 1,
  String(Memory.econ.s[ROOM]),
);

console.log("\n3. Пол склада: max(STORAGE.ENERGY_MIN, максимум - FLEX_STORAGE)");
resetEconMemory();
econ.observe(roomState(200000, 100000));
check(
  "высокий максимум даёт пол выше базового резерва",
  econ.storageFloor(ROOM) === 200000 - ECON.FLEX_STORAGE,
  `${econ.storageFloor(ROOM)} vs ${200000 - ECON.FLEX_STORAGE}`,
);

resetEconMemory();
econ.observe(roomState(100000 + ECON.WRITE_QUANTUM + 1, 100000));
check(
  "низкий максимум не опускает пол ниже STORAGE.ENERGY_MIN",
  econ.storageFloor(ROOM) === STORAGE.ENERGY_MIN,
  `${econ.storageFloor(ROOM)} vs ${STORAGE.ENERGY_MIN}`,
);

resetEconMemory();
check(
  "ненаблюдавшаяся комната: пол равен базовому резерву",
  econ.storageFloor("W9N9") === STORAGE.ENERGY_MIN,
  String(econ.storageFloor("W9N9")),
);

console.log("\n4. Свободные средства склада");
resetEconMemory();
econ.observe(roomState(200000, 100000));
const floor = econ.storageFloor(ROOM);
check("freeStorage выше пола", econ.freeStorage(roomState(190000, 100000)) === 190000 - floor, String(econ.freeStorage(roomState(190000, 100000))));
check("freeStorage на полу — ноль", econ.freeStorage(roomState(floor, 100000)) === 0, String(econ.freeStorage(roomState(floor, 100000))));
check(
  "freeStorage ниже пола не отрицателен",
  econ.freeStorage(roomState(100000, 100000)) === 0,
  String(econ.freeStorage(roomState(100000, 100000))),
);
check("freeStorage без склада — ноль", econ.freeStorage(roomState(null, 100000)) === 0);

console.log("\n5. Доля терминала распределяет рост между двумя хранилищами");
const target = econ.terminalShareTarget(roomState(200000, 100000));
check(
  "доля = (склад + терминал) x TERMINAL_SHARE",
  target === Math.floor((200000 + 100000) * ECON.TERMINAL_SHARE),
  `${target} vs ${Math.floor((200000 + 100000) * ECON.TERMINAL_SHARE)}`,
);
check(
  "рост склада поднимает долю терминала (растут оба)",
  econ.terminalShareTarget(roomState(300000, 100000)) > target,
  `${econ.terminalShareTarget(roomState(300000, 100000))} vs ${target}`,
);

// Потолок ДИНАМИЧЕСКИЙ: энергия не может занять место, нужное ресурсам
// (живой замер: терминалы заняты ~250k из 300k — E ~100k, прочее ~145k).
const packed = roomState(2000000, 100000, 145000);
check(
  "потолок защищает место под ресурсы терминала",
  econ.terminalShareTarget(packed) ===
    TERMINAL_CAPACITY - 145000 - ECON.TERMINAL_FREE_RESERVE,
  `${econ.terminalShareTarget(packed)} vs ${TERMINAL_CAPACITY - 145000 - ECON.TERMINAL_FREE_RESERVE}`,
);

const empty = roomState(2000000, 100000, 0);
check(
  "пустой от ресурсов терминал допускает больше энергии",
  econ.terminalShareTarget(empty) > econ.terminalShareTarget(packed),
  `${econ.terminalShareTarget(empty)} vs ${econ.terminalShareTarget(packed)}`,
);

console.log("\n6. canFillTerminal — одно условие для генератора и исполнителя");
resetEconMemory();
econ.observe(roomState(200000, 100000));
const okRoom = roomState(200000, 100000);
check(
  "склад выше пола и терминал ниже доли — можно",
  econ.canFillTerminal(okRoom.storage, okRoom.terminal, ROOM) === true,
);

const fullTerminal = roomState(200000, TERMINAL_CAPACITY);
check(
  "в терминале нет места — нельзя",
  econ.canFillTerminal(fullTerminal.storage, fullTerminal.terminal, ROOM) === false,
);

const atShare = roomState(200000, 200000);
check(
  "терминал на доле — нельзя",
  econ.canFillTerminal(atShare.storage, atShare.terminal, ROOM) === false,
);

const lowFree = roomState(floor + ECON.MIN_TRANSFER_FREE - 1, 50000);
check(
  "свободных меньше полного рейса воркера — нельзя",
  econ.canFillTerminal(lowFree.storage, lowFree.terminal, ROOM) === false,
);

const atCap = roomState(2000000, TERMINAL_CAPACITY - 145000 - ECON.TERMINAL_FREE_RESERVE, 145000);
check(
  "терминал на динамическом потолке — нельзя (место под ресурсы)",
  econ.canFillTerminal(atCap.storage, atCap.terminal, ROOM) === false,
);

const noStorage = roomState(null, 100000);
check(
  "без склада — нельзя",
  econ.canFillTerminal(noStorage.storage, noStorage.terminal, ROOM) === false,
);
check(
  "без терминала — нельзя",
  econ.canFillTerminal(okRoom.storage, null, ROOM) === false,
);

console.log("\n7. Исходы исполнителя: доля — DONE, нехватка средств — SKIP");
check(
  "терминал на доле распознаётся отдельно",
  econ.terminalReachedShare(okRoom.storage, atShare.terminal) === true,
);
check(
  "полный терминал распознаётся как достигнутая доля",
  econ.terminalReachedShare(okRoom.storage, fullTerminal.terminal) === true,
);
check(
  "терминал ниже доли долей не считается",
  econ.terminalReachedShare(okRoom.storage, okRoom.terminal) === false,
);
check(
  "нехватка свободных средств — это пауза, а не исчерпание",
  econ.hasFreeForTransfer(lowFree.storage, ROOM) === false &&
    econ.terminalReachedShare(lowFree.storage, lowFree.terminal) === false,
);

console.log("\n8. Точки отката возвращают ПРЕЖНЕЕ условие");
resetEconMemory();
// Прежнее поведение: склад > 195 000 и терминал < ENERGY_TARGET.
const legacyRoom = roomState(196000, 100000);
Memory.econOff = true;
check("Memory.econOff выключает политику", econ.enabled() === false);
check(
  "при выключенной политике работает прежнее условие (можно)",
  econ.canFillTerminal(legacyRoom.storage, legacyRoom.terminal, ROOM) === true,
);
const legacyLow = roomState(194000, 100000);
check(
  "при выключенной политике склад 194 000 НЕ наполняет терминал (как раньше)",
  econ.canFillTerminal(legacyLow.storage, legacyLow.terminal, ROOM) === false,
);
const legacyTarget = roomState(196000, TERMINAL_SUPPLY.ENERGY_TARGET);
check(
  "при выключенной политике терминал на ENERGY_TARGET считается полным",
  econ.canFillTerminal(legacyTarget.storage, legacyTarget.terminal, ROOM) === false,
);
delete Memory.econOff;
check("снятие econOff включает политику обратно", econ.enabled() === true);

const savedEnabled = ECON.ENABLED;
ECON.ENABLED = false;
check("ECON.ENABLED = false тоже выключает политику", econ.enabled() === false);
ECON.ENABLED = savedEnabled;

console.log("\n9. Политика включена по умолчанию, запись в Memory — объект econ");
resetEconMemory();
check("по умолчанию политика включена", econ.enabled() === true);
econ.observe(roomState(200000, 100000));
check("Memory.econ создан", !!Memory.econ && !!Memory.econ.s && !!Memory.econ.t);
econ.observe(roomState(null, null));
check("комната без склада и терминала не падает и не пишет мусор", econ.storageHighWater("W2N2") === 0);

console.log("\n10. Регулятор роста: стоки разрешены, только пока империя растёт");
resetEconMemory();
delete global.__econAcc;
Game.time = 1000;
econ.observe(roomState(200000, 100000));
check(
  "первый замер: скорости ещё нет",
  econ.growthRate() === 0,
  String(econ.growthRate()),
);
check(
  "без факта роста опциональные стоки ЗАПРЕЩЕНЫ",
  econ.optionalAllowed() === false,
);

// Скорость считается по ФАКТИЧЕСКОМУ запасу (аккумулятор за тик), поэтому
// первая точка фиксируется на втором тике, а окно закрывается на третьем:
// сумма прошлого тика 300 000 -> 310 000 за 200 тиков = +50/тик.
Game.time = 1000 + ECON.GROWTH_WINDOW;
econ.observe(roomState(210000, 100000));
check(
  "первая точка роста зафиксирована",
  econ.growthRate() === 0,
  String(econ.growthRate()),
);

Game.time = 1000 + 2 * ECON.GROWTH_WINDOW;
econ.observe(roomState(210000, 100000));
check(
  "рост за окно даёт скорость 10000/200 = 50",
  econ.growthRate() === 50,
  String(econ.growthRate()),
);
check(
  "при росте стоки разрешены",
  econ.optionalAllowed() === true,
);

Game.time = 1000 + 3 * ECON.GROWTH_WINDOW;
econ.observe(roomState(150000, 100000));
check(
  "запас упал → стоки снова запрещены",
  econ.optionalAllowed() === false,
  `rate=${econ.growthRate()}`,
);
check(
  "максимум при этом НЕ откатился (храповик)",
  econ.storageHighWater(ROOM) === 210000,
  String(econ.storageHighWater(ROOM)),
);

Memory.econOff = true;
check(
  "при выключенной политике стоки разрешены (прежнее поведение)",
  econ.optionalAllowed() === true,
);
delete Memory.econOff;

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
