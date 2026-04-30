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
 * Условия для сделки:
 * - В терминале минимум 20,000 энергии (на транзакции)
 * - Есть buy order с ненулевым количеством
 * - Терминал не на кулдауне
 * - Количество для продажи минимум 100 единиц
 *
 * Управление через консоль:
 *   Memory.tradeEnabled = false  — остановить торговлю
 *   Memory.tradeEnabled = true   — возобновить торговлю
 * ===================================================
 */

const STORAGE_ENERGY_BUFFER = 100000;
const TERMINAL_ENERGY_MIN = 20000;
const CHECK_INTERVAL = 50;
const MIN_DEAL_AMOUNT = 100;

// Сдвиги тиков для каждой комнаты — чтобы не вызывать
// getAllOrders() для всех комнат одновременно.
// При 5 комнатах и интервале 50: офсеты 0, 10, 20, 30, 40.
let roomOffsets = {};

const terminalManager = {
  run: function (room) {
    if (Memory.tradeEnabled === false) return;

    // Назначаем каждой комнате свой сдвиг — один раз при запуске
    if (roomOffsets[room.name] === undefined) {
      const count = Object.keys(roomOffsets).length;
      const step = Math.floor(CHECK_INTERVAL / 5);
      roomOffsets[room.name] = count * step;
    }

    // Проверяем только в "свой" тик — не все комнаты одновременно
    if ((Game.time + roomOffsets[room.name]) % CHECK_INTERVAL !== 0) return;

    const terminal = room.terminal;
    const storage = room.storage;

    if (!terminal || !storage) return;
    if (terminal.cooldown > 0) return;
    if (terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN) return;

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

    // Энергия: только излишек из терминала если Storage переполнен
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
    // За один тик терминал совершает только одну сделку.
    // Следующий ресурс продастся через 50 тиков.

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

    // Топ-5 по цене — выбираем тех у кого хватает энергии на транзакцию
    const candidates = orders
      .slice(0, 5)
      .map(order => {
        const dealAmount = Math.min(amount, order.remainingAmount);
        const txCost = Game.market.calcTransactionCost(
          dealAmount,
          room.name,
          order.roomName,
        );
        const energyAfter = terminal.store[RESOURCE_ENERGY] - txCost;
        return { order, dealAmount, txCost, energyAfter };
      })
      .filter(c => c.energyAfter >= TERMINAL_ENERGY_MIN);

    if (candidates.length === 0) {
      console.log(
        `[Terminal ${room.name}] Недостаточно энергии для транзакции ${resourceType}`,
      );
      return;
    }

    const best = candidates[0];
    const result = Game.market.deal(best.order.id, best.dealAmount, room.name);

    if (result === OK) {
      console.log(
        `[Terminal ${room.name}] Продано ${best.dealAmount} ${resourceType} ` +
          `по ${best.order.price} → ${best.order.roomName} ` +
          `(транзакция: ${best.txCost} энергии)`,
      );
    } else {
      console.log(
        `[Terminal ${room.name}] Ошибка сделки ${resourceType}: ${result}`,
      );
    }
  },
};

module.exports = terminalManager;
