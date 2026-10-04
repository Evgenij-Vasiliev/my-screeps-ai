// ===================================================
// TASK/gen.upgrade.js — генератор задач апгрейда контроллера
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Нижняя категория TASK_CHAIN — последняя в цепочке приоритетов.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const { TASK_CONFIG, CONTROLLER } = require("../constants");

const FIELDS_UPGRADE = ["targetId"];

function isDuplicateUpgradeTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "upgradeController", candidate, FIELDS_UPGRADE);
}

function generateUpgradeController(roomState) {
  if (!TASK_CONFIG.upgradeController) return;

  const { controller, storage, roomName } = roomState;

  if (!controller || !storage) {
    return;
  }

  if (controller.ticksToDowngrade >= CONTROLLER.DOWNGRADE_MIN) {
    return;
  }

  const candidate = {
    type: "upgrade",
    targetId: controller.id,
  };

  if (isDuplicateUpgradeTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "upgradeController", candidate);
}


module.exports = {
  generateUpgradeController,
};
