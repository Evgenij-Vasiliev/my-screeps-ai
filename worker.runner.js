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
    // Холостой Worker: если в комнате нет НИ ОДНОЙ доступной Task, выходим сразу
    // — не обходим TASK_CHAIN и не просматриваем очереди. Ответ кешируется на тик
    // (task.manager), поэтому цена — один вызов на воркер, а не 11 getNextTask.
    // Без этого каждый холостой воркер каждый тик заново сканировал все
    // категории (в т.ч. очереди целиком, когда все Task зарезервированы).
    if (!taskManager.hasAvailableTask(roomName)) {
      return;
    }

    // Поиск по всей цепочке за один тик (ТЗ №1, задача 2 роадмапа): старт с
    // taskIndex, дальше по приоритетному порядку TASK_CHAIN с заворотом.
    // taskIndex остаётся точкой старта — он не «перескакивает» пустые категории
    // по одному типу за тик, а остаётся ближайшим приоритетным стартом.
    let pickedIndex = -1;
    let pickedTask = null;
    // Найденная (ближайшая по приоритету) Task требует ДРУГОЙ ресурс, чем уже
    // лежит в рюкзаке. Груз сразу не выгружаем: сначала ищем совместимую Task
    // ниже по цепочке (см. цикл) — иначе получается лишний рейс в Storage,
    // после которого энергию тут же приходится снова забирать.
    let flushCargo = false;

    for (let i = 0; i < TASK_CHAIN.length; i++) {
      const index = (creep.memory.taskIndex + i) % TASK_CHAIN.length;
      const taskType = TASK_CHAIN[index];
      const task = taskManager.getNextTask(roomName, taskType);

      if (!task) continue;

      // Задача «чужого» ресурса, пока в рюкзаке остаток: не сбрасываем груз
      // сразу — сначала доискиваем совместимую Task ниже по цепочке, чтобы не
      // делать лишний рейс в Storage. Смешивать ресурсы всё равно нельзя:
      // creep.withdraw() исполнителя положит новый ресурс поверх старого.
      if (!cargoMatchesTask(creep, taskResourceType(task))) {
        flushCargo = true;
        continue;
      }

      if (!taskManager.reserveTask(roomName, taskType, task, creep.name)) {
        // Защитный случай: не удалось зарезервировать (например, Task уже
        // не в очереди) — пробуем следующую категорию.
        continue;
      }

      pickedIndex = index;
      pickedTask = task;
      break;
    }

    if (flushCargo && !pickedTask) {
      // Совместимой Task не нашлось — только тогда выгружаем остаток, чтобы
      // освободить рюкзак под задачу другого ресурса (returnCargoToStorage
      // работает по одному ресурсу за тик). Сама Task остаётся в FIFO
      // незарезервированной и будет взята, когда рюкзак опустеет.
      returnCargoToStorage(creep);
      return;
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
  // Флаг фазы (сбор/доставка) относится к конкретной Task. При переходе к
  // следующей категории он не должен «перетекать»: у другой Task другой
  // resourceType, и унаследованный working исказил бы выбор фазы.
  delete creep.memory.working;
  creep.memory.taskIndex = (creep.memory.taskIndex + 1) % TASK_CHAIN.length;
}

module.exports = {
  run,
};
