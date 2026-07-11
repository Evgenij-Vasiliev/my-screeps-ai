/**
 * TASK MANAGER (ТЗ №3, Этап 3)
 * Отвечает на вопросы: создание задач, хранение, выдача, приоритеты.
 * На этом этапе — только инициализация Memory.tasks и одна тестовая задача.
 * Задачи пока НИКЕМ не исполняются — это будет Worker Runner (Этап 4).
 */

const TASK_TYPES = ["build", "repair", "upgrade", "transfer"];

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
  const hasOwn = Memory.tasks.build.some(t => t.room === roomName);
  if (hasOwn) return;

  Memory.tasks.build.push({
    id: `task_${roomName}_${Game.time}`,
    type: "BUILD",
    room: roomName,
    target: null,
    priority: 1,
    status: "pending",
    assigned: null,
  });
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  ensureMemory();
  createTestTask(roomState.roomName);
}
module.exports.run = run;
