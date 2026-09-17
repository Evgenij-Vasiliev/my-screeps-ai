const taskManager = require("task.manager");
const taskExecutors = require("task.executors");

const TASK_CHAIN = taskManager.TASK_CHAIN;

function run(creep) {
  if (typeof creep.memory.taskIndex !== "number") {
    creep.memory.taskIndex = 0;
  }

  // Комната очереди — homeRoom крипа (ТЗ №1, задача 11 роадмапа): задачи роли
  // создаются в домашней комнате, поэтому и брать/завершать их нужно там. Если
  // очередь домашней комнаты ещё не инициализирована, поведение прежнее —
  // физическая комната. Для обычного крипа (homeRoom === текущая комната)
  // ничего не меняется.
  const homeRoom = creep.memory.homeRoom;
  const roomName =
    homeRoom && Memory.rooms && Memory.rooms[homeRoom]
      ? homeRoom
      : creep.room.name;

  if (!creep.memory.task) {
    // Поиск по всей цепочке за один тик (ТЗ №1, задача 2 роадмапа): старт с
    // taskIndex, дальше по приоритетному порядку TASK_CHAIN с заворотом.
    // taskIndex остаётся точкой старта — он не «перескакивает» пустые категории
    // по одному типу за тик, а остаётся ближайшим приоритетным стартом.
    let pickedIndex = -1;
    let pickedTask = null;

    for (let i = 0; i < TASK_CHAIN.length; i++) {
      const index = (creep.memory.taskIndex + i) % TASK_CHAIN.length;
      const taskType = TASK_CHAIN[index];
      const task = taskManager.getNextTask(roomName, taskType);

      if (!task) continue;

      if (!taskManager.reserveTask(roomName, taskType, task, creep.name)) {
        // Защитный случай: не удалось зарезервировать (например, Task уже
        // не в очереди) — пробуем следующую категорию.
        continue;
      }

      pickedIndex = index;
      pickedTask = task;
      break;
    }

    if (!pickedTask) {
      // Вся цепочка пуста (или все Task зарезервированы).
      return;
    }

    creep.memory.taskIndex = pickedIndex;
    // Task остаётся в FIFO — только ссылка сохраняется в памяти Worker.
    creep.memory.task = pickedTask;
  }

  // Категория определяется через taskIndex (позицию в TASK_CHAIN),
  // а не через task.type — это разные понятия.
  const currentTaskType = TASK_CHAIN[creep.memory.taskIndex];
  const executor = taskExecutors.executors[currentTaskType];

  if (!executor) {
    // Executor для этой категории ещё не реализован.
    // Task остаётся полученной, ждём соответствующий Executor.
    return;
  }

  const result = executor(creep, creep.memory.task);

  if (result === "CONTINUE") {
    return;
  }

  if (result === "DONE" || result === "SKIP") {
    const removed =
      result === "DONE"
        ? taskManager.completeTask(roomName, currentTaskType, creep.memory.task)
        : taskManager.removeTask(roomName, currentTaskType, creep.memory.task);

    if (!removed) {
      // Task не найдена в FIFO по taskId (аномалия — например, уже была
      // удалена откуда-то ещё). Не считаем это молча успехом: явно
      // логируем, но всё равно освобождаем Worker от "фантомной" Task,
      // иначе он будет пытаться завершить несуществующую запись вечно.
      console.log(
        "[worker.runner] " +
          creep.name +
          ": не удалось " +
          (result === "DONE" ? "completeTask" : "removeTask") +
          " для taskId=" +
          (creep.memory.task && creep.memory.task.taskId) +
          " (" +
          currentTaskType +
          ") — Task не найдена в FIFO.",
      );
    }
  }

  creep.memory.task = null;
  creep.memory.taskIndex = (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
}

module.exports = {
  run,
};
