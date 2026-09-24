const taskManager = require("task.manager");
const taskExecutors = require("task.executors");

const TASK_CHAIN = taskManager.TASK_CHAIN;

/**
 * Ресурс, который Task кладёт в рюкзак Worker'а.
 * У задач repair/build/upgrade поля resourceType нет — они всегда про энергию.
 * @param {Object} task
 * @returns {string}
 */
function taskResourceType(task) {
  if (task && task.resourceType) return task.resourceType;
  return RESOURCE_ENERGY;
}

/**
 * Совместим ли текущий груз Worker'а с ресурсом следующей Task: рюкзак либо
 * пуст, либо в нём лежит ТОЛЬКО этот ресурс.
 *
 * Именно эта проверка (а не безусловная выгрузка) не даёт рюкзаку стать
 * «двухресурсным» и при этом не заставляет Worker делать лишний рейс в Storage:
 * остаток энергии спокойно доезжает до следующей энергетической задачи
 * (spawns/extensions, терминал, башни, ремонт, стройка, прокачка).
 * @param {Creep} creep
 * @param {string} resourceType
 * @returns {boolean}
 */
function cargoMatchesTask(creep, resourceType) {
  const used = creep.store.getUsedCapacity();
  if (used === 0) return true;
  return creep.store[resourceType] === used;
}

/**
 * Возвращает остаток груза из рюкзака Worker'а обратно в Storage — по одному
 * resourceType за тик (Creep.transfer требует конкретный ресурс).
 *
 * Вызывается только когда найденная Task требует ДРУГОЙ ресурс (см. run):
 * исполнители (task.executors.js) рассчитаны на то, что Worker не смешивает
 * ресурсы в рюкзаке, иначе creep.withdraw(новый ресурс) ляжет поверх остатка и
 * общий флаг memory.working начнёт путать фазы разных Task.
 *
 * @param {Creep} creep
 * @returns {boolean} true — груз ещё есть (сброс начат/продолжается),
 *                    false — рюкзак пуст либо сбрасывать некуда.
 */
function returnCargoToStorage(creep) {
  if (creep.store.getUsedCapacity() === 0) return false;

  const storage = creep.room.storage;
  if (!storage) return false;

  // В Store перечисляются только фактически лежащие ресурсы (как и в игре).
  const resourceType = /** @type {ResourceConstant} */ (
    Object.keys(creep.store)[0]
  );
  if (creep.transfer(storage, resourceType) === ERR_NOT_IN_RANGE) {
    creep.travelTo(storage);
  }

  return true;
}

/**
 * Ищет самую приоритетную доступную Task: скан TASK_CHAIN с индекса 0.
 * Именно строгий скан с начала (а не с «текущего индекса» крипа) гарантирует,
 * что refill спавнов/расширений не будет отложен задачами терминала, ремонта
 * или стройки. Дедуп/резервация как раньше: одна Task — один воркер.
 * @param {Creep} creep
 * @param {string} roomName
 * @returns {boolean} взята ли Task
 */
function selectTask(creep, roomName) {
  // Найденная по приоритету Task требует ДРУГОЙ ресурс, чем уже лежит в
  // рюкзаке. Груз сразу не выгружаем: сначала ищем совместимую Task ниже по
  // цепочке — иначе получается лишний рейс в Storage.
  let flushCargo = false;

  for (let index = 0; index < TASK_CHAIN.length; index++) {
    const taskType = TASK_CHAIN[index];
    const task = taskManager.getNextTask(roomName, taskType);

    if (!task) continue;

    // Смешивать ресурсы нельзя: creep.withdraw() положит новый ресурс поверх
    // остатка, и флаг memory.working начнёт путать фазы разных Task.
    if (!cargoMatchesTask(creep, taskResourceType(task))) {
      flushCargo = true;
      continue;
    }

    if (!taskManager.reserveTask(roomName, taskType, task, creep.name)) {
      // Защитный случай: не удалось зарезервировать (Task уже не в очереди) —
      // пробуем следующую категорию.
      continue;
    }

    creep.memory.task = task;
    creep.memory.taskType = taskType;
    taskManager.noteTaskEvent(taskType, "pickup");
    return true;
  }

  if (flushCargo) {
    // Совместимой Task не нашлось — выгружаем остаток, чтобы освободить
    // рюкзак под задачу другого ресурса (returnCargoToStorage работает по
    // одному ресурсу за тик). Сама Task остаётся в FIFO незарезервированной.
    returnCargoToStorage(creep);
  }

  return false;
}

/**
 * Нужно ли прервать удерживаемую Task ради более приоритетной. Без этого
 * «долгая» задача (executor ремонта держит воркера до полного восстановления
 * структуры) могла бы занять всех воркеров и оставить спавны/расширения без
 * подвоза — именно так комната может «погаснуть». Прерываем только при
 * СОВМЕСТИМОМ грузе: если воркер везёт другой ресурс, он сначала довозит его.
 * @param {Creep} creep
 * @param {string} roomName
 * @returns {boolean}
 */
function shouldPreempt(creep, roomName) {
  const heldIndex = TASK_CHAIN.indexOf(creep.memory.taskType);
  if (heldIndex <= 0) return false; // категории приоритетнее нет

  for (let index = 0; index < heldIndex; index++) {
    const task = taskManager.getNextTask(roomName, TASK_CHAIN[index]);
    if (!task) continue;
    if (cargoMatchesTask(creep, taskResourceType(task))) return true;
  }
  return false;
}

function run(creep) {
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

  // Миграция со старой версии: категория хранилась как индекс TASK_CHAIN
  // (memory.taskIndex), и после переупорядочивания цепочки он перестал ей
  // соответствовать. Освобождаем задачу по taskId, чтобы она не «зависла»
  // за живым крипом, и берём заново по новому приоритету.
  if (creep.memory.task && !creep.memory.taskType) {
    taskManager.releaseTaskById(roomName, creep.memory.task);
    creep.memory.task = null;
    delete creep.memory.working;
    delete creep.memory.taskIndex;
  }

  // Прерывание удерживаемой Task ради более приоритетной (см. shouldPreempt).
  if (
    creep.memory.task &&
    creep.memory.taskType &&
    shouldPreempt(creep, roomName)
  ) {
    taskManager.noteTaskEvent(creep.memory.taskType, "preempt");
    taskManager.releaseTask(
      roomName,
      creep.memory.taskType,
      creep.memory.task,
    );
    creep.memory.task = null;
    delete creep.memory.taskType;
    delete creep.memory.working;
  }

  if (!creep.memory.task) {
    // Холостой Worker: если в комнате нет НИ ОДНОЙ доступной Task, выходим сразу
    // — не обходим TASK_CHAIN и не просматриваем очереди. Ответ кешируется на тик
    // (task.manager), поэтому цена — один вызов на воркер, а не 11 getNextTask.
    if (!taskManager.hasAvailableTask(roomName)) {
      return;
    }

    // Строгий приоритет: старт ВСЕГДА с индекса 0 (fillSpawnsExtensions).
    if (!selectTask(creep, roomName)) {
      return;
    }
  }

  // Категория хранится строкой (memory.taskType), а не индексом TASK_CHAIN:
  // порядок цепочки — конфиг приоритета, и его изменение не должно ломать
  // незавершённые задачи живых крипов.
  const currentTaskType = creep.memory.taskType;
  const executor = taskExecutors.executors[currentTaskType];

  if (!executor) {
    // Executor для этой категории ещё не реализован: освобождаем Task, чтобы
    // она не считалась занятой «немым» воркером (иначе потребность мёртвая).
    taskManager.releaseTask(roomName, currentTaskType, creep.memory.task);
    creep.memory.task = null;
    delete creep.memory.taskType;
    delete creep.memory.working;
    return;
  }

  const result = executor(creep, creep.memory.task);

  if (result === "CONTINUE") {
    return;
  }

  if (result === "DONE" || result === "SKIP") {
    taskManager.noteTaskEvent(
      currentTaskType,
      result === "DONE" ? "done" : "skip",
    );
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
  delete creep.memory.taskType;
  // Флаг фазы (сбор/доставка) относится к конкретной Task. При переходе к
  // следующей категории он не должен «перетекать»: у другой Task другой
  // resourceType, и унаследованный working исказил бы выбор фазы.
  delete creep.memory.working;
}

module.exports = {
  run,
};
