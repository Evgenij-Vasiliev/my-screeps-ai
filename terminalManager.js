/**
 * ===================================================
 * TERMINALMANAGER.JS — Автопродажа + Автологистика лаб
 * ===================================================
 * Запускается из roomManager каждый тик, но реально
 * работает раз в 50 тиков — каждая комната в свой тик.
 *
 * Логика продажи:
 * - Энергия: продаём излишек сверх 100,000 в Storage
 *
 * Логика автологистики лаб:
 * - Каждые 100 тиков проверяем запас реагентов
 * - Если реагента < LAB_REAGENT_MIN — ищем комнату с излишком
 * - Отправляем реагент через терминал автоматически
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

// Минимальный запас реагента в терминале комнаты
// Если меньше — везём из другой комнаты
const LAB_REAGENT_MIN = 3000;

// Сколько везём за один раз
const LAB_REAGENT_SEND = 5000;

// Минимальный излишек в комнате-доноре чтобы она могла отдать
const LAB_REAGENT_DONOR_MIN = 6000;

let roomOffsets = {};

const terminalManager = {
  /**
   * ── АВТОЛОГИСТИКА РЕАГЕНТОВ ──────────────────────────────────────────────
   * Запускается раз в 100 тиков для каждой комнаты.
   * Проверяет запас реагентов лаб и везёт из других комнат если мало.
   */
  runLabSupply: function (room) {
    // Проверяем только раз в 100 тиков
    if (Game.time % 100 !== 0) return;

    const config = room.memory.labs;
    if (!config) return;

    const terminal = room.terminal;
    if (!terminal) return;
    if (terminal.cooldown > 0) return;

    // Проверяем энергию для транзакции
    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    // Проверяем оба реагента
    const reagents = [
      { resource: config.reagent1 },
      { resource: config.reagent2 },
    ];

    for (const { resource } of reagents) {
      if (!resource) continue;

      // Сколько реагента есть в этой комнате (терминал + storage)
      const inTerminal = terminal.store[resource] || 0;
      const inStorage = room.storage ? room.storage.store[resource] || 0 : 0;
      const total = inTerminal + inStorage;

      // Хватает — пропускаем
      if (total >= LAB_REAGENT_MIN) continue;

      const needed = LAB_REAGENT_SEND;

      console.log(
        `[LabSupply ${room.name}] Мало ${resource}: ${total} — ищем донора`,
      );

      // Ищем комнату с излишком этого реагента
      let donorRoom = null;
      let donorAmount = 0;

      for (const roomName in Game.rooms) {
        // Не берём из самой себя
        if (roomName === room.name) continue;

        const donor = Game.rooms[roomName];
        if (!donor.controller || !donor.controller.my) continue;
        if (!donor.terminal) continue;
        if (donor.terminal.cooldown > 0) continue;

        // Считаем запас у донора
        const donorTerminal = donor.terminal.store[resource] || 0;
        const donorStorage = donor.storage
          ? donor.storage.store[resource] || 0
          : 0;
        const donorTotal = donorTerminal + donorStorage;

        // Донор должен иметь излишек сверх минимума
        if (donorTotal > LAB_REAGENT_DONOR_MIN) {
          donorRoom = donor;
          donorAmount = Math.min(needed, donorTotal - LAB_REAGENT_DONOR_MIN);
          break;
        }
      }

      if (!donorRoom) {
        console.log(
          `[LabSupply ${room.name}] Нет донора для ${resource} — нужно купить`,
        );
        continue;
      }

      // Проверяем стоимость транзакции
      const txCost = Game.market.calcTransactionCost(
        donorAmount,
        donorRoom.name,
        room.name,
      );

      const donorEnergy = donorRoom.terminal.store[RESOURCE_ENERGY] || 0;
      if (txCost > donorEnergy - TERMINAL_ENERGY_MIN) {
        console.log(
          `[LabSupply ${room.name}] У донора ${donorRoom.name} мало энергии для транзакции`,
        );
        continue;
      }

      // Отправляем реагент
      const result = donorRoom.terminal.send(resource, donorAmount, room.name);
      if (result === OK) {
        console.log(
          `[LabSupply] ✅ ${donorRoom.name} → ${room.name}: ${donorAmount} ${resource}`,
        );
      } else {
        console.log(`[LabSupply] ❌ Ошибка отправки ${resource}: ${result}`);
      }

      // Одна отправка за тик — выходим
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
    const toSell = [];

    const storageEnergy = storage.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (storageEnergy > STORAGE_ENERGY_BUFFER) {
      const sellAmount = terminalEnergy - TERMINAL_ENERGY_MIN;
      if (sellAmount >= MIN_DEAL_AMOUNT) {
        toSell.push({ resourceType: RESOURCE_ENERGY, amount: sellAmount });
      }
    }

    if (toSell.length === 0) return;

    const { resourceType, amount } = toSell[0];

    const orders = Game.market
      .getAllOrders({ resourceType })
      .filter(o => o.type === ORDER_BUY && o.remainingAmount >= MIN_DEAL_AMOUNT)
      .sort((a, b) => b.price - a.price);

    if (orders.length === 0) {
      console.log(
        `[Terminal ${room.name}] Нет покупателей для ${resourceType}`,
      );
      return;
    }

    for (const order of orders.slice(0, 10)) {
      let dealAmount = Math.min(amount, order.remainingAmount);

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
              `[Terminal ${room.name}] Продано ${dealAmount} ${resourceType} ` +
                `по ${order.price} → ${order.roomName} ` +
                `(транзакция: ${txCost} энергии)`,
            );
          } else {
            console.log(
              `[Terminal ${room.name}] Ошибка сделки ${resourceType}: ${result}`,
            );
          }
          return;
        }

        dealAmount = Math.floor(dealAmount / 2);
      }
    }

    console.log(
      `[Terminal ${room.name}] Нет подходящих ордеров для ${resourceType} (мало энергии на транзакцию)`,
    );
  },
};

module.exports = terminalManager;
