const spawnManager = require("spawn.manager");
const creepRunner = require("creep.runner");
const towerManager = require("tower.manager");
const linkManager = require("link.manager");
const terminalManager = require("terminal.manager");
const marketManager = require("market.manager");
const factoryManager = require("factory.manager");
const roomRemote = require("room.remote");
const observerManager = require("observer.manager");
const cpuMonitor = require("cpuMonitor");

module.exports = {
  run: function (room) {
    // --------------------------------------------------------
    // 1. ИНИЦИАЛИЗАЦИЯ ПАМЯТИ КОМНАТЫ
    // --------------------------------------------------------
    // Создаёт базовую структуру Memory.rooms[room.name]
    // Используется всеми системами комнаты
    this._initMemory(room);

    // --------------------------------------------------------
    // 2. ОСНОВНЫЕ СИСТЕМЫ КОМНАТЫ
    // --------------------------------------------------------
    // Каждая подсистема отвечает за свой участок логики

    cpuMonitor.trackRole("towerManager", () => towerManager.run(room));
    cpuMonitor.trackRole("linkManager", () => linkManager.run(room));
    // cpuMonitor.trackRole("terminalManager", () => terminalManager.run(room));
    // cpuMonitor.trackRole("marketManager", () => marketManager.run(room));
    cpuMonitor.trackRole("spawnManager", () => spawnManager.run(room));

    // Управление поведением крипов (добыча, перенос, ремонт и т.д.)
    creepRunner.run(room);

    // Производственные здания (factory)
    factoryManager.run(room);

    // Работа с удалёнными комнатами (remote mining)
    roomRemote.run(room);

    // Разведка карты (observer)
    observerManager.run(room);

    // --------------------------------------------------------
    // 3. ВИЗУАЛИЗАЦИЯ СТАТУСА КРИПОВ
    // --------------------------------------------------------
    this._drawStats(room);
  },

  // --------------------------------------------------------
  // ИНИЦИАЛИЗАЦИЯ ПАМЯТИ
  // --------------------------------------------------------
  _initMemory: function (room) {
    if (!Memory.rooms) Memory.rooms = {};

    if (!Memory.rooms[room.name]) {
      Memory.rooms[room.name] = {
        wallThreshold: 1000, // базовый параметр защиты стен
      };

      console.log(`[room.manager] Memory initialized for ${room.name}`);
    }
  },

  // --------------------------------------------------------
  // ВИЗУАЛЬНАЯ СТАТИСТИКА КРИПОВ
  // --------------------------------------------------------
  _drawStats: function (room) {
    // выбираем всех крипов, закреплённых за комнатой
    const creeps = _.filter(Game.creeps, c => c.memory.room === room.name);

    // группируем по ролям
    const byRole = _.countBy(creeps, c => c.memory.role);

    // форматируем строку вывода
    const text = Object.entries(byRole)
      .map(([role, count]) => `${role}: ${count}`)
      .join(" | ");

    // вывод в комнате
    if (text) {
      room.visual.text(`[${room.name}] ${text}`, 1, 1, {
        align: "left",
        opacity: 0.6,
        fontSize: 0.6,
      });
    }
  },
};
