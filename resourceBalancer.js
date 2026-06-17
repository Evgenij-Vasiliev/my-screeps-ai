/**
 * ===================================================
 * RESOURCEBALANCER.JS — Глобальный балансировщик ресурсов
 * ===================================================
 * VERSION: 1.0 (новая архитектура)
 *
 * Запускается из terminal.manager.run() один раз за тик
 * (только из первой комнаты по алфавиту).
 *
 * Работает раз в BALANCE_INTERVAL тиков.
 *
 * Логика:
 * 1. Собирает запасы всех ресурсов во всех наших комнатах
 * 2. Для каждого ресурса находит "богатых" (излишек) и "бедных" (дефицит)
 * 3. Богатый отправляет бедному через терминал (или ставит запрос в очередь)
 * 4. На стороне получателя — автоматически ставит задачу разгрузить
 *    терминал в storage через terminalIncoming
 *
 * АВТОМАТИЧЕСКАЯ РАЗГРУЗКА НА СТОРОНЕ ПОЛУЧАТЕЛЯ:
 * - При отправке ресурса записывает ожидание в Memory.rooms[toRoom].terminalIncoming
 * - terminal.manager проверяет терминал получателя каждый тик
 * - Когда ресурс появился — ставит задачу unloader'у через terminalNeeds (toRoom=null)
 * - Работает и для ручных переброссок через C.Terminal.move()
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

// Минимальный резерв в комнате (storage + terminal суммарно)
const RESERVE_MIN = {
  energy: 50000,
  battery: 10000,
  O: 3000,
  H: 3000,
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

// Порог дефицита — ниже этого комната считается бедной
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

// Сколько отправляем за один раз
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
  // ── УТИЛИТЫ ────────────────────────────────────────────────────────────

  // Суммарный запас ресурса в комнате (storage + terminal)
  getTotal: function (room, resource) {
    const s = room.storage ? room.storage.store[resource] || 0 : 0;
    const t = room.terminal ? room.terminal.store[resource] || 0 : 0;
    return s + t;
  },

  // Добавить задачу unloader'у: перенести resource из storage в terminal
  addNeed: function (room, resource, amount, toRoom) {
    if (!room.memory.terminalNeeds) room.memory.terminalNeeds = [];
    const needs = room.memory.terminalNeeds;
    const existing = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );
    if (existing) {
      existing.amount = amount;
      return false; // обновили существующую
    }
    needs.push({ resource, amount, toRoom });
    return true; // новая задача
  },

  // ── АВТОМАТИЧЕСКАЯ РАЗГРУЗКА НА СТОРОНЕ ПОЛУЧАТЕЛЯ ────────────────────

  /**
   * Зарегистрировать ожидаемый входящий груз в комнате-получателе.
   * Вызывается при отправке (send) или постановке задачи (addNeed).
   * terminal.manager проверяет incoming каждый тик и ставит задачу unloader'у.
   */
  registerIncoming: function (toRoomName, resource, amount) {
    if (!Memory.rooms) Memory.rooms = {};
    if (!Memory.rooms[toRoomName]) Memory.rooms[toRoomName] = {};
    if (!Memory.rooms[toRoomName].terminalIncoming) {
      Memory.rooms[toRoomName].terminalIncoming = [];
    }
    const incoming = Memory.rooms[toRoomName].terminalIncoming;
    const existing = incoming.find(i => i.resource === resource);
    if (existing) {
      existing.amount = Math.max(existing.amount, amount);
      return;
    }
    incoming.push({ resource, amount, registeredAt: Game.time });
  },

  /**
   * Проверить терминалы всех комнат на наличие ожидаемых грузов.
   * Если груз пришёл — поставить задачу unloader'у разгрузить в storage.
   * Вызывается каждый тик из terminal.manager.
   */
  processIncoming: function (room) {
    if (!room.terminal || !room.storage) return;
    const incoming = room.memory.terminalIncoming;
    if (!incoming || incoming.length === 0) return;

    const stillWaiting = [];

    for (const entry of incoming) {
      const inTerminal = room.terminal.store[entry.resource] || 0;

      if (inTerminal <= 0) {
        // Груз ещё не пришёл — ждём, но не вечно (макс 500 тиков)
        if (Game.time - entry.registeredAt < 500) {
          stillWaiting.push(entry);
        } else {
          console.log(
            `[Balancer] ⏱ ${room.name}: входящий ${entry.resource} не пришёл за 500 тиков, отменяем`,
          );
        }
        continue;
      }

      // Груз в терминале — ставим задачу unloader'у разгрузить в storage
      // toRoom = null означает "переложить в свой storage"
      this.addNeed(room, entry.resource, inTerminal, null);

      Logger.event(
        "incoming_received",
        room.name,
        `получен ${entry.resource} x${inTerminal}, разгружаем в storage`,
        { resource: entry.resource, amount: inTerminal },
      );
    }

    room.memory.terminalIncoming = stillWaiting;
  },

  // ── ОСНОВНОЙ ЦИКЛ ──────────────────────────────────────────────────────

  run: function () {
    if (Memory.balancerEnabled === false) return;
    if (Game.time % BALANCE_INTERVAL !== 0) return;

    const debug = Memory.balancerDebug === true;

    const ourRooms = Object.values(Game.rooms).filter(
      r => r.controller && r.controller.my && r.terminal && r.storage,
    );

    if (ourRooms.length < 2) return;

    // Собираем все ресурсы которые есть хоть в одной комнате
    const allResources = new Set([RESOURCE_ENERGY]);
    for (const room of ourRooms) {
      for (const res of Object.keys(room.storage.store)) allResources.add(res);
      for (const res of Object.keys(room.terminal.store)) allResources.add(res);
    }

    // Каждый донор делает максимум ОДИН запрос/отправку за запуск
    const busyDonors = new Set();

    // Статистика
    let transferCount = 0;
    let queuedCount = 0;
    const imbalances = [];

    for (const resource of allResources) {
      const reserveMin = RESERVE_MIN[resource] || 5000;
      const deficitThresh = DEFICIT_THRESHOLD[resource] || 2000;
      const sendAmount = SEND_AMOUNT[resource] || 3000;

      // Бедные комнаты
      const poorRooms = ourRooms.filter(
        r => this.getTotal(r, resource) < deficitThresh,
      );
      if (poorRooms.length === 0) continue;

      // Богатые комнаты (не заняты в этом запуске)
      const richRooms = ourRooms.filter(
        r =>
          this.getTotal(r, resource) > reserveMin + sendAmount &&
          r.terminal.cooldown === 0 &&
          !busyDonors.has(r.name),
      );

      if (richRooms.length === 0) {
        if (debug)
          console.log(
            `[Balancer] ${resource}: бедных ${poorRooms.length}, нет доноров`,
          );
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

      imbalances.push({
        resource,
        from: donor.name,
        to: poorRoom.name,
        amount: actualSend,
      });

      Logger.event(
        "resource_imbalance",
        donor.name,
        `${resource}: ${donor.name}→${poorRoom.name} (~${actualSend})`,
        { resource, from: donor.name, to: poorRoom.name, amount: actualSend },
      );

      const inTerminal = donor.terminal.store[resource] || 0;

      if (inTerminal < actualSend) {
        // Ресурс в storage — просим unloader перенести в терминал
        const isNew = this.addNeed(donor, resource, actualSend, poorRoom.name);
        if (isNew || debug) {
          console.log(
            `[Balancer] 📦 ${donor.name}: перенести ${actualSend} ${resource} → ${poorRoom.name}`,
          );
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
        // Регистрируем ожидание на стороне получателя
        this.registerIncoming(poorRoom.name, resource, actualSend);
        busyDonors.add(donor.name);
        queuedCount++;
        continue;
      }

      // Ресурс уже в терминале — проверяем энергию на транзакцию
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
        Logger.event(
          "transfer_completed",
          donor.name,
          `sent ${actualSend} ${resource} → ${poorRoom.name}`,
          { resource, to: poorRoom.name, amount: actualSend },
        );
        // Регистрируем ожидание на стороне получателя
        this.registerIncoming(poorRoom.name, resource, actualSend);
        // Чистим очередь донора если была
        if (donor.memory.terminalNeeds) {
          donor.memory.terminalNeeds = donor.memory.terminalNeeds.filter(
            n => !(n.resource === resource && n.toRoom === poorRoom.name),
          );
        }
        busyDonors.add(donor.name);
        transferCount++;
      } else {
        console.log(`[Balancer] ❌ Ошибка отправки ${resource}: ${result}`);
        Logger.event(
          "terminal_send_failed",
          donor.name,
          `ошибка отправки ${resource} → ${poorRoom.name}: ${result}`,
          { resource, to: poorRoom.name, result },
        );
      }
    }

    // Публикуем статистику
    if (!Memory.empire) Memory.empire = {};
    Memory.empire.balancer = {
      generatedAt: Game.time,
      transferCount,
      queuedCount,
      imbalanceCount: imbalances.length,
      transfers: imbalances.slice(0, 10).map(i => ({
        resource: i.resource,
        from: i.from,
        to: i.to,
        amount: i.amount,
        status: "planned",
      })),
    };

    if (imbalances.length > 0 || debug) {
      console.log(
        `[Balancer] 📊 sent=${transferCount} queued=${queuedCount} imbalances=${imbalances.length}`,
      );
    }
  },
};

module.exports = resourceBalancer;
