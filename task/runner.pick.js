// ===================================================
// TASK/runner.pick.js — выбор задачи для воркера
// ===================================================
// Часть разбиения worker.runner.js (525 строк, 04.10.2026). Наружу блок
// по-прежнему отдаёт фасад worker.runner.js: те же ТРИ экспорта (run, diag,
// TASK_CHAIN), что и раньше, — их зовут room/creeps.js:15 и тесты
// (task.index2.test.js:52, worker.proximity.test.js:66).
//
// Индекс комнаты на тик, дальность до точки маршрута, порядок выбора задачи
// (очереди ВЫШЕ своей → своя → ближайшая из остальных), ЦЕПОЧКА дорог внутри
// очереди ремонта (пункт 8: сначала задача вплотную, потом ближайшая) и её
// взятие. NO_WORK, LIVE_TYPE и CHAIN_INDEX — константы этого модуля.
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "task/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const taskManager = require("task.manager");
const taskExecutors = require("task.executors");
const { TASK_CHAIN } = require("./queue");
const { diag } = require("./runner.diag");

const TYPE_COUNT = TASK_CHAIN.length;

/** Сентинел: у очереди нет свободной работы. */
const NO_WORK = -1;

/**
 * Очередь, для которой работает ЦЕПОЧКА (пункт 8 плана): ремонт. Дороги
 * распадаются полосами, поэтому после вычиненной дороги следующая почти всегда
 * лежит вплотную — идти за ней через комнату незачем. Индекс берётся из
 * TASK_CHAIN, а не числом: цепочка категорий может меняться (task/queue.js:18).
 */
const CHAIN_INDEX = TASK_CHAIN.indexOf("repairStructures");

/**
 * Все очереди, у которых ЕСТЬ исполнитель. Проверяется один раз при загрузке:
 * словарь `executors` за время работы не меняется, а очередь без исполнителя
 * брать нельзя — воркер завис бы с задачей в руках.
 */
const LIVE_TYPE = new Array(TYPE_COUNT);
for (let i = 0; i < TYPE_COUNT; i++) {
  LIVE_TYPE[i] = !!taskExecutors.executors[TASK_CHAIN[i]];
}
/* ─────────────────────────── ИНДЕКС КОМНАТЫ ─────────────────────────────── */

/**
 * Что известно о комнате в этом тике.
 *
 *   work[i]  — дальность ЛУЧШЕГО свободного кандидата очереди i, иначе NO_WORK;
 *   has[i]   — у очереди i есть свободная задача, даже если цель не резолвится
 *              (дальность Infinity): такую задачу исполнитель снимет через SKIP,
 *              и воркер не должен простаивать, пока в комнате есть работа;
 *   work[0]  — ЧИСЛО очередей с работой (см. правило 2 в шапке);
 *   built    — дальности уже считались (индекс строится ЛЕНИВО: воркеру со
 *              своей непустой очередью он не нужен вовсе).
 *
 * Ключ — `Game.time`: индекс описывает очереди Memory, а они меняются внутри
 * тика, поэтому переживать тик он не должен.
 */
function roomIndex(roomName) {
  let root = global.__workerIndex;

  if (!root || root.tick !== Game.time) {
    root = global.__workerIndex = { tick: Game.time, rooms: {} };
  }

  let index = root.rooms[roomName];
  if (index) return index;

  index = root.rooms[roomName] = {
    work: new Array(TYPE_COUNT),
    has: new Array(TYPE_COUNT),
    count: 0,
    built: false,
    from: 0,
  };

  for (let i = 0; i < TYPE_COUNT; i++) {
    index.work[i] = NO_WORK;
    index.has[i] = false;
  }

  return index;
}

/* ─────────────────────────── ДАЛЬНОСТЬ ──────────────────────────────────── */

/**
 * Куда воркер поедет СЛЕДУЮЩИМ шагом: гружёный — к цели задачи, пустой — к её
 * источнику. Так же действуют исполнители (сначала `withdraw(source)`, затем
 * `transfer(target)`).
 */
function routePointId(full, task) {
  return full ? task.targetId || task.sourceId : task.sourceId || task.targetId;
}

/**
 * Функция дальности для одного воркера на один тик.
 *
 * Кэширует результат по паре (воркер, точка маршрута) — ключ по имени нужен,
 * потому что менеджер зовёт функцию только для задач ОДНОЙ очереди, а у задач
 * одного типа точка маршрута часто общая (например, один storage как sourceId
 * у десятков задач заливки). Без ключа по воркеру запись одного воркера
 * подменила бы дальность для другого.
 *
 * Резолв идёт через `taskExecutors.resolveTarget` — общий с исполнителями
 * per-tick кэш (task.executors.js), поэтому цель, найденную при выборе, потом
 * не нужно резолвить ещё раз.
 *
 * `lastId`/`lastRange` — результат ПОСЛЕДНЕГО вызова: по ним индекс узнаёт
 * дальность кандидата, которого вернул менеджер, не считая её второй раз.
 */
function makeRanger(creep, full) {
  const key = creep.name + "\u0000";

  const ranger = task => {
    const pointId = routePointId(full, task);

    if (!pointId) {
      ranger.lastId = task.taskId;
      ranger.lastRange = Infinity;
      return Infinity;
    }

    const memoKey = key + pointId;
    let range = ranger.memo[memoKey];

    if (range === undefined) {
      const target = taskExecutors.resolveTarget(pointId);
      const own = creep.pos;

      // Аргумент — сам объект цели: сигнатура RoomPosition.getRangeTo —
      // (target: RoomObject | RoomPosition | {pos: RoomPosition}).
      range =
        target && own && typeof own.getRangeTo === "function"
          ? own.getRangeTo(target)
          : Infinity;

      ranger.memo[memoKey] = range;
    }

    ranger.lastId = task.taskId;
    ranger.lastRange = range;

    return range;
  };

  ranger.memo = {};
  ranger.lastId = null;
  ranger.lastRange = Infinity;

  return ranger;
}

/* ─────────────────────────── ВЫБОР ОЧЕРЕДИ ──────────────────────────────── */

/**
 * Считает дальности всех очередей комнаты. Вызывается, только когда очереди
 * выше своей и своя очередь пусты, — воркеру с готовой задачей индекс не нужен.
 *
 * Обход идёт ПО КРУГУ от очереди воркера: при равной дальности выигрывает та,
 * что встречается раньше по кольцу. Порядок наблюдаем (тесты
 * tests/worker.proximity.test.js) и сохранён как был.
 */
function buildIndex(roomName, index, from, ranger) {
  index.built = true;
  index.from = from;
  index.count = 0;

  for (let i = 0; i < TYPE_COUNT; i++) {
    index.work[i] = NO_WORK;
    index.has[i] = false;
  }

  for (let step = 1; step <= TYPE_COUNT; step++) {
    const i = (from + step) % TYPE_COUNT;

    if (!LIVE_TYPE[i]) continue;

    const type = TASK_CHAIN[i];

    // O(1) по счётчику свободных (task.manager.js, freeTasks): очередь без
    // свободных задач не просматривается вовсе.
    if (taskManager.freeTasks(roomName, type) <= 0) continue;

    const candidate = taskManager.getNextTask(roomName, type, ranger);
    if (!candidate) continue;

    // Работа есть — очередь попадает в индекс даже если цель не резолвится:
    // исполнитель снимет такую задачу через SKIP (см. комментарий к `has`).
    index.count++;
    index.has[i] = true;

    // Менеджер вернул ровно того кандидата, для которого ranger дал минимум,
    // поэтому дальность уже посчитана и второй раз не считается.
    if (ranger.lastId === candidate.taskId) index.work[i] = ranger.lastRange;
  }

  diag().scans++;

  return index;
}

/**
 * Ближайшая очередь комнаты с задачей. Своя очередь кандидатом не считается —
 * её уже проверил обычный путь.
 *
 * Годная цель (дальность — число) всегда вытесняет недостижимую: иначе
 * исчезнувшая цель в соседней очереди навсегда перекрыла бы рабочую задачу.
 * Среди недостижимых порядок не меняется — берётся первая по кольцу.
 */
function bestQueue(index, ownIndex) {
  if (index.count === 0) return -1;

  let best = -1;
  let bestFinite = false;
  let bestRange = Infinity;

  for (let step = 1; step <= TYPE_COUNT; step++) {
    const i = (index.from + step) % TYPE_COUNT;

    if (!index.has[i] || i === ownIndex) continue;

    const range = index.work[i];
    const finite = range !== NO_WORK && range !== Infinity;

    if (best === -1) {
      best = i;
      bestFinite = finite;
      bestRange = range;
    } else if (finite && !bestFinite) {
      best = i;
      bestFinite = true;
      bestRange = range;
    } else if (finite && bestFinite && range < bestRange) {
      best = i;
      bestRange = range;
    }
  }

  return best;
}

/* ─────────────────────────── ВЗЯТИЕ ЗАДАЧИ ──────────────────────────────── */

/**
 * Свободная задача указанной очереди. `retry` — пересобрать индекс один раз,
 * если очередь изменилась с момента его построения; защита от повторного
 * круга — флаг `retried`.
 *
 * Для очереди ремонта включается ЦЕПОЧКА (пункт 8 плана): сначала ищется задача
 * вплотную к воркеру, и только если такой нет — ближайшая. Так воркер после
 * вычиненной дороги берёт соседнюю, а не едет через комнату (см. getNextTask,
 * task/lookup.js:51-96).
 */
function pickFrom(roomName, typeIndex, index, ranger, retried) {
  const type = TASK_CHAIN[typeIndex];

  if (taskManager.freeTasks(roomName, type) <= 0) return null;

  const task = taskManager.getNextTask(
    roomName,
    type,
    ranger,
    typeIndex === CHAIN_INDEX,
  );
  if (task) return task;
  if (retried) return null;

  buildIndex(roomName, index, typeIndex, ranger);
  return pickFrom(roomName, typeIndex, index, ranger, true);
}

/* ─────────────────────── ОЧЕРЕДИ ВЫШЕ СВОЕЙ ─────────────────────────────── */

/**
 * Свободная задача в очередях ВЫШЕ своей по цепочке (индексы 0..ownIndex-1).
 *
 * Правка 05.10.2026, пункт 2 плана (docs/REPAIR-PLAN.md:159): очередь — это и
 * есть приоритет. Для воркера с `repairStructures` (индекс 7, task/queue.js:26)
 * очереди выше — это доставка 0..6 (`fillSpawnsExtensions` …
 * `collectFactoryBattery`), и она берётся РАНЬШЕ своей очереди ремонта.
 *
 * Почему: до правки своя очередь была первой, и воркер, у которого в очереди
 * ремонта есть хоть одна свободная задача, до доставки не доходил вовсе.
 * Замер shard3 05.10.2026 (read-only: Memory.rooms + Memory.creeps, опрос раз
 * в 10 с, 29 снимков подряд): воркер держал repair-задачу, а в его комнате
 * свободно лежали 4-5 задач доставки с живыми целями; очередь ремонта в E35S39
 * при этом — 346 100 недостающих хитов = 3 461 тик работы одного WORK.
 *
 * Порядок обхода — по цепочке (0, 1, 2, …), как в прежнем боте
 * (SUPPLY → REPAIR → BUILD → UPGRADE). Внутри взятой очереди по-прежнему
 * выбирается БЛИЖАЙШАЯ задача — дальность считает ранжер (makeRanger).
 *
 * `retried = true`: индекс комнаты здесь не пересобирается — он нужен только
 * кольцевому обходу (buildIndex). Счётчик свободных задач очереди в пределах
 * тика точен (task/lifecycle.js: reserveTask `:123`, completeTask `:153`,
 * releaseTask `:137`, addTask `:96` правят entry.free), поэтому «free > 0, а
 * задачи нет» — аномалия, и пересборка индекса её не лечит.
 *
 * Откат правки: убрать вызов pickHigher из findTask — своя очередь снова первая
 * (docs/REPAIR-PLAN.md:159 «вернуть прежний порядок выбора»).
 *
 * @returns {{task: Object, typeIndex: number}|null}
 */
function pickHigher(roomName, ownIndex, index, ranger) {
  for (let i = 0; i < ownIndex; i++) {
    // Очередь без исполнителя брать нельзя: воркер завис бы с задачей в руках.
    if (!LIVE_TYPE[i]) continue;

    const task = pickFrom(roomName, i, index, ranger, true);
    if (task) return { task, typeIndex: i };
  }

  return null;
}

/**
 * Найти задачу: сначала очереди ВЫШЕ своей (для ремонта это доставка), потом
 * своя, иначе — ближайшая очередь комнаты.
 * Резерв делает вызывающий: до подтверждённого резерва задача не «наша».
 */
function findTask(creep, roomName, index, ownIndex, ranger) {
  const higher = pickHigher(roomName, ownIndex, index, ranger);
  if (higher) return higher;

  const own = pickFrom(roomName, ownIndex, index, ranger, false);
  if (own) return { task: own, typeIndex: ownIndex };

  if (!index.built) buildIndex(roomName, index, ownIndex, ranger);

  const typeIndex = bestQueue(index, ownIndex);
  if (typeIndex === -1) return null; // работы нет ни в одной очереди комнаты

  const task = pickFrom(roomName, typeIndex, index, ranger, false);
  if (!task) return null; // задачу забрал другой воркер между выбором и резервом

  return { task, typeIndex };
}


module.exports = {
  roomIndex,
  makeRanger,
  findTask,
};
