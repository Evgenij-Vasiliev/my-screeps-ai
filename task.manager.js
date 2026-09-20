// ── ПОРЯДОК ПРИОРИТЕТА ───────────────────────────────────────────────────
// TASK_CHAIN — это ИМЕННО приоритет, а не «список для ротации»:
// worker.runner всегда берёт самую приоритетную доступную категорию
// (скан с индекса 0) и прерывает удерживаемую задачу, если появилась более
// приоритетная. Порядок ставит выживание комнаты выше её развития и выше
// снабжения «необязательных» подсистем (терминал/маркет, PowerSpawn, фабрика).
// ВАЖНО: спавны/расширения первыми — это единственная энергия, которой
// комната создаёт крипов; пока они не полны, всё остальное ждёт.
const TASK_CHAIN = [
  "fillSpawnsExtensions", // 0  жизнеобеспечение: спавн/расширения
  "fillTowers", //           1  оборона (пустые башни = потеря комнаты)
  "repairStructures", //     2  поддержание структур
  "upgradeController", //    3  защита от даунгрейда
  "fillTerminalEnergy", //   4  буфер энергии терминала (переживает аварию)
  "fillPowerSpawnEnergy", // 5  снабжение PowerSpawn
  "fillTerminalResources", //6  экспорт/логистика терминала
  "fillPowerSpawnPower", //  7  снабжение PowerSpawn (power)
  "fillFactoryEnergy", //    8  завод
  "collectFactoryBattery", //9  завод (продукт)
  "buildStructures", //      10 развитие (стройка) — последнее
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
};
