/**
 * TASK MANAGER (ТЗ №3, Этап 3)
 * Отвечает на вопросы: создание задач, хранение, выдача, приоритеты.
 * На этом этапе — только инициализация Memory.tasks и одна тестовая задача.
 * Задачи пока НИКЕМ не исполняются — это будет Worker Runner (Этап 4).
 */

const TASK_TYPES = ["build", "repair", "upgrade", "transfer", "factory"];

const FACTORY_SUPPLY_MIN_ENERGY = 1000;

// Единый источник приоритетов задач (раздел 7 ТЗ №5).
// Чем выше число — тем важнее задача.
const TASK_PRIORITY = {
  defense: 100,
  factory: 80,
  repair: 60,
  build: 40,
  upgrade: 20,
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

/**
 * @param {Object} roomState
 */
function run(roomState) {
  ensureMemory();
  createTestTask(roomState.roomName);
  createFactoryTask(roomState);
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
