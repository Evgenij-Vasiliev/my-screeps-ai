// ── ПОРЯДОК ПРИОРИТЕТА ───────────────────────────────────────────────────
// TASK_CHAIN — это ИМЕННО приоритет, а не «список для ротации»:
// worker.runner всегда берёт самую приоритетную доступную категорию
// (скан с индекса 0) и прерывает удерживаемую задачу, если появилась более
// приоритетная. Порядок ставит выживание комнаты выше её развития и выше
// снабжения «необязательных» подсистем (терминал/маркет, PowerSpawn, фабрика).
// ВАЖНО: спавны/расширения первыми — это единственная энергия, которой
// комната создаёт крипов; пока они не полны, всё остальное ждёт.
//
// ПОЧЕМУ ФАБРИКА ВЫШЕ ТЕРМИНАЛА/РЕМОНТА/КОНТРОЛЛЕРА (правка по живому замеру).
// Удержание задачи НЕ прерывается задачей более низкого приоритета
// (worker.runner.shouldPreempt перебирает только индексы выше heldIndex),
// поэтому индекс категории — это буквально «кто получает воркеров первым».
// Прежний порядок ставил наверх апгрейд контроллера (#3) и ремонт (#2), а
// источник дохода — фабрику — держал на #8/#9. Контроллер при этом НЕ теряется:
// его задача генерируется только при ticksToDowngrade < CONTROLLER.DOWNGRADE_MIN
// (50k) и снимается исполнителем на DOWNGRADE_MAX (150k),
// task.generators.js / task.executors.js — то есть это ПОДДЕРЖАНИЕ уровня, а не
// прокачка: комната платит воркерами ровно тогда, когда запас на даунгрейд
// кончился. Логика «мы не растим RCL, мы его не теряем» сохранена: категория
// просто перестала вытеснять производство, а израсходованный запас всё равно
// будет восстановлен, когда более приоритетных задач не останется.
// Цена решения (принята осознанно): перенос апгрейда в конец очереди означает,
// что при непрерывной загрузке воркеров апгрейд может задержаться; отдельного
// аларма по контроллеру в проекте нет (CONTROLLER читают только генератор и
// исполнитель), поэтому при появлении признаков задержки апгрейда на живом
// шарде первым шагом проверять Memory.rooms[*].tasks.upgradeController.
const TASK_CHAIN = [
  "fillSpawnsExtensions", // 0  жизнеобеспечение: спавн/расширения
  "collectFactoryBattery", //1  доход: вывезти готовый продукт (product держит produce)
  "fillFactoryEnergy", //    2  доход: 600 энергии → 50 battery по 650 (54 кр/энергию)
  "fillTowers", //           3  оборона (пустые башни = потеря комнаты)
  "fillTerminalResources", //4  экспорт/логистика терминала (реагенты бустов)
  "fillPowerSpawnEnergy", // 5  снабжение PowerSpawn (энергия)
  "fillPowerSpawnPower", //  6  снабжение PowerSpawn (power → GPL)
  "repairStructures", //     7  поддержание структур
  "fillTerminalEnergy", //   8  буфер энергии терминала (переживает аварию)
  "buildStructures", //      9  развитие (стройка) — ничего не строим, в конец
  "upgradeController", //    10 поддержание RCL — в конец (рост RCL не цель)
];

// Проверка «категория из цепочки» за O(1) вместо TASK_CHAIN.includes()
// (ТЗ №1, P7): порядок цепочки остаётся единственным источником правды.
const TASK_TYPES = /** @type {Object<string, boolean>} */ ({});
for (let i = 0; i < TASK_CHAIN.length; i++) {
  TASK_TYPES[TASK_CHAIN[i]] = true;
}

function initRoomTasks(roomName) {
  // ТЗ №1 (счётчик): полный проход по TASK_CHAIN — измеряем число прогонов и
  // итераций. Ставится в консоли/heap-вызове, addTask больше его не вызывает.
  if (!Memory.rooms) {
    Memory.rooms = {};
  }
  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].tasks) {
    Memory.rooms[roomName].tasks = {};
  }

  const tasks = Memory.rooms[roomName].tasks;

  for (const taskType of TASK_CHAIN) {
    if (!tasks[taskType]) {
      tasks[taskType] = [];
    }
  }
}

/**
 * Возвращает (создавая при необходимости) очередь конкретной категории.
 * Полная инициализация всех категорий (initRoomTasks) нужна при первом
 * появлении комнаты; на каждом addTask достаточно своей категории — O(1)
 * вместо прохода по всему TASK_CHAIN (ТЗ №1, P7).
 * @param {string} roomName
 * @param {string} taskType
 * @returns {any[]}
 */
function ensureQueue(roomName, taskType) {
  if (!Memory.rooms) {
    Memory.rooms = {};
  }
  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  const roomMemory = Memory.rooms[roomName];
  if (!roomMemory.tasks) {
    roomMemory.tasks = {};
  }
  if (!roomMemory.tasks[taskType]) {
    roomMemory.tasks[taskType] = [];
  }
  return roomMemory.tasks[taskType];
}

// ── ПЕР-ТИКОВЫЙ КЕШ ПРОСМОТРА ОЧЕРЕДЕЙ ──────────────────────────────────
// В комнате обычно больше Worker'ов, чем доступных Task, поэтому каждый
// холостой воркер каждый тик заново обходил все категории TASK_CHAIN и
// повторно просматривал очереди — в том числе целиком, когда все Task уже
// зарезервированы живыми крипами. Внутри тика доступность Task только падает:
// генераторы отрабатывают до крипов, reserveTask занимает запись, а
// complete/remove её удаляют (добавить Task в этом же тике уже некому), поэтому
// результат просмотра стабилен на весь тик и его можно переиспользовать всем
// воркерам комнаты. Кеш живёт в heap (не в Memory — не платим за сериализацию)
// и сбрасывается при смене тика или объекта Memory (global reset, офлайн-тесты).

/**
 * Кеш просмотра очередей на текущий тик.
 * @returns {{ tick: number, memory: any, rooms: Object<string, any> }}
 */
function getScanCache() {
  const cache = global._taskScan;
  if (!cache || cache.tick !== Game.time || cache.memory !== Memory) {
    return (global._taskScan = {
      tick: Game.time,
      memory: Memory,
      rooms: {},
    });
  }
  return cache;
}

/**
 * Пер-тиковый кеш одной комнаты. `hasAny`: -1 — неизвестно, 0 — доступных Task
 * нет, 1 — есть. `categories[taskType]` — первая доступная Task категории (или
 * null), чтобы не сканировать одну и ту же очередь несколько раз за тик.
 * @param {string} roomName
 * @returns {{ categories: Object<string, any>, hasAny: number }}
 */
function getRoomScan(roomName) {
  const cache = getScanCache();
  let room = cache.rooms[roomName];
  if (!room) {
    room = cache.rooms[roomName] = { categories: {}, hasAny: -1 };
  }
  return room;
}

/**
 * Сбрасывает закешированный результат просмотра очередей после изменения
 * очередей. Без этого воркеры этого же тика увидели бы устаревший результат
 * (например, только что зарезервированную Task как свободную).
 *
 * Инвалидация точечная: прежняя версия удаляла запись комнаты целиком, поэтому
 * добавление Task в fillSpawnsExtensions заставляло заново просканировать
 * очереди всех остальных десяти категорий, а reserve/complete делали это по
 * несколько раз за тик (на каждого взявшего и завершившего Task воркера).
 * Теперь сбрасывается только очередь изменившейся категории, и только если её
 * результат просмотра действительно мог измениться:
 *   added    — новая Task встаёт в конец очереди: первая доступная меняется,
 *              лишь если доступных в категории не было (кешированный null);
 *   reserved — первая доступная меняется, только если заняли именно её;
 *   released — освобождённая Task стоит в очереди раньше любой закешированной
 *              (до освобождения её держал живой крип), поэтому результат
 *              просмотра категории устаревает всегда;
 *   removed  — первая доступная меняется, только если удалили именно её.
 *
 * Признак «в комнате есть доступные Task» (hasAny) переводится в -1 (неизвестно)
 * только там, где он может устареть: он либо разрешает холостому воркеру не
 * обходить TASK_CHAIN, либо, будучи нулём, запрещает это делать.
 * @param {string} roomName
 * @param {string} taskType
 * @param {"added"|"reserved"|"released"|"removed"} change
 * @param {Object} [task] изменённая Task (нужна для reserved/removed)
 */
function invalidateScanCache(roomName, taskType, change, task) {
  const cache = global._taskScan;
  if (!cache || cache.tick !== Game.time || cache.memory !== Memory) return;

  const room = cache.rooms[roomName];
  if (!room) return;

  const computed = Object.prototype.hasOwnProperty.call(
    room.categories,
    taskType,
  );
  const cached = computed ? room.categories[taskType] : null;

  if (change === "reserved" || change === "removed") {
    if (computed && cached !== null && cached.taskId === task.taskId) {
      delete room.categories[taskType];
      if (room.hasAny === 1) room.hasAny = -1;
    }
    return;
  }

  if (change === "released") {
    if (computed) delete room.categories[taskType];
    if (room.hasAny === 0) room.hasAny = -1;
    return;
  }

  // added: доступность категории могла появиться только «из ничего».
  if (computed && cached === null) delete room.categories[taskType];
  if (room.hasAny === 0) room.hasAny = -1;
}

/**
 * Есть ли в комнате хоть одна доступная Task (не зарезервированная живым
 * крипом) по всему TASK_CHAIN. Холостой Worker проверяет это одним вызовом и,
 * если Task нет, не обходит цепочку категорий вообще. Отрицательный ответ
 * стабилен на тик и кешируется.
 * @param {string} roomName
 * @returns {boolean}
 */
function hasAvailableTask(roomName) {
  const room = getRoomScan(roomName);
  if (room.hasAny !== -1) {
    return room.hasAny === 1;
  }

  for (let i = 0; i < TASK_CHAIN.length; i++) {
    if (getNextTask(roomName, TASK_CHAIN[i])) {
      room.hasAny = 1;
      return true;
    }
  }

  room.hasAny = 0;
  return false;
}

function generateTaskId() {
  if (typeof global._taskIdSeq !== "number") {
    global._taskIdSeq = 0;
  }

  global._taskIdSeq++;
  return "task_" + global._taskIdSeq;
}

function findIndexByTaskId(queue, taskId) {
  // ТЗ №1 (счётчик): полный проход очереди на каждую reserve/complete/remove.
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].taskId === taskId) {
      return i;
    }
  }

  return -1;
}

function addTask(roomName, taskType, task) {
  if (!TASK_TYPES[taskType]) {    return false;
  }
  if (typeof task !== "object" || task === null) {    return false;
  }

  // Раньше здесь вызывался initRoomTasks (проход по всем 11 категориям на
  // каждую создаваемую задачу) — теперь только очередь своей категории.
  const queue = ensureQueue(roomName, taskType);

  if (typeof task.taskId === "undefined") {
    task.taskId = generateTaskId();
  }

  queue.push(task);
  // Новая Task меняет доступность — кеш просмотра категории недействителен.
  invalidateScanCache(roomName, taskType, "added");
  return true;
}

/**
 * Первая доступная Task категории: не зарезервированная либо зарезервированная
 * крипом, которого уже нет. Результат (включая null) кешируется на тик, поэтому
 * повторные вызовы из цикла Worker'ов очередь не сканируют. Кеш категории
 * сбрасывается при изменении её очереди (см. invalidateScanCache).
 * @param {string} roomName
 * @param {string} taskType
 * @returns {any|null}
 */
function getNextTask(roomName, taskType) {
  const room = getRoomScan(roomName);
  if (Object.prototype.hasOwnProperty.call(room.categories, taskType)) {
    return room.categories[taskType];
  }

  let task = null;
  const queue =
    Memory.rooms &&
    Memory.rooms[roomName] &&
    Memory.rooms[roomName].tasks &&
    Memory.rooms[roomName].tasks[taskType];

  if (queue) {
    for (let i = 0; i < queue.length; i++) {
      const reservedBy = queue[i].reservedBy;
      // Запись, зарезервированная крипом, которого уже нет, доступна снова.
      if (!reservedBy || !Game.creeps[reservedBy]) {
        task = queue[i];
        break;
      }
    }
  }

  room.categories[taskType] = task;
  return task;
}

function reserveTask(roomName, taskType, task, creepName) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return false;
  }

  if (!task || typeof task.taskId === "undefined") {    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {    return false;
  }

  // Резервация проставляется на реальном объекте очереди, а не на
  // переданном параметре — после сериализации Memory между тиками это
  // могут быть разные объекты с одинаковым taskId.
  queue[index].reservedBy = creepName;
  // Task занята — кеш просмотра этой категории больше не отражает реальность.
  invalidateScanCache(roomName, taskType, "reserved", task);
  return true;
}

function releaseTask(roomName, taskType, task) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return false;
  }

  if (!task || typeof task.taskId === "undefined") {    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {    return false;
  }

  delete queue[index].reservedBy;
  invalidateScanCache(roomName, taskType, "released");
  return true;
}

/**
 * Освобождает Task по taskId, не зная категории (ищет по всем очередям
 * TASK_CHAIN). Нужно для безопасной миграции: в старой версии worker.runner
 * хранил категорию как индекс TASK_CHAIN (`memory.taskIndex`), и после
 * переупорядочивания цепочки индекс перестал ей соответствовать. При первом
 * запуске новой версии незавершённая задача освобождается по taskId, а не
 * повисает на живом крипе (иначе потребность стала бы «мёртвой»).
 * @param {string} roomName
 * @param {Object} task
 * @returns {boolean}
 */
function releaseTaskById(roomName, task) {
  if (!task || typeof task.taskId === "undefined") return false;
  if (!Memory.rooms || !Memory.rooms[roomName] || !Memory.rooms[roomName].tasks)
    return false;

  const tasks = Memory.rooms[roomName].tasks;
  for (let i = 0; i < TASK_CHAIN.length; i++) {
    const queue = tasks[TASK_CHAIN[i]];
    if (!queue) continue;
    const index = findIndexByTaskId(queue, task.taskId);
    if (index === -1) continue;
    delete queue[index].reservedBy;
    invalidateScanCache(roomName, TASK_CHAIN[i], "released");
    return true;
  }
  return false;
}

function completeTask(roomName, taskType, task) {
  if (
    !Memory.rooms ||
    !Memory.rooms[roomName] ||
    !Memory.rooms[roomName].tasks ||
    !Memory.rooms[roomName].tasks[taskType]
  ) {    return false;
  }

  if (!task || typeof task.taskId === "undefined") {    return false;
  }

  const queue = Memory.rooms[roomName].tasks[taskType];
  const index = findIndexByTaskId(queue, task.taskId);

  if (index === -1) {    return false;
  }

  delete queue[index].reservedBy;
  queue.splice(index, 1);
  invalidateScanCache(roomName, taskType, "removed", task);
  return true;
}

function removeTask(roomName, taskType, task) {
  return completeTask(roomName, taskType, task);
}

// ── СЧЁТЧИКИ СОБЫТИЙ TASK SYSTEM ─────────────────────────────────────────
// Зачем. Единственный способ проверить, ПОЧЕМУ категория не даёт эффекта, —
// различать три разных исхода: задачу никто не взял (нет воркеров/не
// генерируется), взял и довёл (done), взял и бросил ради более приоритетной
// (preempt). Без этого «фабрика не снабжается» одинаково выглядит и при
// отсутствии задач, и при воровстве воркеров прерыванием.
//
// Стоимость: две записи в объект Memory на СОБЫТИЕ (не на тик). Событий мало:
// done ≈ число выполненных задач, preempt ≈ число прерываний, то есть единицы
// за тик на комнату. Память не растёт: ключей ровно 3 × число категорий.
// Счётчики накопительные; живой скрипт читает их и обнуляет через
// `clearTaskEvents()`, поэтому окно замера задаёт сам наблюдатель.
/**
 * Учитывает событие категории задач (для живых замеров).
 * @param {string} taskType
 * @param {"pickup"|"done"|"skip"|"preempt"} event
 */
function noteTaskEvent(taskType, event) {
  if (!TASK_TYPES[taskType]) return;
  if (!Memory.__taskEvents) Memory.__taskEvents = {};
  const key = event + ":" + taskType;
  Memory.__taskEvents[key] = (Memory.__taskEvents[key] || 0) + 1;
}

/**
 * Снимок и сброс счётчиков событий (только для внешних замеров/консоли).
 * @returns {Object<string, number>}
 */
function clearTaskEvents() {
  const snapshot = Memory.__taskEvents || {};
  Memory.__taskEvents = {};
  return snapshot;
}

module.exports = {
  TASK_CHAIN,
  initRoomTasks,
  addTask,
  getNextTask,
  hasAvailableTask,
  reserveTask,
  releaseTask,
  releaseTaskById,
  completeTask,
  removeTask,
  noteTaskEvent,
  clearTaskEvents,
};
