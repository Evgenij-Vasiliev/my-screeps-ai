/**
 * EMPIRE KERNEL (Ядро Империи)
 * Уровень империи: очистка памяти, делегирование всей комнатной
 * логики Room Manager'у, запуск глобального рынка.
 */
const observerManager = require("observer.manager");
const roomManager = require("room.manager");
const marketManager = require("market.manager");
const cpuMonitor = require("cpuMonitor");
const terminalNetwork = require("terminalNetwork");
const defenseManager = require("defense.manager");
const remoteManager = require("remote.manager");

module.exports.run = function () {
  cpuMonitor.startTick();

  // 1. Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // 2. Уровень комнат — вся комнатная логика внутри roomManager
  cpuMonitor.trackRole("roomManager", () => roomManager.run());
  // roomManager.run();

  // 3. Разведка

  cpuMonitor.trackRole("observerManager", () => observerManager.run());

  // 4. Оборона — защита ремоут-комнат
  cpuMonitor.trackRole("defenseManager", () => defenseManager.run());

  // 5. Дальняя добыча — резервер / дальний майнер / дальний хайлер
  cpuMonitor.trackRole("remoteManager", () => remoteManager.run());

  // 6. TerminalNetwork — межкомнатная балансировка ресурсов
  cpuMonitor.trackRole("terminalNetwork", () => terminalNetwork.run());

  // 7. Рынок империального уровня
  cpuMonitor.trackRole("marketManager", () => marketManager.run());

  cpuMonitor.endTick();
};
