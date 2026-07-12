const taskManager = require("task.manager");

// Защита от частого переключения задач (раздел 10 ТЗ №5).
const CONFIG = {
  // Новая задача должна быть выше текущей минимум на столько,
  // чтобы переключение вообще рассматривалось.
  PRIORITY_SWITCH_MARGIN: 10,
  // Если текущая задача "висит" в работе дольше этого числа тиков,
  // считаем её просроченной и разрешаем переключение при любом
  // более высоком приоритете.
  TASK_STALE_TICKS: 100,
};
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
function findTaskById(taskId) {
  for (const type of Object.keys(Memory.tasks)) {
    const found = Memory.tasks[type].find(t => t.id === taskId);
    if (found) return found;
  }
  return null;
}

/**
 * Возвращает текущую активную задачу воркера, если она ещё жива.
 * Умеет восстановить связь, если taskId в памяти крипа был потерян,
 * но задача в Memory всё ещё числится назначенной на этого крипа.
 * @param {Creep} creep
 */
function getCurrentTask(creep) {
  if (creep.memory.taskId) {
    const task = findTaskById(creep.memory.taskId);
    if (task && task.status !== "done") return task;
    creep.memory.taskId = null;
  }

  const roomTasks = taskManager.getRoomTasks(creep.room.name);
  const reclaimed = roomTasks.find(t => t.assigned === creep.name);
  if (reclaimed) {
    creep.memory.taskId = reclaimed.id;
    return reclaimed;
  }

  return null;
}

/**
 * Находит лучшую доступную задачу комнаты по приоритету, среди задач
 * pending или брошенных умершим крипом. Worker не знает про типы задач
 * (раздел 8 ТЗ №5) — сравнивает только task.priority.
 * @param {Creep} creep
 * @param {string|null} excludeTaskId — не рассматривать эту задачу (текущую)
 */
function findBestAvailableTask(creep, excludeTaskId) {
  const tasks = taskManager.getRoomTasks(creep.room.name);
  let best = null;

  for (const task of tasks) {
    if (task.id === excludeTaskId) continue;
    const available = task.status === "pending" || !Game.creeps[task.assigned];
    if (!available) continue;

    if (
      !best ||
      task.priority > best.priority ||
      (task.priority === best.priority && task.created < best.created)
    ) {
      best = task;
    }
  }

  return best;
}

function claimTask(creep, task) {
  task.status = "in_progress";
  task.assigned = creep.name;
  task.updated = Game.time;
  creep.memory.taskId = task.id;
}

/**
 * Выбирает задачу для воркера: либо продолжает текущую, либо переключается
 * на более приоритетную (раздел 9), с защитой от частого переключения
 * (раздел 10 ТЗ №5).
 * @param {Creep} creep
 */
function assignTask(creep) {
  const current = getCurrentTask(creep);
  const best = findBestAvailableTask(creep, current ? current.id : null);

  if (!current) {
    if (best) claimTask(creep, best);
    return best;
  }

  if (best) {
    const stale = Game.time - current.updated > CONFIG.TASK_STALE_TICKS;
    const higherEnough =
      best.priority >= current.priority + CONFIG.PRIORITY_SWITCH_MARGIN;

    if (higherEnough || (stale && best.priority > current.priority)) {
      current.status = "pending";
      current.assigned = null;
      console.log(
        `[Task] ${creep.name} switched ${current.type} -> ${best.type}`,
      );
      claimTask(creep, best);
      return best;
    }
  }

  return current;
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

function executeFactorySupply(creep, task) {
  const factory = Game.getObjectById(task.data.factoryId);
  const storage = creep.room.storage;

  if (!factory || !storage) {
    task.status = "done";
    return;
  }

  if (!creep.memory.factoryPhase) {
    creep.memory.factoryPhase = "toFactory";
  }

  if (creep.memory.factoryPhase === "toFactory") {
    if (creep.store[RESOURCE_ENERGY] === 0) {
      if (storage.store[RESOURCE_ENERGY] === 0) {
        creep.memory.factoryPhase = "toStorage";
      } else if (
        creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(storage);
        return;
      } else {
        return;
      }
    }

    if (creep.store[RESOURCE_ENERGY] > 0) {
      if (creep.transfer(factory, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory);
        return;
      }
      creep.memory.factoryPhase = "toStorage";
      return;
    }
  }

  if (creep.memory.factoryPhase === "toStorage") {
    if (
      creep.store[RESOURCE_BATTERY] === 0 &&
      factory.store[RESOURCE_BATTERY] > 0
    ) {
      if (creep.withdraw(factory, RESOURCE_BATTERY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory);
        return;
      }
      return;
    }

    if (creep.store[RESOURCE_BATTERY] > 0) {
      if (creep.transfer(storage, RESOURCE_BATTERY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage);
        return;
      }
    }

    task.status = "done";
    creep.memory.factoryPhase = null;
  }
}

/**
 * @param {Object} roomState
 */
// Реестр исполнителей задач (раздел 12 ТЗ №5): Worker Runner не должен
// содержать список типов и порядок приоритетов — только знать, куда
// передать управление по task.type. Добавление нового типа задачи не
// требует изменения run().
const TASK_EXECUTORS = {
  BUILD: executeBuild,
  FACTORY_SUPPLY: executeFactorySupply,
};

function run(roomState) {
  const workers = roomState.creeps.filter(c => c.memory.role === "worker");

  for (const creep of workers) {
    try {
      const task = assignTask(creep);
      if (!task) continue;

      const executor = TASK_EXECUTORS[task.type];
      if (executor) executor(creep, task);
    } catch (e) {
      // Ошибка одного worker'а не должна ломать остальных.
    }
  }
}

module.exports.run = run;
