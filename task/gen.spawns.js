// ===================================================
// TASK/gen.spawns.js — генератор наполнения spawn и extension
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Самый дорогой цикл генерации — 62 объекта на комнату за тик. needsEnergy живёт
// здесь же: все её вызовы лежат в этом генераторе (строки 73, 115 и 128
// исходного task.generators.js).
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const { TASK_CONFIG } = require("../constants");

const TASK_TYPE = "fillSpawnsExtensions";

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLSPAWNS = ["type", "targetId", "sourceId", "resourceType"];

function isDuplicateTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillSpawnsExtensions", candidate, FIELDS_FILLSPAWNS);
}

function needsEnergy(target) {
  if (!target) {
    return false;
  }

  // Есть ли свободное место под энергию — БЕЗ вызова store.getFreeCapacity().
  //
  // `.energy` и `.energyCapacity` — документированные алиасы store[RESOURCE_ENERGY]
  // и store.getCapacity(RESOURCE_ENERGY): @types/screeps:4685-4696 (spawn),
  // :5104-5116 (extension), :5343-5355 (tower). Поэтому `energy < energyCapacity`
  // тождественно прежнему `getFreeCapacity(RESOURCE_ENERGY) > 0`.
  //
  // Зачем: обход spawn/extension — самый дорогой цикл генерации (62 объекта на
  // комнату за тик). Замер на живом shard3 30.09.2026
  // (scripts/task.manager.bench.js, N=300, реплика ровно этого цикла):
  // 0.0240 и 0.0209 CPU на комнату с вызовом getFreeCapacity против 0.0034 и
  // 0.0061 CPU с алиасами — 4-7 раз дешевле. Живая сверка эквивалентности:
  // 282 объекта spawn+extension в 5 комнатах, расхождений между
  // `energy < energyCapacity` и `getFreeCapacity(ENERGY) > 0` — 0
  // (Game.time ≈ 83331255).
  //
  // Проверка типа — для офлайн-фикстур: у заглушки без этих полей ответ
  // «места нет», как и раньше у заглушки без store.
  const capacity = target.energyCapacity;

  if (typeof capacity !== "number") {
    return false;
  }

  return target.energy < capacity;
}

function generateFillSpawnsExtensions(roomState) {
  if (!TASK_CONFIG.fillSpawnsExtensions) return;
  const { storage, spawns, extensions, room } = roomState;

  if (!storage) {
    return;
  }

  // ── Дешёвый отсев: есть ли в комнате куда заливать вообще ────────────
  // energyAvailable/energyCapacityAvailable — суммы по ВСЕМ spawn и extension
  // комнаты, их считает движок (@types/screeps:4321-4328: «Total amount of
  // energy available in all spawns and extensions in the room»). Равенство
  // означает «полны все»: тогда needsEnergy() ложно для каждого из ~60
  // объектов комнаты, и обход не нашёл бы ни одного кандидата.
  //
  // Замер shard3 29.09.2026 (scripts/cpu.peaks.measure.js, флаг
  // Memory.cpuGenProfile, 92 окна): во ВСЕХ 5 комнатах империи
  // energyAvailable == energyCapacityAvailable (12600/12600, 10000/10000,
  // 11600/11600, 10600/10600, 12600/12600) и needy = 0, а обход 285 объектов
  // обходился в 0.7921 CPU/тик — 77 % всего блока taskManager и ~18 % расхода
  // империи. Результат генератора при этом пустой: ни одной задачи.
  //
  // Проверка типов — для офлайн-тестов: у заглушки roomState этих полей нет,
  // и тогда генератор работает как раньше (обход), а не молча выключается.
  const roomEnergy = room && room.energyAvailable;
  if (
    typeof roomEnergy === "number" &&
    roomEnergy === room.energyCapacityAvailable
  ) {
    return;
  }

  const roomName = roomState.roomName;

  // ── Гейт по глубине очереди (решение человека 30.09.2026) ────────────
  // Пока свободных (никем не зарезервированных) задач этого типа в комнате
  // уже не меньше TASK_CONFIG.FILLSPAWNS_QUEUE_GATE, сканировать
  // spawn/extension нечего: свободную задачу воркер и так найдёт, а скан
  // стоит 0.021-0.025 CPU на неполную комнату за тик
  // (scripts/task.manager.bench.js, реплика цикла, N=300).
  //
  // Замер состояния очередей shard3 30.09.2026 (read-only): в 4 комнатах из 5
  // в очереди 12-18 задач, свободных 10-16, воркеров 2 на комнату.
  // freeTasks — O(1) по счётчику индекса (task.manager.js, freeTasks).
  //
  // Гейт НЕ меняет ни addTask, ни FIFO, ни потолок постановки: он лишь
  // пропускает скан, когда очередь и без него не пуста. Откат — поставить
  // TASK_CONFIG.FILLSPAWNS_QUEUE_GATE = 0.
  const gate = TASK_CONFIG.FILLSPAWNS_QUEUE_GATE;
  if (gate > 0 && taskManager.freeTasks(roomName, TASK_TYPE) >= gate) {
    return;
  }

  // storage.id читается один раз на комнату, а не на каждого кандидата:
  // свойство игрового объекта — вызов функции (см. комментарий в needsEnergy).
  const storageId = storage.id;

  // Один проход по двум спискам вместо spawns.concat(extensions): раньше на
  // каждую комнату за тик создавался промежуточный массив на 60+ элементов.
  const groups = [spawns, extensions];

  for (let g = 0; g < groups.length; g++) {
    const list = groups[g];

    for (let i = 0; i < list.length; i++) {
      const target = list[i];

      if (!needsEnergy(target)) {
        continue;
      }

      const candidate = {
        type: "transfer",
        sourceId: storageId,
        targetId: target.id,
        resourceType: RESOURCE_ENERGY,
      };

      if (isDuplicateTask(roomName, candidate)) {
        continue;
      }

      // addTask возвращает false, когда на эту комнату и тип в этом тике уже
      // поставлен потолок TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK
      // (task/lifecycle.js:44-58). Дальше ни одна задача не добавится —
      // прекращаем обход, не строя ключи дублей для остальных кандидатов.
      if (!taskManager.addTask(roomName, TASK_TYPE, candidate)) {
        return;
      }
    }
  }
}

// Поля, по которым задача считается дублем (задание 9 плана).

module.exports = {
  generateFillSpawnsExtensions,
};
