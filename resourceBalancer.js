/**
 * ===================================================
 * RESOURCEBALANCER.JS — Глобальный балансировщик ресурсов
 * ===================================================
 * Запускается из terminalManager.run() один раз за тик
 * (только из первой комнаты по алфавиту).
 *
 * Работает раз в BALANCE_INTERVAL тиков.
 *
 * Логика:
 * 1. Собирает запасы всех ресурсов во всех наших комнатах
 * 2. Для каждого ресурса находит "богатых" (излишек) и "бедных" (дефицит)
 * 3. Богатый отправляет бедному через терминал (или ставит запрос в очередь)
 *
 * ИСПРАВЛЕНО v2:
 * - Каждый донор делает максимум ОДИН запрос/отправку за запуск.
 *   Раньше один донор мог получить 8 запросов за тик — очередь
 *   terminalNeeds переполнялась, terminalUnloader не справлялся,
 *   CPU скакал до 14+.
 *   Теперь используем Set busyDonors — донор занят после первого запроса.
 *
 * Пороги:
 * - RESERVE_MIN       — минимум который комната держит у себя (не отдаёт)
 * - DEFICIT_THRESHOLD — ниже этого комната считается "бедной"
 *
 * Управление через консоль:
 *   Memory.balancerEnabled = false  — остановить балансировщик
 *   Memory.balancerEnabled = true   — возобновить (по умолчанию включён)
 *   Memory.balancerDebug = true     — подробные логи
 * ===================================================
 */

const BALANCE_INTERVAL = 100;
const TERMINAL_ENERGY_MIN = 20000;

const RESERVE_MIN = {
  O: 15000,
  H: 15000,
  Z: 15000,
  K: 15000,
  L: 15000,
  U: 15000,
  X: 15000,
  OH: 8000,
  ZK: 8000,
  ZO: 8000,
  KH: 8000,
  LO: 8000,
  UO: 8000,
  UH: 8000,
  LH: 8000,
  GH: 8000,
  ZHO2: 3000,
  KHO2: 3000,
  LHO2: 3000,
  UHO2: 3000,
  UH2O: 3000,
  KH2O: 3000,
  LH2O: 3000,
  GH2O: 3000,
};

const DEFICIT_THRESHOLD = {
  O: 5000,
  H: 5000,
  Z: 5000,
  K: 5000,
  L: 5000,
  U: 5000,
  X: 5000,
  OH: 2000,
  ZK: 2000,
  ZO: 2000,
  KH: 2000,
  LO: 2000,
  UO: 2000,
  UH: 2000,
  LH: 2000,
  GH: 2000,
  ZHO2: 1000,
  KHO2: 1000,
  LHO2: 1000,
  UHO2: 1000,
  UH2O: 1000,
  KH2O: 1000,
  LH2O: 1000,
  GH2O: 1000,
};

const SEND_AMOUNT = {
  O: 10000,
  H: 10000,
  Z: 10000,
  K: 10000,
  L: 10000,
  U: 10000,
  X: 10000,
  OH: 5000,
  ZK: 5000,
  ZO: 5000,
  KH: 5000,
  LO: 5000,
  UO: 5000,
  UH: 5000,
  LH: 5000,
  GH: 5000,
  ZHO2: 2000,
  KHO2: 2000,
  LHO2: 2000,
  UHO2: 2000,
  UH2O: 2000,
  KH2O: 2000,
  LH2O: 2000,
  GH2O: 2000,
};

const resourceBalancer = {
  getTotal: function (room, resource) {
    const s = room.storage ? room.storage.store[resource] || 0 : 0;
    const t = room.terminal ? room.terminal.store[resource] || 0 : 0;
    return s + t;
  },

  addNeed: function (donorRoom, resource, amount, toRoom) {
    if (!donorRoom.memory.terminalNeeds) {
      donorRoom.memory.terminalNeeds = [];
    }
    const needs = donorRoom.memory.terminalNeeds;
    const existing = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );
    if (existing) {
      existing.amount = amount;
      return false;
    }
    needs.push({ resource, amount, toRoom });
    return true;
  },

  run: function () {
    if (Memory.balancerEnabled === false) return;
    if (Game.time % BALANCE_INTERVAL !== 0) return;

    const debug = Memory.balancerDebug === true;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    if (ourRooms.length < 2) return;

    // Собираем все ресурсы которые есть хоть в одной комнате
    const allResources = new Set();
    for (const room of ourRooms) {
      for (const res of Object.keys(room.storage.store)) {
        if (res !== RESOURCE_ENERGY) allResources.add(res);
      }
      for (const res of Object.keys(room.terminal.store)) {
        if (res !== RESOURCE_ENERGY) allResources.add(res);
      }
    }

    // ИСПРАВЛЕНИЕ v2: отслеживаем занятых доноров.
    // Каждый донор делает максимум ОДИН запрос/отправку за запуск.
    // Это предотвращает переполнение очереди terminalNeeds и скачки CPU.
    const busyDonors = new Set();

    for (const resource of allResources) {
      const reserveMin = RESERVE_MIN[resource] || 5000;
      const deficitThresh = DEFICIT_THRESHOLD[resource] || 2000;
      const sendAmount = SEND_AMOUNT[resource] || 3000;

      // Бедные комнаты: запас ниже порога дефицита
      const poorRooms = ourRooms.filter(
        r => this.getTotal(r, resource) < deficitThresh,
      );

      if (poorRooms.length === 0) continue;

      // Богатые комнаты: запас выше резерва и ещё не заняты в этом запуске
      const richRooms = ourRooms.filter(
        r =>
          this.getTotal(r, resource) > reserveMin + sendAmount &&
          r.terminal.cooldown === 0 &&
          !busyDonors.has(r.name),
      );

      if (richRooms.length === 0) {
        if (debug) {
          console.log(
            `[Balancer] ${resource}: бедных ${poorRooms.length}, нет свободных доноров`,
          );
        }
        continue;
      }

      // Берём первую бедную комнату и первого свободного донора
      const poorRoom = poorRooms[0];
      const donor = richRooms.find(r => r.name !== poorRoom.name);
      if (!donor) continue;

      const actualSend = Math.min(
        sendAmount,
        this.getTotal(donor, resource) - reserveMin,
      );
      if (actualSend <= 0) continue;

      const inTerminal = donor.terminal.store[resource] || 0;

      if (inTerminal < actualSend) {
        // Ресурс в storage — просим terminalUnloader перенести в терминал
        const isNew = this.addNeed(donor, resource, actualSend, poorRoom.name);
        if (isNew || debug) {
          console.log(
            `[Balancer] 📦 ${donor.name}: перенести ${actualSend} ${resource}` +
              ` → ${poorRoom.name}`,
          );
        }
        // Донор занят — больше не даём ему запросов в этом запуске
        busyDonors.add(donor.name);
        continue;
      }

      // Проверяем энергию на транзакцию
      const txCost = Game.market.calcTransactionCost(
        actualSend,
        donor.name,
        poorRoom.name,
      );
      const donorEnergy = donor.terminal.store[RESOURCE_ENERGY] || 0;

      if (txCost > donorEnergy - TERMINAL_ENERGY_MIN) {
        console.log(
          `[Balancer] ⚡ ${donor.name}: мало энергии для ${resource}` +
            ` (нужно: ${txCost}, есть: ${donorEnergy})`,
        );
        continue;
      }

      // Отправляем
      const result = donor.terminal.send(resource, actualSend, poorRoom.name);
      if (result === OK) {
        console.log(
          `[Balancer] ✅ ${donor.name} → ${poorRoom.name}: ${actualSend} ${resource}`,
        );
        if (donor.memory.terminalNeeds) {
          donor.memory.terminalNeeds = donor.memory.terminalNeeds.filter(
            n => !(n.resource === resource && n.toRoom === poorRoom.name),
          );
        }
        // Донор занят — терминал на кулдауне
        busyDonors.add(donor.name);
      } else {
        console.log(`[Balancer] ❌ Ошибка отправки ${resource}: ${result}`);
      }
    }
  },
};

module.exports = resourceBalancer;
