/**
 * ===================================================
 * DIAGNOSTIC.ENERGYTELEMETRY.JS
 * ===================================================
 * ВРЕМЕННЫЙ модуль по ТЗ №25.
 *
 * НЕ изменяет логику ни одной существующей подсистемы.
 * Только ЧИТАЕТ состояние Game.rooms / Game.creeps / empire.js
 * и пишет статистику в собственное, изолированное
 * пространство Memory.energyTelemetry.
 *
 * Единственная точка интеграции с существующим кодом —
 * один вызов tick() из main.js (см. инструкцию в конце файла).
 * Больше НИЧЕГО менять не требуется.
 *
 * Подлежит удалению по завершении ТЗ №25 —
 * см. reset().
 * ===================================================
 */

const empire = require("empire");

const SNAPSHOT_INTERVAL = 1000; // тиков, как задано в ТЗ №25 (Этап 6)
const MIN_TICKS = 5000; // минимальная продолжительность наблюдения
const GOOD_TICKS = 10000; // желательная продолжительность наблюдения

function getMyRooms() {
  return Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
}

function roomSnapshot(room) {
  const storageEnergy = room.storage
    ? room.storage.store[RESOURCE_ENERGY] || 0
    : 0;
  const terminalEnergy = room.terminal
    ? room.terminal.store[RESOURCE_ENERGY] || 0
    : 0;

  const factory = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_FACTORY,
  })[0];
  const factoryEnergy = factory ? factory.store[RESOURCE_ENERGY] || 0 : 0;

  const storageFree = room.storage
    ? room.storage.store.getFreeCapacity(RESOURCE_ENERGY)
    : null;
  const terminalFree = room.terminal
    ? room.terminal.store.getFreeCapacity(RESOURCE_ENERGY)
    : null;

  return {
    room: room.name,
    storage: storageEnergy,
    terminal: terminalEnergy,
    factory: factoryEnergy,
    storageFree,
    terminalFree,
    total: storageEnergy + terminalEnergy + factoryEnergy,
  };
}

// ЭТАП 8 — статистика по worker в аварийном режиме.
// Условие аварии повторяет ТОЛЬКО условие ЧТЕНИЯ из role.worker.js
// (getEnergy: storage && storage.energy > 200 → штатно, иначе → авария).
// Сама роль здесь не меняется и не переопределяется — вызовов
// crееp-методов нет, только чтение memory/store.
function workerEmergencyStats(room) {
  const workers = _.filter(
    Game.creeps,
    c => c.memory.room === room.name && c.memory.role === "worker",
  );

  const storageEnergy = room.storage
    ? room.storage.store[RESOURCE_ENERGY] || 0
    : 0;

  // working === false  →  крип сейчас в фазе "собираю энергию"
  const collecting = workers.filter(c => !c.memory.working);

  // Аварийная фаза наступает, если в этот момент storage
  // отсутствует или energy <= 200 (см. role.worker.js:getEnergy)
  const emergencyNow = !room.storage || storageEnergy <= 200;
  const emergency = emergencyNow ? collecting.length : 0;

  return {
    room: room.name,
    workers: workers.length,
    collecting: collecting.length,
    emergency,
    ratio: workers.length ? Math.round((emergency / workers.length) * 100) : 0,
  };
}

module.exports = {
  /**
   * ЭТАП 6 — временные ряды.
   * Вызывать КАЖДЫЙ тик из main.js. Сам делает throttle
   * по SNAPSHOT_INTERVAL (1000 тиков) внутри себя.
   */
  tick: function () {
    if (!Memory.energyTelemetry) {
      Memory.energyTelemetry = { startTick: Game.time, history: [] };
    }
    const t = Memory.energyTelemetry;
    if (Game.time % SNAPSHOT_INTERVAL !== 0) return;

    const rooms = getMyRooms().map(roomSnapshot);
    const workers = getMyRooms().map(workerEmergencyStats);

    t.history.push({ tick: Game.time, rooms, workers });
  },

  /**
   * ЭТАП 1, 2, 4, 5, 9 — срез состояния прямо сейчас.
   * Можно вызывать в любой момент из консоли.
   */
  snapshot: function () {
    const rooms = getMyRooms().map(roomSnapshot);
    const workers = getMyRooms().map(workerEmergencyStats);

    const withStatus = rooms.map(r => ({
      ...r,
      // Этап 5: статус по двум критериям одновременно
      storageStatus:
        r.storage < empire.energy.poorThreshold
          ? "POOR"
          : r.storage > empire.energy.richThreshold
          ? "RICH"
          : "NORMAL",
      totalStatus:
        r.total < empire.energy.poorThreshold
          ? "POOR"
          : r.total > empire.energy.richThreshold
          ? "RICH"
          : "NORMAL",
      // Этап 4: доля энергии в terminal
      terminalRatio: r.total > 0 ? Math.round((r.terminal / r.total) * 100) : 0,
    }));

    const empireStorage = rooms.reduce((s, r) => s + r.storage, 0);
    const empireTerminal = rooms.reduce((s, r) => s + r.terminal, 0);
    const empireFactory = rooms.reduce((s, r) => s + r.factory, 0);
    const empireTotal = empireStorage + empireTerminal + empireFactory;

    return {
      tick: Game.time,
      rooms: withStatus,
      workers,
      // Этап 9 — баланс всей империи
      empire: {
        storage: empireStorage,
        terminal: empireTerminal,
        factory: empireFactory,
        total: empireTotal,
        terminalShare:
          empireTotal > 0
            ? Math.round((empireTerminal / empireTotal) * 100)
            : 0,
      },
    };
  },

  /**
   * ЭТАП 7 — дельты между первым и последним накопленным снимком.
   */
  deltas: function () {
    const t = Memory.energyTelemetry;
    if (!t || t.history.length < 2) return null;

    const first = t.history[0];
    const last = t.history[t.history.length - 1];
    const ticksObserved = last.tick - first.tick;

    const rooms = last.rooms.map(lr => {
      const fr = first.rooms.find(r => r.room === lr.room) || lr;
      return {
        room: lr.room,
        deltaStorage: lr.storage - fr.storage,
        deltaTerminal: lr.terminal - fr.terminal,
        deltaTotal: lr.total - fr.total,
      };
    });

    return {
      ticksObserved,
      minReached: ticksObserved >= MIN_TICKS,
      goodReached: ticksObserved >= GOOD_TICKS,
      rooms,
    };
  },

  /**
   * Полный отчёт одним JSON — это то, что нужно скопировать
   * из консоли и прислать для составления финального документа.
   */
  report: function () {
    const t = Memory.energyTelemetry;
    return {
      snapshot: this.snapshot(),
      deltas: this.deltas(),
      historyLength: t && t.history ? t.history.length : 0,
      startTick: t ? t.startTick : null,
      nowTick: Game.time,
    };
  },

  /**
   * Удаление всех временных данных по завершении ТЗ №25.
   */
  reset: function () {
    delete Memory.energyTelemetry;
  },
};

/**
 * ===================================================
 * ИНСТРУКЦИЯ ПО ВРЕМЕННОМУ ПОДКЛЮЧЕНИЮ
 * ===================================================
 *
 * 1. Положить этот файл в кодовую базу как
 *    diagnostic.energyTelemetry.js
 *
 * 2. В main.js добавить ДВЕ строки (единственное
 *    изменение существующего кода за всё ТЗ №25,
 *    легко обратимое):
 *
 *    const energyTelemetry = require("diagnostic.energyTelemetry");
 *    ...
 *    module.exports.loop = function () {
 *      ...
 *      energyTelemetry.tick();   // добавить в любое место цикла
 *      ...
 *    };
 *
 * 3. Дать поработать МИНИМУМ 5000 тиков, ЖЕЛАТЕЛЬНО 10000.
 *
 * 4. В консоли выполнить и прислать результат:
 *
 *    JSON.stringify(require("diagnostic.energyTelemetry").report())
 *
 * 5. По завершении анализа — убрать 2 строки из main.js
 *    и выполнить:
 *
 *    require("diagnostic.energyTelemetry").reset()
 * ===================================================
 */
