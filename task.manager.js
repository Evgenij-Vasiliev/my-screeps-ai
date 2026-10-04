// ===================================================
// TASK.MANAGER.JS — фасад системы задач: очереди и их жизненный цикл
// ===================================================
// Единая точка входа блока task/: наружу отдаёт те же ТРИНАДЦАТЬ имён и в том
// же порядке, что были до разбиения 04.10.2026 (было 554 строки в одном
// файле). Имя модуля и набор экспортов не меняются, поэтому потребители
// (empire.js:6, room/run.js:12, room/creeps.js:15, task/runner.js:1,
// тесты tests) правок не требуют.
//
// Логика разложена по модулям каталога task:
//   task/queue.js     — структура очереди в Memory и heap-индекс на тик;
//   task/lookup.js    — чтение: getTaskById, freeTasks, getNextTask;
//   task/lifecycle.js — запись: addTask, reserveTask, releaseTask,
//                       completeTask, removeTask, compactAll.
//
// Почему фасад, а не один файл: правило 4 DEVELOPMENT_RULES.md (единственная
// ответственность) и правило 3 (малые этапы). Прецедент — room.manager.js,
// разложенный 04.10.2026 на модули каталога room с сохранением имени и экспортов.
//
// require("./task/x") ниже Node разрешает как обычно; на шарде движок
// отбрасывает ведущий "./" и ищет имя от корня (Gruntfile.js:22-25), поэтому
// и там это "task/x". Модули ВНУТРИ task/ пишут require("./x") — при выгрузке
// такой вызов переводится в "task/x" (scripts/deploy.modules.js,
// translateModuleSource).
// ===================================================
const queue = require("./task/queue");
const lookup = require("./task/lookup");
const lifecycle = require("./task/lifecycle");

module.exports = {
  TASK_CHAIN: queue.TASK_CHAIN,
  TASK_TYPE_SET: queue.TASK_TYPE_SET,
  hasDuplicate: queue.hasDuplicate,
  getTaskById: lookup.getTaskById,
  freeTasks: lookup.freeTasks,
  compactAll: lifecycle.compactAll,
  initRoomTasks: queue.initRoomTasks,
  addTask: lifecycle.addTask,
  getNextTask: lookup.getNextTask,
  reserveTask: lifecycle.reserveTask,
  releaseTask: lifecycle.releaseTask,
  completeTask: lifecycle.completeTask,
  removeTask: lifecycle.removeTask,
};
