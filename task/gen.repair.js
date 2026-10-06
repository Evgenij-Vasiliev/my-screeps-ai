// ===================================================
// TASK/gen.repair.js — генератор задач ремонта повреждённых структур
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Пороги семейства живут здесь же: REPAIR_THRESHOLD_RATIO — для НЕ-дорог
// (доля от hitsMax), ROAD_TASK_HITS — для дорог (абсолютные хиты, пункт 4
// плана). Список повреждённых структур даёт scanner, а НЕ room.manager:
// обратный require room.manager дал бы цикл и падение на шарде
// (task.generators.js:2-8). Обратный require room/repair цикла не даёт — тот
// модуль требует только scanner и constants (проверяет
// scripts/check.require.cycles.js).
//
// Пункт 5 плана: цель, которую в этом тике чинит башня, пропускается
// (towerRepairTargetId → addRepairTask).
//
// require("../constants"), require("../room/repair") и require("../systems") —
// при выгрузке deploy переводит относительные пути в корневые имена
// (scripts/deploy.modules.js, translateModuleSource), потому что движок
// Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const scanner = require("scanner");
const systems = require("../systems");
const { pickRepairTarget } = require("../room/repair");
const { TOWER, REPAIR } = require("../constants");

// Порог постановки задачи для НЕ-дорог — доля от hitsMax (как было).
const REPAIR_THRESHOLD_RATIO = 0.5;

/**
 * Порог постановки задачи для ДОРОГ — АБСОЛЮТНЫЕ хиты: `REPAIR.ROAD_TASK_HITS`.
 *
 * Значение живёт в барреле (constants/defense.js, REPAIR) и оно ОБЩЕЕ с башней:
 * башня перестаёт брать дорогу целью на той же линии, на которой воркер
 * закрывает задачу (`REPAIR.ROAD_DONE_HITS`, task/exec.repair.js и
 * room/repair.js). Пока пороги были врозь, башня гнала болотную дорогу
 * (25 000 хитов) до максимума — 29 действий по 10 энергии на одну дорогу, —
 * тогда как воркер считал её отремонтированной на 3 000. Обоснование полосы
 * [2 000; 3 000] и почему хиты, а не доля, — в комментарии к REPAIR.
 */

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_REPAIR = ["targetId"];

function isDuplicateRepairTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "repairStructures", candidate, FIELDS_REPAIR);
}

function generateRepairStructures(roomState) {
  const { roomName } = roomState;
  const cache = roomState._structureCache;
  const hasNumbers =
    !!cache && !!cache.damagedRoadIds && !!cache.damagedRoadHits;

  // Цель, которую в этом тике чинит башня (пункт 5 плана): задача на неё не
  // ставится. Считается один раз на комнату и только если башни реально могут
  // чинить — см. towerRepairTargetId.
  const skipId = towerRepairTargetId(roomState);

  // 1. Дороги — числами из кэша сканера. Ни Game.getObjectById, ни массива
  //    дескрипторов: отбор идёт прямо по типизированным массивам кэша.
  //    Порог у дорог свой — абсолютные хиты (ROAD_TASK_HITS, пункт 4 плана).
  if (hasNumbers) {
    const ids = cache.damagedRoadIds;
    const hits = cache.damagedRoadHits;

    for (let i = 0; i < ids.length; i++) {
      if (!isBelowRoadThreshold(hits[i])) continue;
      if (!isLiveDamaged(ids[i])) continue;
      addRepairTask(roomName, ids[i], skipId);
    }

    // 2. Группы структур (spawns/towers/extensions/links/labs и остальные) —
    //    тоже числами. Дескрипторы собираются в один массив на вызов.
    const groups = [];
    scanner.collectDamagedStructures(cache, groups);

    for (let i = 0; i < groups.length; i++) {
      const s = groups[i];
      if (!isBelowRepairThreshold(s.hits, s.hitsMax)) continue;
      if (!isLiveDamaged(s.id)) continue;
      addRepairTask(roomName, s.id, skipId);
    }

    return;
  }

  // Фолбэк для старого кэша в heap и для фикстур тестов: объекты, уже
  // собранные вызывающим кодом. Тип структуры здесь известен, поэтому порог
  // выбирается по нему — как в основной ветке.
  const damagedStructures = roomState.damagedStructures;
  if (!damagedStructures) return;

  for (let i = 0; i < damagedStructures.length; i++) {
    const structure = damagedStructures[i];

    if (structure.structureType === STRUCTURE_ROAD) {
      if (!isBelowRoadThreshold(structure.hits)) continue;
    } else if (!isBelowRepairThreshold(structure.hits, structure.hitsMax)) {
      continue;
    }

    addRepairTask(roomName, structure.id, skipId);
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
 * Дорога ниже порога ремонта: хитов меньше ROAD_TASK_HITS (пункт 4 плана).
 *
 * Максимум хитов здесь не нужен вовсе — порог абсолютный. `undefined` (дорога
 * без снимка в кэше) проверку не проходит, как и в isBelowRepairThreshold.
 *
 * @param {number|undefined} hits
 * @returns {boolean}
 */
function isBelowRoadThreshold(hits) {
  return typeof hits === "number" && hits < REPAIR.ROAD_TASK_HITS;
}

/**
 * Цель, которую в ЭТОМ тике будет чинить башня, или null (пункт 5 плана).
 *
 * Берётся ТА ЖЕ функция и тот же roomState, что у runTowerLogic
 * (room/towers.js:142): `pickRepairTarget` — чистая функция от кэша
 * повреждённых структур (room/repair.js:248-329), поэтому выбор совпадает.
 * Цикла require нет: room/repair.js требует только scanner и constants.
 * Двойной вызов дешёв: перебор чисел кэша, объекты не резолвятся, валы
 * мемоизируются на roomState. Взамен задача не ставится туда, куда башня уже
 * едет: одно действие башни — 800 хитов, воркер с 1 WORK — 100 хитов за тик
 * плюс дорога до цели.
 *
 * Два гейта, чтобы пропуск не оставил структуру вообще без ремонта:
 *   `systems.towers !== false` — выключенные башни не чинят ничего;
 *   у какой-то башни энергия > `TOWER.REPAIR_ENERGY_MIN` — ровно тот порог, по
 *   которому роль отказывается чинить (role.tower.js:34). Без него самая
 *   повреждённая структура комнаты не получила бы ни задачи, ни ремонта: у
 *   дороги это навсегда, `createConstructionSite` в боте не вызывается.
 *
 * @param {Object} roomState
 * @returns {string|null}
 */
function towerRepairTargetId(roomState) {
  if (systems.towers === false) return null;

  const towers = roomState.towers;
  if (!towers || towers.length === 0) return null;

  let ready = false;

  for (let i = 0; i < towers.length; i++) {
    const tower = towers[i];
    const store = tower && tower.store;

    // Нет стора (фикстуры тестов) — считаем, что чинить нечем: лишняя задача
    // безопаснее пропущенной.
    if (store && store[RESOURCE_ENERGY] > TOWER.REPAIR_ENERGY_MIN) {
      ready = true;
      break;
    }
  }

  if (!ready) return null;

  const target = pickRepairTarget(roomState);

  return target ? target.id : null;
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

/**
 * Ставит repair-задачу, если такой ещё нет.
 *
 * `skipId` — цель, которую в этом тике чинит башня (пункт 5 плана): на неё
 * задача не ставится. `undefined`, когда башни чинить не могут или цели нет.
 */
function addRepairTask(roomName, targetId, skipId) {
  if (targetId === skipId) return;

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
