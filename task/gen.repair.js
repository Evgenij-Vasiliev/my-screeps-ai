// ===================================================
// TASK/gen.repair.js — генератор задач ремонта повреждённых структур
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// REPAIR_THRESHOLD_RATIO живёт здесь же (константа семейства). Единственный потребитель
// списка повреждённых структур — scanner, а НЕ room.manager:
// обратный require дал бы цикл и падение на шарде (task.generators.js:2-8).
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const scanner = require("scanner");
const { TASK_CONFIG } = require("../constants");

const REPAIR_THRESHOLD_RATIO = 0.5;

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_REPAIR = ["targetId"];

function isDuplicateRepairTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "repairStructures", candidate, FIELDS_REPAIR);
}

function generateRepairStructures(roomState) {
  if (!TASK_CONFIG.repairStructures) return;

  const { roomName } = roomState;
  const cache = roomState._structureCache;
  const hasNumbers =
    !!cache && !!cache.damagedRoadIds && !!cache.damagedRoadHits;

  // 1. Дороги — числами из кэша сканера. Ни Game.getObjectById, ни массива
  //    дескрипторов: отбор идёт прямо по типизированным массивам кэша.
  if (hasNumbers) {
    const ids = cache.damagedRoadIds;
    const hits = cache.damagedRoadHits;
    const maxes = cache.damagedRoadHitsMax;

    for (let i = 0; i < ids.length; i++) {
      if (!isBelowRepairThreshold(hits[i], maxes[i])) continue;
      if (!isLiveDamaged(ids[i])) continue;
      addRepairTask(roomName, ids[i]);
    }

    // 2. Группы структур (spawns/towers/extensions/links/labs и остальные) —
    //    тоже числами. Дескрипторы собираются в один массив на вызов.
    const groups = [];
    scanner.collectDamagedStructures(cache, groups);

    for (let i = 0; i < groups.length; i++) {
      const s = groups[i];
      if (!isBelowRepairThreshold(s.hits, s.hitsMax)) continue;
      if (!isLiveDamaged(s.id)) continue;
      addRepairTask(roomName, s.id);
    }

    return;
  }

  // Фолбэк для старого кэша в heap и для фикстур тестов: объекты, уже
  // собранные вызывающим кодом.
  const damagedStructures = roomState.damagedStructures;
  if (!damagedStructures) return;

  for (let i = 0; i < damagedStructures.length; i++) {
    const structure = damagedStructures[i];
    if (!isBelowRepairThreshold(structure.hits, structure.hitsMax)) continue;
    addRepairTask(roomName, structure.id);
  }
}

/**
 * Структура ниже порога ремонта: hits вдвое хуже максимума.
 *
 * `REPAIR_THRESHOLD_RATIO` = 0.5, сравнение `hits < hitsMax * 0.5` записано
 * как `hits * (1 / 0.5) < hitsMax`, то есть `hits * 2 < hitsMax`: так в
 * горячем цикле нет ни деления, ни дробного множителя (элементов сотни,
 * проверка идёт каждый тик). Числа приходят либо из кэша сканера (дороги),
 * либо с живых объектов (группы структур); undefined (источник без снимка)
 * не проходит проверку.
 *
 * @param {number|undefined} hits
 * @param {number|undefined} hitsMax
 * @returns {boolean}
 */
function isBelowRepairThreshold(hits, hitsMax) {
  return (
    typeof hits === "number" &&
    typeof hitsMax === "number" &&
    hits * (1 / REPAIR_THRESHOLD_RATIO) < hitsMax
  );
}

/**
 * Живой объект ещё повреждён.
 *
 * Нужно только для дорог: их hits взяты из кэша сканера (возраст до
 * CACHE.REFRESH_INTERVAL тиков), поэтому кандидат проверяется по-настоящему.
 * Кандидатов единицы, а дорог в списке сотни — резолв идёт только по
 * прошедшим порог, обычно это 0 объектов.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isLiveDamaged(id) {
  const live = Game.getObjectById(id);
  return !!live && live.hits < live.hitsMax;
}

/** Ставит repair-задачу, если такой ещё нет. */
function addRepairTask(roomName, targetId) {
  const candidate = {
    type: "repair",
    targetId,
  };

  if (isDuplicateRepairTask(roomName, candidate)) return;

  taskManager.addTask(roomName, "repairStructures", candidate);
}


module.exports = {
  generateRepairStructures,
};
