/**
 * ===================================================
 * TERMINALMANAGER.JS — Автопродажа + Полная логистика лаб
 * ===================================================
 * Запускается из roomManager каждый тик, но реально
 * работает раз в 50 тиков — каждая комната в свой тик.
 *
 * ЛОГИСТИКА РЕАГЕНТОВ (раз в 100 тиков):
 * Перебирает ВСЕ тройки лаб (labs, labs2, labs3...)
 * в каждой комнате и проверяет запас реагентов.
 *
 * Полная цепочка доставки:
 *   storage донора → терминал донора → терминал получателя
 *   → (terminalUnloader несёт в storage) → labWorker несёт в лабу
 *
 * ИСПРАВЛЕНО v3:
 * - terminalNeed заменён на terminalNeeds (массив запросов)
 * - Несколько комнат могут одновременно просить разные ресурсы
 *   у одного донора — запросы не перезаписывают друг друга
 * - terminalUnloader обрабатывает очередь по одному запросу за раз
 *
 * Структура terminalNeeds в памяти комнаты-донора:
 *   room.memory.terminalNeeds = [
 *     { resource: 'O',  amount: 5000, toRoom: 'E37S38' },
 *     { resource: 'OH', amount: 5000, toRoom: 'E36S38' },
 *   ]
 *
 * ПРОДАЖА ЭНЕРГИИ:
 * Продаём излишек энергии сверх STORAGE_ENERGY_BUFFER.
 *
 * Управление через консоль:
 *   Memory.tradeEnabled = false  — остановить торговлю
 *   Memory.tradeEnabled = true   — возобновить торговлю
 * ===================================================
 */

const STORAGE_ENERGY_BUFFER = 50000;
const TERMINAL_ENERGY_MIN = 20000;
const CHECK_INTERVAL = 50;
const MIN_DEAL_AMOUNT = 100;

// Минимальный запас реагента в комнате-получателе
const LAB_REAGENT_MIN = 3000;

// Сколько везём за один раз
const LAB_REAGENT_SEND = 5000;

// Минимальный излишек у донора чтобы он мог отдать
const LAB_REAGENT_DONOR_MIN = 6000;

let roomOffsets = {};

const terminalManager = {
  /**
   * Возвращает список всех активных конфигов лаб в комнате.
   */
  getLabConfigs: function (room) {
    const mem = room.memory;
    const configs = [];
    if (mem.labs) configs.push({ key: "labs", config: mem.labs });
    if (mem.labs2) configs.push({ key: "labs2", config: mem.labs2 });
    if (mem.labs3) configs.push({ key: "labs3", config: mem.labs3 });
    if (mem.labs4) configs.push({ key: "labs4", config: mem.labs4 });
    if (mem.labs5) configs.push({ key: "labs5", config: mem.labs5 });
    return configs;
  },

  /**
   * Считает суммарный запас ресурса в комнате (терминал + storage).
   */
  getTotal: function (room, resource) {
    const t = room.terminal ? room.terminal.store[resource] || 0 : 0;
    const s = room.storage ? room.storage.store[resource] || 0 : 0;
    return t + s;
  },

  /**
   * Добавляет запрос в очередь terminalNeeds донора.
   * Не дублирует если запрос на этот ресурс уже есть.
   */
  addNeed: function (donorRoom, resource, amount, toRoom) {
    if (!donorRoom.memory.terminalNeeds) {
      donorRoom.memory.terminalNeeds = [];
    }
    const needs = donorRoom.memory.terminalNeeds;

    // Проверяем дубль — уже есть запрос на этот ресурс в эту комнату
    const exists = needs.find(
      n => n.resource === resource && n.toRoom === toRoom,
    );
    if (exists) {
      // Обновляем amount если изменился
      exists.amount = amount;
      return false; // не новый запрос
    }

    needs.push({ resource, amount, toRoom });
    return true; // новый запрос
  },

  /**
   * ── АВТОЛОГИСТИКА РЕАГЕНТОВ ──────────────────────────────────────────────
   * Раз в 100 тиков проверяет ВСЕ тройки лаб в комнате.
   * Если реагента мало — ищет донора и организует доставку.
   */
  runLabSupply: function (room) {
    if (Game.time % 100 !== 0) return;

    const terminal = room.terminal;
    if (!terminal) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    // Перебираем ВСЕ тройки лаб в этой комнате
    const labConfigs = this.getLabConfigs(room);
    if (labConfigs.length === 0) return;

    // Собираем все нужные реагенты по всем тройкам
    const needs = [];
    for (const { config } of labConfigs) {
      for (const resource of [config.reagent1, config.reagent2]) {
        if (!resource) continue;
        const total = this.getTotal(room, resource);
        if (total < LAB_REAGENT_MIN) {
          if (!needs.find(n => n.resource === resource)) {
            needs.push({ resource, total });
          }
        }
      }
    }

    if (needs.length === 0) return;

    for (const { resource, total } of needs) {
      console.log(
        `[LabSupply ${room.name}] Мало ${resource}: ${total} — ищем донора`,
      );

      // Ищем донора
      let donorRoom = null;
      let donorAmount = 0;

      for (const roomName in Game.rooms) {
        if (roomName === room.name) continue;

        const donor = Game.rooms[roomName];
        if (!donor.controller || !donor.controller.my) continue;
        if (!donor.terminal) continue;

        const donorTotal = this.getTotal(donor, resource);
        if (donorTotal > LAB_REAGENT_DONOR_MIN) {
          donorRoom = donor;
          donorAmount = Math.min(
            LAB_REAGENT_SEND,
            donorTotal - LAB_REAGENT_DONOR_MIN,
          );
          break;
        }
      }

      if (!donorRoom) {
        console.log(
          `[LabSupply ${room.name}] Нет донора для ${resource} — нужно купить`,
        );
        continue;
      }

      const donorInTerminal = donorRoom.terminal.store[resource] || 0;

      // Если ресурса нет в терминале донора — добавляем в очередь переноса
      if (donorInTerminal < donorAmount) {
        const isNew = this.addNeed(donorRoom, resource, donorAmount, room.name);
        if (isNew) {
          console.log(
            `[LabSupply] 📦 ${donorRoom.name}: добавлен запрос ` +
              `${donorAmount} ${resource} → ${room.name}`,
          );
        } else {
          console.log(
            `[LabSupply] ⏳ ${donorRoom.name}: ждём переноса ${resource} ` +
              `в терминал (есть: ${donorInTerminal})`,
          );
        }
        continue;
      }

      // Ресурс в терминале донора — отправляем
      if (donorRoom.terminal.cooldown > 0) {
        console.log(`[LabSupply] ⏳ ${donorRoom.name}: терминал на кулдауне`);
        continue;
      }

      const txCost = Game.market.calcTransactionCost(
        donorAmount,
        donorRoom.name,
        room.name,
      );
      const donorEnergy = donorRoom.terminal.store[RESOURCE_ENERGY] || 0;

      if (txCost > donorEnergy - TERMINAL_ENERGY_MIN) {
        console.log(
          `[LabSupply] ⚡ ${donorRoom.name}: мало энергии для транзакции ` +
            `(нужно: ${txCost}, есть: ${donorEnergy})`,
        );
        continue;
      }

      const result = donorRoom.terminal.send(resource, donorAmount, room.name);
      if (result === OK) {
        // Убираем выполненный запрос из очереди донора
        if (donorRoom.memory.terminalNeeds) {
          donorRoom.memory.terminalNeeds =
            donorRoom.memory.terminalNeeds.filter(
              n => !(n.resource === resource && n.toRoom === room.name),
            );
        }
        console.log(
          `[LabSupply] ✅ ${donorRoom.name} → ${room.name}: ${donorAmount} ${resource}`,
        );
      } else {
        console.log(`[LabSupply] ❌ Ошибка отправки ${resource}: ${result}`);
      }

      // Одна отправка за тик
      return;
    }
  },

  /**
   * ── ОСНОВНОЙ ЗАПУСК ───────────────────────────────────────────────────────
   */
  run: function (room) {
    if (Memory.tradeEnabled === false) return;

    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }

    // ── АВТОЛОГИСТИКА ЛАБ ─────────────────────────────────────────────────
    this.runLabSupply(room);

    if ((Game.time + roomOffsets[room.name]) % CHECK_INTERVAL !== 0) return;

    const terminal = room.terminal;
    const storage = room.storage;

    if (!terminal || !storage) return;
    if (terminal.cooldown > 0) return;

    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    // ── ПРОДАЖА ЭНЕРГИИ ───────────────────────────────────────────────────
    const storageEnergy = storage.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;

    if (storageEnergy <= STORAGE_ENERGY_BUFFER) return;

    const sellAmount = terminalEnergy - TERMINAL_ENERGY_MIN;
    if (sellAmount < MIN_DEAL_AMOUNT) return;

    const orders = Game.market
      .getAllOrders({ resourceType: RESOURCE_ENERGY })
      .filter(o => o.type === ORDER_BUY && o.remainingAmount >= MIN_DEAL_AMOUNT)
      .sort((a, b) => b.price - a.price);

    if (orders.length === 0) {
      console.log(`[Terminal ${room.name}] Нет покупателей для energy`);
      return;
    }

    for (const order of orders.slice(0, 10)) {
      let dealAmount = Math.min(sellAmount, order.remainingAmount);

      while (dealAmount >= MIN_DEAL_AMOUNT) {
        const txCost = Game.market.calcTransactionCost(
          dealAmount,
          room.name,
          order.roomName,
        );

        if (txCost <= availableEnergy - TERMINAL_ENERGY_MIN) {
          const result = Game.market.deal(order.id, dealAmount, room.name);
          if (result === OK) {
            console.log(
              `[Terminal ${room.name}] Продано ${dealAmount} energy ` +
                `по ${order.price} → ${order.roomName} ` +
                `(транзакция: ${txCost} энергии)`,
            );
          } else {
            console.log(
              `[Terminal ${room.name}] Ошибка сделки energy: ${result}`,
            );
          }
          return;
        }

        dealAmount = Math.floor(dealAmount / 2);
      }
    }

    console.log(
      `[Terminal ${room.name}] Нет подходящих ордеров (мало энергии на транзакцию)`,
    );
  },
};

module.exports = terminalManager;
