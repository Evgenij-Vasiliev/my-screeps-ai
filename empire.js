/**
 * EMPIRE KERNEL (Ядро Империи)
 * Уровень империи: очистка памяти, делегирование всей комнатной
 * логики Room Manager'у, запуск глобального рынка.
 */
const roomManager = require("room.manager");
const marketManager = require("market.manager");
const cpuMonitor = require("cpuMonitor");
const terminalNetwork = require("terminalNetwork");

module.exports.run = function () {
  cpuMonitor.startTick();

  // 1. Очистка памяти умерших крипов
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  // ── Гигиена Memory ──────────────────────────────────────────────────
  // Memory сериализуется ЦЕЛИКОМ каждый тик, поэтому любой мёртвый ключ —
  // это постоянный расход CPU. На живом шарде 27.09.2026 в Memory накопилось
  // 85 отладочных полей на 61 КБ (55 % объёма) — уборка ниже не даёт этому
  // повториться.
  //
  // Конвенция: имя поля верхнего уровня, начинающееся с "__", означает
  // ВРЕМЕННОЕ значение. Такие поля не переживают тик уборки.
  // Для отладки, когда значение нужно сохранить между тиками:
  //   Memory.keepTemp = true   — уборка временно выключена
  //   delete Memory.keepTemp   — снова включена
  if (Memory.keepTemp !== true) {
    for (const key in Memory) {
      // charCodeAt вместо startsWith: без создания подстроки на каждой итерации.
      if (key.charCodeAt(0) === 95 && key.charCodeAt(1) === 95) {
        delete Memory[key];
      }
    }
  }

  // towerState переехал в heap (задание 5), structureCache — в scanner.
  if (Memory.towerState) delete Memory.towerState;

  // 2. Уровень комнат — вся комнатная логика внутри roomManager
  roomManager.run();

  // 3. TerminalNetwork — межкомнатная балансировка ресурсов
  // cpuMonitor.trackRole("terminalNetwork", () => terminalNetwork.run());

  // 4. Рынок империального уровня
  cpuMonitor.trackRole("marketManager", () => marketManager.run());

  cpuMonitor.endTick();
};
