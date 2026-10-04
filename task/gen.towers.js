// ===================================================
// TASK/gen.towers.js — генератор наполнения башен
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Башни берут цель ремонта из room/repair.js, а энергию — этой задачей.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const { TOWER, TASK_CONFIG } = require("../constants");

const FIELDS_FILLTOWERS = ["type", "targetId", "sourceId", "resourceType"];

function isDuplicateFillTowersTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillTowers", candidate, FIELDS_FILLTOWERS);
}

function generateFillTowers(roomState) {
  if (!TASK_CONFIG.fillTowers) return;
  const { storage, towers, roomName } = roomState;

  if (!storage) {
    return;
  }

  for (const tower of towers) {
    // .energy — алиас store[RESOURCE_ENERGY] (@types/screeps:5343-5355):
    // чтение свойства дешевле, чем store[RESOURCE_ENERGY] (замер 30.09.2026,
    // scripts/task.manager.bench.js, случай 12d: обращение к store + вызов
    // getCapacity стоит 0.0193 CPU на 62 объекта, алиасы — 0.0034).
    if (tower.energy >= TOWER.SUPPLY_THRESHOLD) {
      continue;
    }

    const candidate = {
      type: "transfer",
      sourceId: storage.id,
      targetId: tower.id,
      resourceType: RESOURCE_ENERGY,
    };

    if (isDuplicateFillTowersTask(roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomName, "fillTowers", candidate);
  }
}


module.exports = {
  generateFillTowers,
};
