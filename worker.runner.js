const taskManager = require("task.manager");
const taskExecutors = require("task.executors");
const { TASK_CONFIG } = require("./constants");

const TASK_CHAIN = taskManager.TASK_CHAIN;

/**
 * ШАГ 1 ПЛАНА (экономия CPU): выбор очереди по БЛИЗОСТИ вместо поворота
 * указателя.
 *
 * Было: при пустой текущей очереди воркер переходил ровно к следующему типу
 * (taskIndex + 1) и брал первую свободную задачу в порядке очереди — даже
 * если её цель на другом конце комнаты. Смена типа = брошенный кэш пути
 * (reusePath), поэтому платилось дважды: за пересчёт маршрута и за движение
 * вслепую. Если свободных задач не было нигде, taskIndex крутился каждый тик
 * и писался в Memory впустую.
 *
 * Стало:
 *   1) своя очередь непуста — берём БЛИЖАЙШУЮ задачу ИЗ НЕЁ (часть 2 шага 1:
 *      менеджер просматривает до TASK_CONFIG.NEAREST_SCAN_LIMIT кандидатов,
 *      порог в constants.js);
 *   2) пуста — перебираем типы цепочки и берём БЛИЖАЙШУЮ по расстоянию цель;
 *   3) свободных задач нет нигде — не трогаем ни taskIndex, ни Memory;
 *   4) после завершения задачи тип не меняется вслепую: следующая задача
 *      той же очереди сохраняет кэш пути крипа.
 *
 * Цена перебора ограничена: getNextTask отвечает «нет свободных» за O(1) по
 * счётчику free (task.manager.js:295-302), а один Game.getObjectById стоит
 * 0.000152 CPU (замер: docs/cpu-baseline.json) — против брошенного кэша пути.
 *
 * Откат шага 1: git checkout -- worker.runner.js
 */

/**
 * Полон ли крип. Стор крипа читается ОДИН раз за тик, а не на каждого
 * кандидата: замер на живом shard3 30.09.2026 (scripts/task.manager.bench.js,
 * случай 14c) — `creep.store.getFreeCapacity()` стоит 0.000485 CPU за вызов,
 * а rangeFn вызывается на КАЖДОГО просмотренного кандидата, то есть до
 * TASK_CONFIG.NEAREST_SCAN_LIMIT (constants.js:66) раз на один getNextTask.
 * Стор за время выбора не меняется: исполнитель выполняется ПОСЛЕ выбора
 * (worker.runner.js:185), а интентов до него нет.
 */
function isFull(creep) {
  const store = creep.store;

  // Стор-объект может не иметь метода (фикстуры офлайн-тестов) — тогда
  // считаем крипа гружёным: это обычный случай после добычи.
  return store && typeof store.getFreeCapacity === "function"
    ? store.getFreeCapacity() === 0
    : true;
}

/**
 * Куда крип поедет следующим шагом: гружёный — к цели задачи, пустой — к её
 * источнику. Исполнители выбирают так же: сначала withdraw(source), затем
 * transfer(target).
 */
function nextStopId(full, task) {
  return full ? task.targetId || task.sourceId : task.sourceId || task.targetId;
}

/** Расстояние до следующей точки маршрута; Infinity — цель недоступна. */
function rangeToNextStop(creep, full, task) {
  const id = nextStopId(full, task);
  if (!id) return Infinity;

  const target = Game.getObjectById(id);
  if (!target || !target.pos) return Infinity;
  if (!creep.pos || typeof creep.pos.getRangeTo !== "function") return Infinity;

  return creep.pos.getRangeTo(target);
}

/**
 * Индекс ближайшей очереди, в которой есть свободная задача.
 * Возвращает -1, если свободных задач нет ни в одной очереди комнаты.
 */
function nearestTypeIndex(creep, roomName, fromIndex, full) {
  let best = -1;
  let bestRange = Infinity;

  // rangeFn запоминает ЛУЧШЕГО кандидата и его дальность: getNextTask отдаёт
  // именно его (тот же порядок обхода и то же правило «первый строгий минимум»,
  // что и в task.manager.js: `if (bestIndex === -1 || range < bestRange)`),
  // поэтому второй Game.getObjectById + getRangeTo — раньше он стоял здесь
  // на строке 87 — не нужен. Совпадение выбора держится на том, что менеджер
  // вызывает rangeFn ровно для рассматриваемых задач и в том же порядке.
  let scanTask = null;
  let scanRange = Infinity;
  const rangeFn = task => {
    const range = rangeToNextStop(creep, full, task);

    if (scanTask === null || range < scanRange) {
      scanRange = range;
      scanTask = task;
    }

    return range;
  };

  for (let step = 1; step <= TASK_CHAIN.length; step++) {
    const index = (fromIndex + step) % TASK_CHAIN.length;
    const type = TASK_CHAIN[index];

    // Очередь без исполнителя брать нельзя: воркер завис бы с задачей в руках.
    if (!taskExecutors.executors[type]) continue;

    // Задачу здесь НЕ резервируем: резерв делает reserveTask, когда выбор
    // уже подтверждён. Индекс очереди и счётчик свободных при этом не портятся.
    // rangeFn просит менеджер отдать БЛИЖАЙШУЮ задачу очереди (шаг 1, часть 2).
    const candidate = taskManager.getNextTask(roomName, type, rangeFn);
    if (!candidate) continue;

    // Дальность уже посчитана, если менеджер вернул лучшего из просмотренных;
    // иначе (страховка) досчитываем, а не гадаем.
    const range =
      candidate === scanTask
        ? scanRange
        : rangeToNextStop(creep, full, candidate);

    // best === -1 — страховка: если у всех кандидатов цель не резолвится
    // (Infinity), очередь всё равно должна быть выбрана, иначе воркер будет
    // простаивать. Исполнитель сам снимет непригодную задачу через SKIP.
    if (best === -1 || range < bestRange) {
      best = index;
      bestRange = range;
    }

    if (bestRange <= TASK_CONFIG.NEAREST_STOP_RANGE) break; // ближе некуда
  }

  return best;
}

/**
 * Кэш «в этой комнате свободных задач нет» на текущий тик.
 *
 * Зачем: когда очереди комнаты пусты, КАЖДЫЙ простаивающий воркер каждый тик
 * заново обходит все 11 типов TASK_CHAIN (nearestTypeIndex) — до 12 вызовов
 * getNextTask на воркера за тик, и у всех них один и тот же ответ.
 *
 * Почему кэш корректен: генераторы задач работают в runRoom ДО runCreepLogic
 * (room.manager.js:774-849 против :850), других источников задач в тике нет
 * (`addTask` вызывается только из task.generators.js), а резерв и завершение
 * задач свободных задач только УМЕНЬШАЮТ. Значит отрицательный ответ,
 * полученный один раз, верен до конца тика.
 *
 * Откат: убрать обе функции и два вызова в run().
 */
function roomHasNoFreeTasks(roomName) {
  const c = global.__workerDry;
  return !!(c && c.tick === Game.time && c.rooms[roomName] === true);
}

function markRoomDry(roomName) {
  let c = global.__workerDry;
  if (!c || c.tick !== Game.time) {
    c = global.__workerDry = { tick: Game.time, rooms: {} };
  }
  c.rooms[roomName] = true;
}

function run(creep) {
  if (typeof creep.memory.taskIndex !== "number") {
    creep.memory.taskIndex = 0;
  }

  const roomName = creep.room.name;

  // Состояние «грузен/пуст» читается один раз на тик и передаётся в rangeFn:
  // до исполнителя стор не меняется (см. комментарий к isFull).
  const full = isFull(creep);

  // Миграция со старого формата: раньше в памяти крипа лежала КОПИЯ задачи
  // целиком. Переносим её в taskId, иначе воркер бросил бы свою задачу
  // (она осталась бы навсегда зарезервированной за ним в очереди).
  // Проверено на живом shard3 01.10.2026: крипов с полем `task` в Memory — 0,
  // то есть ветка мертва. Оставлена, потому что её держит регрессионный тест
  // (tests/task.index2.test.js, раздел 8), а цена — одно чтение Memory на
  // воркера за тик (≈0.0025 CPU/тик на 25 крипов). Убирать только вместе с
  // тестом и по отдельному решению.
  if (creep.memory.task) {
    creep.memory.taskId = creep.memory.task.taskId;
    delete creep.memory.task;
  }

  // Категория определяется через taskIndex (позицию в TASK_CHAIN),
  // а не через task.type — это разные понятия.
  let taskIndex = creep.memory.taskIndex;
  let currentTaskType = TASK_CHAIN[taskIndex];

  if (!taskExecutors.executors[currentTaskType]) {
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
    // Запись только при реальном изменении: Memory сериализуется целиком.
    if (creep.memory.taskId) creep.memory.taskId = null;

    // В комнате уже выяснили в этом же тике, что свободных задач нет ни в
    // одной очереди — обход 11 типов (nearestTypeIndex) дал бы тот же ответ.
    // См. комментарий к roomHasNoFreeTasks.
    if (roomHasNoFreeTasks(roomName)) return;

    let candidate = taskManager.getNextTask(roomName, currentTaskType, task =>
      rangeToNextStop(creep, full, task),
    );

    if (!candidate) {
      // Очередь текущего типа пуста (или все Task зарезервированы) — берём
      // ближайшую свободную задачу комнаты вместо поворота указателя.
      const index = nearestTypeIndex(creep, roomName, taskIndex, full);

      if (index === -1) {
        // Свободных задач нет нигде: в этом тике ничего не делаем и НЕ
        // пишем в Memory (раньше здесь крутился taskIndex каждый тик).
        // Запоминаем это на комнату до конца тика — остальные простаивающие
        // воркеры комнаты не будут обходить очереди заново.
        markRoomDry(roomName);
        return;
      }

      taskIndex = index;
      currentTaskType = TASK_CHAIN[index];

      if (creep.memory.taskIndex !== index) {
        creep.memory.taskIndex = index;
      }

      candidate = taskManager.getNextTask(roomName, currentTaskType, task =>
        rangeToNextStop(creep, full, task),
      );

      if (!candidate) {
        // Задачу забрал другой воркер между перебором и резервом —
        // попробуем в следующем тике, выбранный тип остаётся в памяти.
        return;
      }
    }

    if (
      !taskManager.reserveTask(roomName, currentTaskType, candidate, creep.name)
    ) {
      // Защитный случай: не удалось зарезервировать (например, Task уже
      // не в очереди). В этом тике ничего не берём.
      return;
    }

    creep.memory.taskId = candidate.taskId;
    task = candidate;
  }

  const result = taskExecutors.executors[currentTaskType](creep, task);

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

  // Тип задачи НЕ меняется вслепую: следующая задача той же очереди
  // сохраняет кэш пути крипа (reusePath). Смена произойдёт только когда
  // очередь опустеет — тогда её выберет nearestTypeIndex.
  //
  // ШАГ 2 ПЛАНА: писать только при реальном изменении.
  //
  // ЗАМЕР (пробник в Node, 3 сценария; мутация «убрать guard» — все тесты
  // остаются зелёными): в этой точке creep.memory.taskId всегда либо
  // truthy-строка (задача получена через getTaskById или записана на строке
  // 181), либо null, поэтому guard не наблюдаем — он лишь формально
  // соответствует шагу 2 и защищает от записи null поверх null.
  // Регрессионного теста, который ловил бы его удаление, не существует:
  // недостижимое состояние «ключ отсутствует» читается так же, как null
  // (проверка выше, `creep.memory.taskId ? ... : null`).
  // Откат: git checkout -- worker.runner.js
  if (creep.memory.taskId !== undefined) creep.memory.taskId = null;
}

module.exports = {
  run,
};
