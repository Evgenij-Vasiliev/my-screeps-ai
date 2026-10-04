// ===================================================
// ROOM.MANAGER.JS — фасад уровня комнаты
// ===================================================
// Единая точка входа уровня комнаты: строит roomState для каждой комнаты и
// запускает её подсистемы — спавн, задачи воркеров, логику крипов, башни,
// линки, фабрику. Уровень империи (empire.js) знает только про очистку
// памяти, вызов Room Manager'а и глобальный рынок.
//
// Значения и логика разложены по каталогу room/*.js (разбиение 04.10.2026,
// было 960 строк в одном файле): creeps, repair, towers, links, state, run.
// Этот файл НЕ хранит логику, а собирает те же ДЕВЯТЬ экспортов, что были
// раньше: имя модуля и объект, который зовут empire.js и замеры в консоли
// (scripts/cpu.parts.measure.js: require("room.manager").getOwnedRooms()),
// не меняются.
//
// ВАЖНО: методы обязаны вызываться как roomManager.X() — внутри state/run
// остались вызовы через `this` (this.buildAllRoomStates, this.runRoom, ...),
// и на них держатся тесты, которые подменяют методы
// (tests/systems.test.js:434-441).
// ===================================================

const creeps = require("./room/creeps");
const repair = require("./room/repair");
const towers = require("./room/towers");
const links = require("./room/links");
const state = require("./room/state");
const run = require("./room/run");

module.exports = {
  // Экспортируется для офлайн-тестов (tests/tower.attack.test.js):
  // логика башен и детектор атаки проверяются без запуска всего цикла.
  runTowerLogic: towers.runTowerLogic,
  detectAttack: towers.detectAttack,
  // Экспортируется для тестов и для роли (roomData.canRepair): тик ремонта
  // башен у каждой комнаты свой, см. комментарий к функции.
  isTowerRepairTick: towers.isTowerRepairTick,
  // Экспортируется для генератора repair-задач (task.generators.js) и тестов:
  // список повреждённых структур комнаты собирается лениво.
  getDamagedStructures: repair.getDamagedStructures,
  getOwnedRooms: state.getOwnedRooms,
  buildRoomState: state.buildRoomState,
  buildAllRoomStates: state.buildAllRoomStates,
  runRoom: run.runRoom,
  run: run.run,
};
