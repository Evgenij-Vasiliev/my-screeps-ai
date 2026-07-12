/**
 * WORKER RUNNER (ТЗ №3, Этап 4)
 * Получает задачу из Task Manager, назначает крипу, исполняет, ловит ошибки.
 * Пока поддерживает только тип BUILD, минимально.
 */

/**
 * Берёт первую pending-задачу нужного типа и назначает крипу.
 * @param {Creep} creep
 * @returns {Object|null} задача
 */
function assignTask(creep) {
  if (creep.memory.taskId) {
    const existing = Memory.tasks.build.find(t => t.id === creep.memory.taskId);
    if (existing && existing.status !== "done") return existing;
    creep.memory.taskId = null;
  }

  // Восстановление связи: возможно задача уже назначена этому крипу
  // по имени, но taskId в памяти крипа был потерян (например, вручную).
  const reclaimed = Memory.tasks.build.find(
    t => t.assigned === creep.name && t.status !== "done",
  );
  if (reclaimed) {
    creep.memory.taskId = reclaimed.id;
    return reclaimed;
  }

  // Задача своей комнаты: либо свежая pending, либо брошенная умершим крипом.
  const task = Memory.tasks.build.find(
    t =>
      t.room === creep.room.name &&
      t.status !== "done" &&
      (t.status === "pending" || !Game.creeps[t.assigned]),
  );
  if (!task) return null;

  task.status = "in_progress";
  task.assigned = creep.name;
  creep.memory.taskId = task.id;
  return task;
}

/**
 * Исполнение задачи BUILD: ищет реальный constructionSite в своей комнате.
 * Тестовая задача (target: null) пока просто держит крипа в ожидании.
 * @param {Creep} creep
 * @param {Object} task
 */
function executeBuild(creep, task) {
  const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length === 0) {
    task.status = "done"; // все стройки в комнате завершены
    return;
  }

  // Переключатель режима: working=false — идём заправляться,
  // working=true — идём строить. Без этого крип дёргается туда-сюда
  // при частичном заполнении энергии.
  if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
  } else if (
    creep.memory.working === true &&
    creep.store[RESOURCE_ENERGY] === 0
  ) {
    creep.memory.working = false;
  }

  if (!creep.memory.working) {
    const storage = creep.room.storage;
    if (!storage || storage.store[RESOURCE_ENERGY] === 0) return; // нечем заправиться

    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage);
    }
    return;
  }

  const site = sites[0];
  if (creep.build(site) === ERR_NOT_IN_RANGE) {
    creep.moveTo(site);
  }
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const workers = roomState.creeps.filter(c => c.memory.role === "worker");

  for (const creep of workers) {
    try {
      const task = assignTask(creep);
      if (!task) continue;

      if (task.type === "BUILD") {
        executeBuild(creep, task);
      }
    } catch (e) {
      // Ошибка одного worker'а не должна ломать остальных.
    }
  }
}

module.exports.run = run;
