/**
 * ===================================================
 * TERMINALMANAGER.JS — Автопродажа ресурсов
 * ===================================================
 * Запускается из roomManager каждый тик, но реально
 * работает раз в 50 тиков — каждая комната в свой тик.
 *
 * Логика продажи:
 * - Минералы: продаём всё что есть в терминале (минимум 100 единиц)
 * - Энергия: продаём излишек сверх 100,000 в Storage
 *
 * ИСПРАВЛЕНО: убран жёсткий фильтр "энергии после сделки >= TERMINAL_ENERGY_MIN"
 * Теперь единственное условие — txCost меньше чем есть энергии в терминале.
 * Если покупатель далеко и транзакция дорогая — уменьшаем объём продажи
 * до тех пор пока транзакция не станет по карману.
 *
 * Управление через консоль:
 *   Memory.tradeEnabled = false  — остановить торговлю
 *   Memory.tradeEnabled = true   — возобновить торговлю
 * ===================================================
 */

const STORAGE_ENERGY_BUFFER = 100000;
const TERMINAL_ENERGY_MIN = 2000; // минимум чтобы терминал вообще не опустел
const CHECK_INTERVAL = 50;
const MIN_DEAL_AMOUNT = 100;

let roomOffsets = {};

const terminalManager = {
  run: function (room) {
    if (Memory.tradeEnabled === false) return;

    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }

    if ((Game.time + roomOffsets[room.name]) % CHECK_INTERVAL !== 0) return;

    const terminal = room.terminal;
    const storage = room.storage;

    if (!terminal || !storage) return;
    if (terminal.cooldown > 0) return;

    // Нужна хоть какая-то энергия для транзакции
    const availableEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (availableEnergy < TERMINAL_ENERGY_MIN) return;

    // ── СОБИРАЕМ СПИСОК РЕСУРСОВ ДЛЯ ПРОДАЖИ ─────────────────────────────

    const toSell = [];

    // Минералы: всё что есть в терминале кроме энергии
    for (const resource in terminal.store) {
      if (resource === RESOURCE_ENERGY) continue;
      const amount = terminal.store[resource];
      if (amount >= MIN_DEAL_AMOUNT) {
        toSell.push({ resourceType: resource, amount });
      }
    }

    // Энергия: только излишек если Storage переполнен
    const storageEnergy = storage.store[RESOURCE_ENERGY] || 0;
    const terminalEnergy = terminal.store[RESOURCE_ENERGY] || 0;
    if (storageEnergy > STORAGE_ENERGY_BUFFER) {
      const sellAmount = terminalEnergy - TERMINAL_ENERGY_MIN;
      if (sellAmount >= MIN_DEAL_AMOUNT) {
        toSell.push({ resourceType: RESOURCE_ENERGY, amount: sellAmount });
      }
    }

    if (toSell.length === 0) return;

    // ── ПРОДАЁМ ПЕРВЫЙ РЕСУРС ИЗ СПИСКА ──────────────────────────────────
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

    // Перебираем топ-10 ордеров по цене.
    // Для каждого уменьшаем объём продажи пока транзакция не влезет в бюджет.
    for (const order of orders.slice(0, 10)) {
      let dealAmount = Math.min(amount, order.remainingAmount);

      // Уменьшаем объём пока транзакция дороже доступной энергии.
      // Минимум — MIN_DEAL_AMOUNT (100 единиц).
      while (dealAmount >= MIN_DEAL_AMOUNT) {
        const txCost = Game.market.calcTransactionCost(
          dealAmount,
          room.name,
          order.roomName,
        );

        if (txCost <= availableEnergy - TERMINAL_ENERGY_MIN) {
          // Энергии хватает — совершаем сделку
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
          return; // одна сделка за тик — выходим
        }

        // Не хватает — уменьшаем объём вдвое и пробуем снова
        dealAmount = Math.floor(dealAmount / 2);
      }
      // Этот ордер слишком дорогой даже для минимального объёма — пробуем следующий
    }

    console.log(
      `[Terminal ${room.name}] Нет подходящих ордеров для ${resourceType} (мало энергии на транзакцию)`,
    );
  },
};

module.exports = terminalManager;
