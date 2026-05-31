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
 *
 * ДОПОЛНЕНО v3:
 * - Интеграция с Logger: события resource_imbalance, transfer_created,
 *   transfer_completed
 * - Публикация статистики в Memory.empire.balancer — видна в balance()
 * - Добавлены KH, battery, energy в RESERVE_MIN / DEFICIT_THRESHOLD / SEND_AMOUNT
 *
 * Управление через консоль:
 *   Memory.balancerEnabled = false  — остановить балансировщик
 *   Memory.balancerEnabled = true   — возобновить (по умолчанию включён)
 *   Memory.balancerDebug = true     — подробные логи
 * ===================================================
 */

const Logger = require("./logger");

const BALANCE_INTERVAL = 100;
const TERMINAL_ENERGY_MIN = 20000;

const RESERVE_MIN = {
  // Энергия и батарейки
  energy: 50000,
  battery: 10000,
  // Сырьё
  O: 3000,
  H: 3000,
  Z: 15000,
  K: 15000,
  L: 15000,
  U: 15000,
  X: 15000,
  // T1 compounds
  OH: 8000,
  ZK: 8000,
  ZO: 8000,
  KH: 8000, // добавлен v3
  LO: 8000,
  UO: 8000,
  UH: 8000,
  LH: 8000,
  GH: 8000,
  // T2 compounds
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
  energy: 20000,
  battery: 3000,
  O: 1000,
  H: 1000,
  Z: 5000,
  K: 5000,
  L: 5000,
  U: 5000,
  X: 5000,
  OH: 2000,
  ZK: 2000,
  ZO: 2000,
  KH: 2000, // добавлен v3
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
  energy: 30000,
  battery: 5000,
  O: 2000,
  H: 2000,
  Z: 10000,
  K: 10000,
  L: 10000,
  U: 10000,
  X: 10000,
  OH: 5000,
  ZK: 5000,
  ZO: 5000,
  KH: 5000, // добавлен v3
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
    // energy добавляем отдельно — она не попадает в цикл выше
    allResources.add(RESOURCE_ENERGY);

    // Отслеживаем занятых доноров — каждый делает максимум ОДИН запрос за запуск
    const busyDonors = new Set();

    // [NEW v3] Статистика для публикации в Memory.empire.balancer
    const imbalances = []; // найденные дисбалансы
    let transferCount = 0; // реальных отправок за этот запуск
    let queuedCount = 0; // запросов в terminalNeeds

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

      const poorRoom = poorRooms[0];
      const donor = richRooms.find(r => r.name !== poorRoom.name);
      if (!donor) continue;

      const actualSend = Math.min(
        sendAmount,
        this.getTotal(donor, resource) - reserveMin,
      );
      if (actualSend <= 0) continue;

      // [NEW v3] Фиксируем дисбаланс
      imbalances.push({
        resource,
        from: donor.name,
        to: poorRoom.name,
        amount: actualSend,
      });

      // [NEW v3] Событие дисбаланса (раз в BALANCE_INTERVAL — не спамим)
      Logger.event(
        "resource_imbalance",
        donor.name,
        `${resource}: ${donor.name}→${poorRoom.name} (~${actualSend})`,
        { resource, from: donor.name, to: poorRoom.name, amount: actualSend },
      );

      const inTerminal = donor.terminal.store[resource] || 0;

      if (inTerminal < actualSend) {
        // Ресурс в storage — просим terminalUnloader перенести в терминал
        const isNew = this.addNeed(donor, resource, actualSend, poorRoom.name);
        if (isNew || debug) {
          console.log(
            `[Balancer] 📦 ${donor.name}: перенести ${actualSend} ${resource}` +
              ` → ${poorRoom.name}`,
          );
          // [NEW v3] Событие постановки в очередь
          Logger.event(
            "transfer_created",
            donor.name,
            `queued: ${actualSend} ${resource} → ${poorRoom.name}`,
            {
              resource,
              to: poorRoom.name,
              amount: actualSend,
              via: "terminalNeeds",
            },
          );
        }
        busyDonors.add(donor.name);
        queuedCount++;
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
        // [NEW v3] Событие — нет энергии для отправки
        Logger.event(
          "terminal_blocked",
          donor.name,
          `нет энергии для transfer ${resource}: нужно ${txCost}, есть ${donorEnergy}`,
          { resource, txCost, energy: donorEnergy },
        );
        continue;
      }

      // Отправляем
      const result = donor.terminal.send(resource, actualSend, poorRoom.name);
      if (result === OK) {
        console.log(
          `[Balancer] ✅ ${donor.name} → ${poorRoom.name}: ${actualSend} ${resource}`,
        );
        // [NEW v3] Событие успешной отправки
        Logger.event(
          "transfer_completed",
          donor.name,
          `sent ${actualSend} ${resource} → ${poorRoom.name}`,
          { resource, to: poorRoom.name, amount: actualSend },
        );

        if (donor.memory.terminalNeeds) {
          donor.memory.terminalNeeds = donor.memory.terminalNeeds.filter(
            n => !(n.resource === resource && n.toRoom === poorRoom.name),
          );
        }
        busyDonors.add(donor.name);
        transferCount++;
      } else {
        console.log(`[Balancer] ❌ Ошибка отправки ${resource}: ${result}`);
        // [NEW v3] Событие ошибки
        Logger.event(
          "terminal_send_failed",
          donor.name,
          `ошибка отправки ${resource} → ${poorRoom.name}: ${result}`,
          { resource, to: poorRoom.name, result },
        );
      }
    }

    // [NEW v3] Публикуем статистику в Memory.empire.balancer
    // Команда balance() в console.js читает эти данные
    if (!Memory.empire) Memory.empire = {};
    Memory.empire.balancer = {
      generatedAt: Game.time,
      transferCount,
      queuedCount,
      imbalanceCount: imbalances.length,
      // Последние 10 дисбалансов для отображения в balance()
      transfers: imbalances.slice(0, 10).map(i => ({
        resource: i.resource,
        from: i.from,
        to: i.to,
        amount: i.amount,
        status: "planned",
      })),
    };

    // Итоговый лог раз в BALANCE_INTERVAL
    if (imbalances.length > 0 || debug) {
      console.log(
        `[Balancer] 📊 sent=${transferCount} queued=${queuedCount}` +
          ` imbalances=${imbalances.length}`,
      );
    }
  },
};

module.exports = resourceBalancer;
