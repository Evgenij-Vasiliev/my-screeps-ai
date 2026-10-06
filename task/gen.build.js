// ===================================================
// TASK/gen.build.js — генератор задач стройки
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// collectTargetIds перенесён сюда же: его единственный вызов — в generateBuildStructures.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");

/**
 * Множество targetId, уже стоящих в очереди задач указанного типа.
 * Собирается один раз, чтобы проверка дублей не была O(кандидаты x очередь).
 * @param {string} roomName
 * @param {string} taskType
 * @returns {Set<string>}
 */
function collectTargetIds(roomName, taskType) {
  const ids = new Set();
  const tasks =
    Memory.rooms &&
    Memory.rooms[roomName] &&
    Memory.rooms[roomName].tasks &&
    Memory.rooms[roomName].tasks[taskType];

  if (tasks) {
    for (let i = 0; i < tasks.length; i++) {
      // null — надгробие задачи, завершённой в этом тике.
      if (tasks[i]) ids.add(tasks[i].targetId);
    }
  }

  return ids;
}

function generateBuildStructures(roomState) {
  const { roomName } = roomState;

  // Стройплощадки комнаты из общего индекса — без перебора всей Империи
  // на каждую комнату за тик.
  const sites = roomState.constructionSites;
  if (!sites || sites.length === 0) return;

  const existing = collectTargetIds(roomName, "buildStructures");

  for (let i = 0; i < sites.length; i++) {
    const siteId = sites[i].id;
    if (existing.has(siteId)) continue;

    taskManager.addTask(roomName, "buildStructures", {
      type: "build",
      targetId: siteId,
    });
    existing.add(siteId);
  }
}

// Поля, по которым задача считается дублем (задание 9 плана).

module.exports = {
  generateBuildStructures,
};
