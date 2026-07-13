/**
 * TASK MANAGER (ТЗ №3 → ТЗ №5, Task System v2.0)
 * Создание, хранение, приоритезация и жизненный цикл задач Империи.
 */

const TASK_TYPES = [
  "build",
  "repair",
  "upgrade",
  "transfer",
  "factory",
  "terminal",
];

const FACTORY_SUPPLY_MIN_ENERGY = 1000;

const TERMINAL_SUPPLY = {
  ENERGY_MIN: 100000,
  ENERGY_MAX: 150000,
  MINERAL_MAX: 10000,
  COMPOUND_MAX: 2000,
};

// Единый источник приоритетов задач (раздел 7 ТЗ №5).
// Чем выше число — тем важнее задача.
const TASK_PRIORITY = {
  defense: 100,
  factory: 50,
  repair: 60,
  build: 40,
  upgrade: 20,
  terminal: 70,
};

/**
 * Гарантирует, что Memory.tasks существует и имеет правильную форму.
 */
function ensureMemory() {
  if (!Memory.tasks) Memory.tasks = {};
  for (const type of TASK_TYPES) {
    if (!Memory.tasks[type]) Memory.tasks[type] = [];
  }
}

/**
 * Создаёт одну тестовую задачу BUILD для конкретной комнаты, если у неё
 * ещё нет своей задачи. Временная функция для проверки Task System.
 * @param {string} roomName
 */
function createTestTask(roomName) {
  const room = Game.rooms[roomName];
  if (!room) return;

  // Нет смысла создавать задачу BUILD, если в комнате нет строек —
  // иначе задача тут же закроется как done и на следующий тик создастся заново.
  const hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
  if (!hasSites) return;

  const hasActive = Memory.tasks.build.some(
    t => t.room === roomName && t.status !== "done",
  );
  if (hasActive) return;

  Memory.tasks.build.push({
    id: `task_${roomName}_${Game.time}`,
    type: "BUILD",
    room: roomName,
    priority: TASK_PRIORITY.build,
    status: "pending",
    assigned: null,
    created: Game.time,
    updated: Game.time,
    data: { target: null },
  });
}

/**
 * Создаёт задачу FACTORY_SUPPLY, если фабрика нуждается в снабжении
 * энергией или содержит готовые BATTERY на вывоз. Не создаёт вторую
 * задачу, если активная уже есть (ограничение: максимум 1 воркер
 * на Factory одновременно, раздел 9 ТЗ v1.1).
 * @param {Object} roomState
 */
function createFactoryTask(roomState) {
  const { roomName, factory, storage } = roomState;
  if (!factory || !storage) return;

  const hasActive = Memory.tasks.factory.some(
    t => t.room === roomName && t.status !== "done",
  );
  if (hasActive) return;

  const needsEnergy =
    factory.store[RESOURCE_ENERGY] < FACTORY_SUPPLY_MIN_ENERGY &&
    storage.store[RESOURCE_ENERGY] > 0;

  const hasBattery = factory.store[RESOURCE_BATTERY] > 0;

  if (!needsEnergy && !hasBattery) return;

  Memory.tasks.factory.push({
    id: `task_factory_${roomName}_${Game.time}`,
    type: "FACTORY_SUPPLY",
    room: roomName,
    priority: TASK_PRIORITY.factory,
    status: "pending",
    assigned: null,
    created: Game.time,
    updated: Game.time,
    data: { factoryId: factory.id },
  });
}

const TERMINAL_BASE_MINERALS = [
  RESOURCE_HYDROGEN,
  RESOURCE_OXYGEN,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_CATALYST,
];

/**
 * Определяет, нужно ли довезти ресурс из Storage в Terminal, и сколько.
 * Правила:
 *   ENERGY — держим в диапазоне [ENERGY_MIN, ENERGY_MAX] (проверяется по MIN);
 *   BATTERY и базовые минералы — только потолок MINERAL_MAX;
 *   соединения — только потолок COMPOUND_MAX.
 * @param {string} resourceType
 * @param {number} terminalAmount
 * @returns {number} сколько довезти (0, если довозить не нужно)
 */
function getTerminalSupplyAmount(resourceType, terminalAmount) {
  if (resourceType === RESOURCE_ENERGY) {
    if (terminalAmount < TERMINAL_SUPPLY.ENERGY_MAX) {
      return TERMINAL_SUPPLY.ENERGY_MAX - terminalAmount;
    }
    return 0;
  }

  const cap =
    resourceType === RESOURCE_BATTERY ||
    TERMINAL_BASE_MINERALS.includes(resourceType)
      ? TERMINAL_SUPPLY.MINERAL_MAX
      : TERMINAL_SUPPLY.COMPOUND_MAX;

  if (terminalAmount < cap) {
    return cap - terminalAmount;
  }
  return 0;
}

/**
 * Создаёт задачу TERMINAL_SUPPLY, если есть ресурс, который нужно
 * довезти из Storage в Terminal (см. getTerminalSupplyAmount), и в
 * Storage реально есть, что везти. Не создаёт вторую активную задачу.
 * @param {Object} roomState
 */
const STORAGE_RESERVE = { [RESOURCE_ENERGY]: 50000 };

function createTerminalTask(roomState) {
  const { roomName, storage, terminal } = roomState;
  if (!storage || !terminal) return;

  const hasActive = Memory.tasks.terminal.some(
    t => t.room === roomName && t.status !== "done",
  );
  if (hasActive) return;

  for (const resourceType in storage.store) {
    const terminalAmount = terminal.store[resourceType] || 0;
    const needed = getTerminalSupplyAmount(resourceType, terminalAmount);
    if (needed <= 0) continue;

    const reserve = STORAGE_RESERVE[resourceType] || 0;
    const available = storage.store[resourceType] - reserve;
    if (available <= 0) continue;

    Memory.tasks.terminal.push({
      id: `task_terminal_${roomName}_${Game.time}`,
      type: "TERMINAL_SUPPLY",
      room: roomName,
      priority: TASK_PRIORITY.terminal,
      status: "pending",
      assigned: null,
      created: Game.time,
      updated: Game.time,
      data: { resourceType, amount: Math.min(needed, available) },
    });
    return; // одна задача за раз — на первый подходящий ресурс
  }
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  ensureMemory();
  cleanupDoneTasks();
  createTestTask(roomState.roomName);
  createFactoryTask(roomState);
  createTerminalTask(roomState);
}

function cleanupDoneTasks() {
  if (Game.time % 100 !== 0) return;
  for (const type of TASK_TYPES) {
    const before = Memory.tasks[type].length;
    Memory.tasks[type] = Memory.tasks[type].filter(t => t.status !== "done");
    const removed = before - Memory.tasks[type].length;
    if (removed > 0) {
      console.log(
        `[TaskManager] cleanup ${type}: removed ${removed} done tasks`,
      );
    }
  }
}

/**
 * Возвращает все задачи комнаты (любого типа, любого статуса кроме done),
 * без привязки к конкретным типам — единая точка доступа для Worker Runner
 * (раздел 8 ТЗ №5: Worker не должен знать про типы задач и их порядок).
 * @param {string} roomName
 * @returns {Array} задачи комнаты
 */
function getRoomTasks(roomName) {
  const result = [];
  for (const type of TASK_TYPES) {
    for (const task of Memory.tasks[type]) {
      if (task.room === roomName && task.status !== "done") {
        result.push(task);
      }
    }
  }
  return result;
}

module.exports.run = run;
module.exports.getRoomTasks = getRoomTasks;
module.exports.TERMINAL_SUPPLY = TERMINAL_SUPPLY;
