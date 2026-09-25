"use strict";
/**
 * ===================================================
 * TRAVELER.INCOMPLETE.TEST.JS — оффлайн-проверка правок traveler.js
 * ===================================================
 * Что проверяем (правки от 18.09.2026 по логу «TRAVELER: incomplete path»):
 * 1. Пробка в узле базы: поиск «с крипами» (ignoreCreeps = false после
 *    застревания) вернул incomplete → Traveler повторяет поиск по структурной
 *    матрице и берёт валидный маршрут вместо пустого.
 * 2. Лог про одну и ту же неудачную цель печатается один раз за
 *    incompleteReportCooldown тиков (раньше — на каждый пересчёт пути).
 * 3. Если пути нет совсем (пустой partial path) — следующий поиск откладывается
 *    на noPathRetryTicks тиков (раньше дорогой PathFinder.search вызывался каждый тик).
 * 4. Смена цели сбрасывает и «уже жаловались», и паузу «нет пути».
 * 5. Прежнее поведение не сломано: обычный полный путь кэшируется и крип шагает;
 *    retry через useFindRoute = false остался.
 *
 * Заглушки окружения Screeps — минимальные, только то, что читает Traveler.
 * Запуск: node tests/traveler.incomplete.test.js
 */

const assert = require("assert");
const _ = require("lodash");

// ── ЗАГЛУШКИ ОКРУЖЕНИЯ ──────────────────────────────────────────────────
const DIR_OFFSET = {
  1: [0, -1],
  2: [1, -1],
  3: [1, 0],
  4: [1, 1],
  5: [0, 1],
  6: [-1, 1],
  7: [-1, 0],
  8: [-1, -1],
};

class RoomPosition {
  constructor(x, y, roomName) {
    this.x = x;
    this.y = y;
    this.roomName = roomName;
  }
  inRangeTo(target, range) {
    return this.getRangeTo(target) <= range;
  }
  getRangeTo(target) {
    if (target.roomName !== undefined && target.roomName !== this.roomName) {
      return Infinity;
    }
    return Math.max(Math.abs(this.x - target.x), Math.abs(this.y - target.y));
  }
  getDirectionTo(target) {
    const dx = Math.sign(target.x - this.x);
    const dy = Math.sign(target.y - this.y);
    for (const dir of Object.keys(DIR_OFFSET)) {
      if (DIR_OFFSET[dir][0] === dx && DIR_OFFSET[dir][1] === dy) return Number(dir);
    }
    return 0;
  }
  toString() {
    return "[room " + this.roomName + " pos " + this.x + "," + this.y + "]";
  }
}

global._ = _;
global.Memory = {};
global.Game = {
  time: 1000,
  cpu: { getUsed: () => 0 },
  map: { getRoomLinearDistance: () => 0 },
  rooms: {},
};
global.RoomPosition = RoomPosition;
global.OK = 0;
global.ERR_NO_PATH = -2;
global.ERR_BUSY = -4;
global.ERR_INVALID_ARGS = -10;

const Traveler = require("../traveler")({
  exportTraveler: true,
  installTraveler: false,
  installPrototype: false,
});

// ── ВСПОМОГАТЕЛЬНОЕ ─────────────────────────────────────────────────────
/**
 * Строит корректный (соседний по клеткам) путь из старта по списку направлений.
 * @param {RoomPosition} start
 * @param {number[]} dirs
 * @returns {RoomPosition[]}
 */
function buildPath(start, dirs) {
  const path = [];
  let x = start.x;
  let y = start.y;
  for (const dir of dirs) {
    x += DIR_OFFSET[dir][0];
    y += DIR_OFFSET[dir][1];
    path.push(new RoomPosition(x, y, start.roomName));
  }
  return path;
}

function makeCreep(x, y, travel) {
  return {
    name: "worker_E35S39_test",
    pos: new RoomPosition(x, y, "E35S39"),
    fatigue: 0,
    spawning: false,
    room: {
      name: "E35S39",
      controller: { owner: {}, my: true },
    },
    memory: {
      _travel: Object.assign(
        { stuck: 0, tick: Game.time, cpu: 0, count: 0 },
        travel,
      ),
    },
    moved: null,
    move(dir) {
      this.moved = dir;
      return OK;
    },
  };
}

/**
 * Создаёт Traveler с программным findTravelPath.
 * @param {Array<Object|Function>} results очередь результатов поиска
 */
function makeTraveler(results) {
  const traveler = new Traveler();
  const calls = [];
  let index = 0;
  traveler.findTravelPath = (creep, destPos, options = {}) => {
    calls.push({
      ignoreCreeps: options.ignoreCreeps,
      useFindRoute: options.useFindRoute,
      maxOps: options.maxOps,
    });
    const item = results[Math.min(index, results.length - 1)];
    index++;
    return typeof item === "function" ? item() : item;
  };
  return { traveler, calls };
}

/** Ловит console.log на время вызова. */
const logs = [];
const originalLog = console.log;
console.log = (...args) => logs.push(args.join(" "));

/** Простой счётчик пройденных проверок. */
let passed = 0;
function ok(name) {
  passed++;
  originalLog("  ok — " + name);
}

// ── 1. ПРОБКА: ПОИСК «С КРИПАМИ» НЕ НАШЁЛ ПУТЬ → ОТКАТ НА СТРУКТУРНУЮ МАТРИЦУ ──
originalLog("1. Пробка (ignoreCreeps = false, incomplete) → откат на структурную матрицу");
{
  const creep = makeCreep(10, 10, {
    stuck: 3,
    prev: { x: 10, y: 10, roomName: "E35S39" },
  });
  const dest = new RoomPosition(5, 10, "E35S39");
  const { traveler, calls } = makeTraveler([
    { incomplete: true, ops: 1, path: [] }, // creep-матрица: все подходные клетки заняты
    { incomplete: false, ops: 9, path: buildPath(creep.pos, [7, 7, 7, 7, 7]) },
  ]);

  const result = traveler.travelTo(creep, dest);

  assert.strictEqual(calls.length, 2, "должно быть два поиска");
  assert.strictEqual(calls[0].ignoreCreeps, false, "первый поиск — с крипами");
  assert.strictEqual(calls[1].ignoreCreeps, true, "второй поиск — без крипов");
  assert.strictEqual(result, OK, "крип должен шагнуть, а не вернуть ERR_NO_PATH");
  assert.strictEqual(creep.moved, 7, "первый шаг пути — налево");
  assert.strictEqual(creep.memory._travel.path, "77777", "кэш пути — от структурной матрицы");
  assert.strictEqual(creep.memory._travel.noPathTick, undefined, "путь есть — паузы нет");
  assert.strictEqual(logs.length, 1, "ровно один лог");
  assert.ok(logs[0].includes("incomplete path for worker_E35S39_test"), "лог про incomplete");
  assert.ok(logs[0].includes("creepsAsWalls: yes"), "лог объясняет причину");
  assert.ok(logs[0].includes("dest: [room E35S39 pos 5,10]"), "в логе есть цель");
  ok("откат на структурную матрицу и один информативный лог");
}

// ── 2. ДЕДУП ЛОГА И ПАУЗА «НЕТ ПУТИ» ─────────────────────────────────────
originalLog("2. Дедуп лога + пауза noPathRetryTicks, когда пути нет совсем");
{
  logs.length = 0;
  const creep = makeCreep(10, 10, {
    stuck: 3,
    prev: { x: 10, y: 10, roomName: "E35S39" },
  });
  const dest = new RoomPosition(5, 10, "E35S39");
  const empty = () => ({ incomplete: true, ops: 1, path: [] });
  const { traveler, calls } = makeTraveler([empty, empty]);

  assert.strictEqual(traveler.travelTo(creep, dest), ERR_NO_PATH, "пути нет");
  assert.strictEqual(logs.length, 1, "первый лог");
  assert.strictEqual(creep.memory._travel.noPathTick, Game.time, "запомнили тик без пути");

  // Следующий тик: поиск НЕ выполняется (пауза), лога тоже нет.
  Game.time += 1;
  const callsBefore = calls.length;
  assert.strictEqual(traveler.travelTo(creep, dest), ERR_NO_PATH, "пауза: ERR_NO_PATH");
  assert.strictEqual(calls.length, callsBefore, "поиска не было — CPU не тратится");
  assert.strictEqual(logs.length, 1, "второго лога нет (дедуп по цели)");

  // Пауза истекла: поиск снова идёт, но лог всё ещё один (та же цель, cooldown 50).
  Game.time += 5;
  traveler.travelTo(creep, dest);
  assert.ok(calls.length > callsBefore, "после паузы поиск выполняется");
  assert.strictEqual(logs.length, 1, "цель та же — лог не дублируется");

  // Cooldown лога истёк: про ту же цель сообщаем снова.
  Game.time += 50;
  traveler.travelTo(creep, dest);
  assert.strictEqual(logs.length, 2, "через incompleteReportCooldown лог повторяется");
  ok("дедуп лога и пауза повторного поиска");
}

// ── 3. СМЕНА ЦЕЛИ СБРАСЫВАЕТ СОСТОЯНИЕ ──────────────────────────────────
originalLog("3. Смена цели сбрасывает noPathTick и дедуп лога");
{
  logs.length = 0;
  const creep = makeCreep(10, 10, { stuck: 0 });
  const empty = () => ({ incomplete: true, ops: 1, path: [] });
  const good = () => ({ incomplete: false, ops: 4, path: buildPath(creep.pos, [7, 7]) });
  const { traveler, calls } = makeTraveler([empty, empty, good]);

  traveler.travelTo(creep, new RoomPosition(5, 10, "E35S39"));
  assert.strictEqual(logs.length, 1, "первый лог");
  assert.ok(creep.memory._travel.noPathTick !== undefined, "пауза выставлена");

  // Новая цель — поиск идёт сразу, несмотря на паузу от прошлой цели.
  const callsBefore = calls.length;
  const second = traveler.travelTo(creep, new RoomPosition(10, 5, "E35S39"));
  assert.strictEqual(second, OK, "новая цель даёт путь");
  assert.strictEqual(calls.length, callsBefore + 1, "поиск выполнен без ожидания");
  assert.strictEqual(creep.memory._travel.noPathTick, undefined, "пауза сброшена");
  ok("смена цели сбрасывает состояние");
}

// ── 4. ОБЫЧНЫЙ ПУТЬ НЕ ИЗМЕНИЛСЯ ────────────────────────────────────────
originalLog("4. Обычный полный путь: без логов, путь кэшируется");
{
  logs.length = 0;
  const creep = makeCreep(10, 10, {});
  const dest = new RoomPosition(10, 6, "E35S39");
  const { traveler, calls } = makeTraveler([
    { incomplete: false, ops: 3, path: buildPath(creep.pos, [1, 1, 1, 1]) },
  ]);

  assert.strictEqual(traveler.travelTo(creep, dest), OK, "крип шагает");
  assert.strictEqual(creep.moved, 1, "шаг — вверх");
  assert.strictEqual(calls.length, 1, "один поиск");
  // ignoreCreeps не задан вызывающим — findTravelPath сам подставляет true
  // (структурная матрица), поэтому в стабе это undefined.
  assert.strictEqual(calls[0].ignoreCreeps, undefined, "структурная матрица по умолчанию");
  assert.strictEqual(logs.length, 0, "логов нет");
  assert.strictEqual(creep.memory._travel.path, "1111", "путь закэширован целиком");
  assert.strictEqual(creep.memory._travel.stuck, 0, "stuck сброшен");
  ok("поведение обычного пути сохранено");
}

// ── 5. RETRY ЧЕРЕЗ useFindRoute = false ОСТАЛСЯ ─────────────────────────
originalLog("5. Структурная матрица + incomplete → retry без useFindRoute");
{
  logs.length = 0;
  const creep = makeCreep(10, 10, { stuck: 0 });
  const dest = new RoomPosition(10, 5, "E35S39");
  const { traveler, calls } = makeTraveler([
    { incomplete: true, ops: 1500, path: buildPath(creep.pos, [1]) },
    { incomplete: false, ops: 20, path: buildPath(creep.pos, [1, 1]) },
  ]);

  traveler.travelTo(creep, dest);
  assert.strictEqual(calls.length, 2, "два поиска");
  assert.strictEqual(calls[0].ignoreCreeps, undefined, "первый — по структурам (default)");
  assert.strictEqual(calls[1].useFindRoute, false, "retry без findRoute");
  assert.strictEqual(calls[1].ignoreCreeps, undefined, "структурная матрица сохраняется");
  ok("retry без useFindRoute сохранён");
}

// ── 6. ОДНОКЛЕТОЧНЫЙ ПУТЬ: НЕ parseInt("") И НЕ creep.move(NaN) ─────────
originalLog("6. Исчерпанный одноклеточный путь не даёт creep.move(NaN)");
{
  logs.length = 0;
  // Крип уже сделал единственный шаг из кэша (prev = старая клетка, stuck = 0),
  // но путь ещё хранится строкой "7": на этом тике от него останется "".
  const creep = makeCreep(9, 10, {
    stuck: 0,
    prev: { x: 10, y: 10, roomName: "E35S39" },
    path: "7",
    dest: { x: 5, y: 5, roomName: "E35S39" },
  });
  const dest = new RoomPosition(5, 5, "E35S39");
  const { traveler, calls } = makeTraveler([
    { incomplete: false, ops: 4, path: buildPath(creep.pos, [7, 7, 7, 7]) },
  ]);

  const result = traveler.travelTo(creep, dest);
  assert.strictEqual(creep.moved, null, "creep.move(NaN) не вызван");
  assert.strictEqual(result, ERR_NO_PATH, "исчерпанный путь → ERR_NO_PATH");
  assert.strictEqual(
    creep.memory._travel.path,
    undefined,
    "путь сброшен для пересчёта",
  );

  // Следующий тик: путь пересчитывается и крип снова шагает.
  Game.time += 1;
  const result2 = traveler.travelTo(creep, dest);
  assert.strictEqual(calls.length, 1, "выполнен новый поиск пути");
  assert.strictEqual(result2, OK, "новый путь даёт шаг");
  assert.strictEqual(creep.moved, 7, "шаг по новому пути");
  ok("одноклеточный путь не приводит к move(NaN)");
}


console.log = originalLog;
originalLog("\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: " + passed);
