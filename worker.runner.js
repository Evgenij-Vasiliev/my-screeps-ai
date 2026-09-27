const taskManager = require("task.manager");
const taskExecutors = require("task.executors");

const TASK_CHAIN = taskManager.TASK_CHAIN;

function run(creep) {
  if (typeof creep.memory.taskIndex !== "number") {
    creep.memory.taskIndex = 0;
  }

  const roomName = creep.room.name;

  // Миграция со старого формата: раньше в памяти крипа лежала КОПИЯ задачи
  // целиком. Переносим её в taskId, иначе воркер бросил бы свою задачу
  // (она осталась бы навсегда зарезервированной за ним в очереди).
  if (creep.memory.task) {
    creep.memory.taskId = creep.memory.task.taskId;
    delete creep.memory.task;
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

  // В памяти крипа — только идентификатор. Сама задача резолвится из
  // очереди через heap-индекс (Memory больше не хранит её копию).
  let task = creep.memory.taskId
    ? taskManager.getTaskById(roomName, currentTaskType, creep.memory.taskId)
    : null;

  if (!task) {
    // Задачи нет или она исчезла из очереди — берём следующую.
    creep.memory.taskId = null;

    const candidate = taskManager.getNextTask(roomName, currentTaskType);

    if (!candidate) {
      // Очередь текущего taskType пуста (или все Task зарезервированы) —
      // переходим ровно на следующий тип.
      creep.memory.taskIndex = (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
      return;
    }

    if (!taskManager.reserveTask(roomName, currentTaskType, candidate, creep.name)) {
      // Защитный случай: не удалось зарезервировать (например, Task уже
      // не в очереди). В этом тике ничего не берём.
      return;
    }

    creep.memory.taskId = candidate.taskId;
    task = candidate;
  }

  const result = executor(creep, task);

  if (result === "CONTINUE") {
    return;
  }

  if (result === "DONE" || result === "SKIP") {
    const removed =
      result === "DONE"
        ? taskManager.completeTask(roomName, currentTaskType, task)
        : taskManager.removeTask(roomName, currentTaskType, task);

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
          task.taskId +
          " (" +
          currentTaskType +
          ") — Task не найдена в FIFO.",
      );
    }
  }

  creep.memory.taskId = null;
  creep.memory.taskIndex = (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
}

module.exports = {
  run,
};
