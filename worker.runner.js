const taskManager = require("task.manager");
const taskExecutors = require("task.executors");

const TASK_CHAIN = taskManager.TASK_CHAIN;

function run(creep) {
  if (typeof creep.memory.taskIndex !== "number") {
    creep.memory.taskIndex = 0;
  }

  const roomName = creep.room.name;

  if (!creep.memory.task) {
    const taskType = TASK_CHAIN[creep.memory.taskIndex];
    const task = taskManager.getNextTask(roomName, taskType);

    if (!task) {
      // Очередь текущего taskType пуста (или все Task зарезервированы) —
      // переходим ровно на следующий тип.
      creep.memory.taskIndex = (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
      return;
    }

    const reserved = taskManager.reserveTask(
      roomName,
      taskType,
      task,
      creep.name,
    );

    if (!reserved) {
      // Защитный случай: не удалось зарезервировать (например, Task уже
      // не в очереди). В этом тике ничего не берём.
      return;
    }

    // Task остаётся в FIFO — только ссылка сохраняется в памяти Worker.
    creep.memory.task = task;
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
