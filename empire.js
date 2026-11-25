/**
 * EMPIRE KERNEL (Ядро Империи)
 * Уровень империи: очистка памяти, делегирование всей комнатной
 * логики Room Manager'у, запуск глобального рынка.
 */
const taskManager = require("task.manager");
const roomManager = require("room.manager");
const marketManager = require("market.manager");
const terminalNetwork = require("terminalNetwork");
const cpuMonitor = require("cpuMonitor");
const systems = require("systems");
const observerManager = require("observer.manager");
const defenseManager = require("defense.manager");
const remoteManager = require("remote.manager");
const { CPU } = require("./constants");

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

  // 2. Разведка и оборона — ДО комнатной логики.
  //
  // Почему раньше roomManager: defense.manager ставит Memory.attackAlert,
  // который в этом же тике читает role.attacker.js (роль запускает
  // roomManager), а threat.getHostiles заполняет кэш скана, который затем
  // переиспользуют башни (room.manager.js, runTowerLogic). Обратный порядок
  // давал бы атакующему тревогу прошлого тика и второй room.find на комнату.
  //
  // Разведка — необязательная подсистема: при критичном bucket она
  // пропускается (как в рабочей ветке origin/Новая-Империя:empire.js:104-116).
  // Оборона не пропускается никогда: пропуск боя дороже CPU.
  const bucketLow = Game.cpu.bucket < CPU.BUCKET_CRITICAL;
  if (systems.observer && !bucketLow) {
    cpuMonitor.trackRole("observerManager", () => observerManager.run());
  }
  if (systems.defense) {
    cpuMonitor.trackRole("defenseManager", () => defenseManager.run());
  }

  // 2b. Дальний контур — назначение creep.memory.targetRoom.
  //
  // Почему ДО roomManager: роли исполняет roomManager (карта ROLES), и они
  // должны видеть свежую комнату в ЭТОМ ЖЕ тике. Обратный порядок давал бы
  // роли комнату прошлого тика, а на первом тике жизни замены — targetRoom
  // null, то есть лишний тик простоя удалённой комнаты.
  //
  // Менеджер не обязателен для выживания (как разведка), но и не пропускается
  // при низком bucket: он не делает ни одного room.find и стоит один проход по
  // Game.creeps, а пропуск оставил бы замены без комнат.
  if (systems.remote) {
    cpuMonitor.trackRole("remoteManager", () => remoteManager.run());
  }

  // 3. Уровень комнат — вся комнатная логика внутри roomManager
  if (systems.roomManager) roomManager.run();

  // 4. TerminalNetwork — межкомнатная логистика (тумблер systems.terminalNetwork)
  if (systems.terminalNetwork) {
    cpuMonitor.trackRole("terminalNetwork", () => terminalNetwork.run());
  }
  // 5. Рынок империального уровня
  if (systems.marketManager) {
    cpuMonitor.trackRole("marketManager", () => marketManager.run());
  }

  // 6. Сжатие очередей задач. Завершение задачи оставляет в массиве
  // null-надгробие (чтобы не сдвигать массив и держать O(1)); дыры надо
  // убрать ДО конца тика, иначе они уедут в сериализованную Memory.
  cpuMonitor.trackRole("taskCompact", () => taskManager.compactAll());

  cpuMonitor.endTick();
};
