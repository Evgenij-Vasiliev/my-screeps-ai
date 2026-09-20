/**
 * ===================================================
 * MARKET.MANAGER.JS — Менеджер рынка
 * ===================================================
 * Задача 16 «Экономика»: раньше списки MARKET.* были пусты, рынок не работал,
 * и излишки империи копились в терминалах (на shard3 — до 98k power в каждом
 * при вместимости 300k): терминал переполнялся и блокировал и terminalNetwork,
 * и подвоз ресурсов из storage. Теперь менеджер продаёт излишки, но с
 * ограничителями, чтобы «выход излишкам» не стал разбазариванием:
 *   - SELL_RESERVE            — ниже резерва ресурс из терминала не отдаётся;
 *   - MIN_SELL_PRICE_RATIO / MAX_BUY_PRICE_RATIO — не торгуем по «мусорной»
 *     цене, когда встречная заявка заметно лучше;
 *   - MIN_DEAL_MARGIN_RATIO   — комиссия сделки оплачивается энергией, поэтому
 *     сделка принимается, только если после комиссии остаётся доля выручки
 *     (покупатель в дальнем секторе иначе «съедает» всю сумму);
 *   - MAX_DEALS_PER_TICK / MIN_DEAL_AMOUNT / MAX_DEAL_AMOUNT — лимиты объёма;
 *   - CHECK_INTERVAL          — getAllOrders вызывается раз в N тиков;
 *   - защита от продажи того, что империя сама расходует: power и реагенты
 *     активных реакций (Memory.rooms[*].labs*) не продаются, даже если окажутся
 *     в SELL_RESOURCES (см. collectProtectedResources).
 *
 * Оптимизация CPU: на каждый ресурс книга заявок читается ОДИН раз за запуск
 * (`getAllOrders({resourceType})` возвращает и buy, и sell) и переиспользуется
 * всеми терминалами комнат; ресурсы без излишка не опрашиваются вовсе.
 * ===================================================
 */

const { MARKET, STORAGE } = require("./constants");
const labWorker = require("./lab.worker");

// Кэши одного запуска: книга заявок по ресурсам (чтобы `getAllOrders` для
// одного ресурса вызывался один раз), цена энергии (комиссия платится
// энергией) и журнал предупреждений, чтобы не спамить консоль каждый тик.
let bookCache = null;
let energyPriceCache = null;
let logged = null;

// Ресурсы, которые империя расходует сама (power + реагенты активных реакций)
// и потому не имеет права продавать. Считается лениво один раз за запуск.
let protectedCache = null;

/**
 * Книга заявок ресурса, прочитанная один раз за запуск.
 * @param {string} resourceType
 * @returns {Object[]}
 */
function getOrders(resourceType) {
  if (!bookCache[resourceType]) {
    bookCache[resourceType] =
      Game.market.getAllOrders({
        // Типы Screeps: строка из конфига → MarketResourceConstant.
        resourceType: /** @type {MarketResourceConstant} */ (resourceType),
      }) || [];
  }
  return bookCache[resourceType];
}

/**
 * Цена энергии, которой оплачивается комиссия сделки — «упущенная выгода»
 * от того, что комиссию нельзя продать как ресурс. Читается один раз за
 * запуск (лучший бид по энергии) и переиспользуется всеми сделками.
 * @returns {number}
 */
function energyPrice() {
  if (energyPriceCache === null) {
    const bid = bestBuyOrder(getOrders(RESOURCE_ENERGY));
    energyPriceCache = bid ? bid.price : 0;
  }
  return energyPriceCache;
}

/**
 * Возвращает терминалы всех собственных комнат.
 */
function getEmpireTerminals() {
  const terminals = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (!room.terminal) continue;
    terminals.push(room.terminal);
  }
  return terminals;
}

/**
 * Заявка с самой высокой ценой покупки.
 * @param {Object[]} orders
 * @returns {Object|null}
 */
function bestBuyOrder(orders) {
  let best = null;
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    if (order.type !== ORDER_BUY) continue;
    if (!best || order.price > best.price) best = order;
  }
  return best;
}

/**
 * Заявка с самой низкой ценой продажи.
 * @param {Object[]} orders
 * @returns {Object|null}
 */
function bestSellOrder(orders) {
  let best = null;
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    if (order.type !== ORDER_SELL) continue;
    if (!best || order.price < best.price) best = order;
  }
  return best;
}

/**
 * Кандидаты на продажу: заявки покупки с наибольшей ценой (не более limit).
 * Дорогая заявка может быть в дальнем секторе, где комиссия съедает выручку,
 * поэтому кандидатов несколько и выбор делает pickSellOrder.
 * @param {Object[]} orders
 * @param {number} limit
 * @returns {Object[]}
 */
function buyCandidates(orders, limit) {
  const buys = [];
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    if (order.type !== ORDER_BUY) continue;
    if (order.remainingAmount < MARKET.MIN_DEAL_AMOUNT) continue;
    buys.push(order);
  }
  buys.sort((a, b) => b.price - a.price);
  return buys.slice(0, limit);
}

/**
 * Сколько ресурса терминал может отдать: запас выше резерва, но не больше
 * MAX_DEAL_AMOUNT (защита от одного «жирного» ордера).
 * @param {Object} terminal
 * @param {string} resourceType
 * @returns {number}
 */
function sellableFrom(terminal, resourceType) {
  const reserve = MARKET.SELL_RESERVE[resourceType] || 0;
  let amount = (terminal.store[resourceType] || 0) - reserve;
  if (amount <= 0) return 0;

  const override = MARKET.MAX_DEAL_AMOUNT[resourceType];
  const maxDeal =
    override === undefined ? MARKET.MAX_DEAL_AMOUNT_DEFAULT : override;
  if (maxDeal > 0) amount = Math.min(amount, maxDeal);
  return amount;
}

/**
 * Имеет ли право комната продавать излишки. Продажа — только из комнаты с
 * реальным излишком: энергия в storage выше резерва (STORAGE.ENERGY_MIN).
 * Это жёсткий предохранитель «рынок не может уложить комнату»: пока storage
 * на резерве, экспорт из неё запрещён. Инцидент 18.09.2026 (E35S37):
 * комиссии продаж (power/battery платятся энергией терминала) проели энергию
 * терминала до 90 865 при резерве 100 000, а storage держался у самого порога.
 * @param {StructureTerminal} terminal
 * @returns {boolean}
 */
function roomMaySell(terminal) {
  const room = terminal.room;
  const storage = room ? room.storage : null;
  if (!storage) return false;
  return storage.store[RESOURCE_ENERGY] > STORAGE.ENERGY_MIN;
}

/**
 * Выбирает заявку покупки для продажи: из MAX_ORDER_CANDIDATES самых дорогих
 * заявок берём первую, у которой после комиссии остаётся нужная доля выручки
 * (MIN_DEAL_MARGIN_RATIO). Комиссия считается в энергии по её рыночной цене.
 * @param {number} amount
 * @param {string} roomName
 * @param {Object[]} orders
 * @returns {Object|null}
 */
function pickSellOrder(amount, roomName, orders) {
  const candidates = buyCandidates(orders, MARKET.MAX_ORDER_CANDIDATES);
  const feePrice = energyPrice();

  for (let i = 0; i < candidates.length; i++) {
    const order = candidates[i];
    const dealAmount = Math.min(amount, order.remainingAmount);
    if (dealAmount < MARKET.MIN_DEAL_AMOUNT) continue;

    const txCost = Game.market.calcTransactionCost(
      dealAmount,
      roomName,
      order.roomName,
    );
    const gross = dealAmount * order.price;
    // Если бида по энергии нет, оцениваем комиссию по цене самого ресурса.
    const feeCost = txCost * (feePrice > 0 ? feePrice : order.price);

    if (gross - feeCost >= gross * MARKET.MIN_DEAL_MARGIN_RATIO) return order;
  }

  return null;
}

/**
 * Ресурсы, которые империя расходует сама и потому НЕ имеет права продавать,
 * даже если в терминале формально «излишек»:
 *   - power — катализатор PowerSpawn/GPL;
 *   - реагенты активных реакций — берутся из Memory.rooms[*].labs* через
 *     labWorker.getConfigs, поэтому смена реакции автоматически защищает свои
 *     ингредиенты (X, O, H, OH, K, L, U, Z и промежуточные соединения).
 * Продажа реагента морит голодом тройки лаб: терминал — единственный буфер,
 * из которого lab.worker добирает ингредиенты.
 * @returns {Object<string, boolean>}
 */
function collectProtectedResources() {
  /** @type {Object<string, boolean>} */
  const protectedResources = {};
  protectedResources[RESOURCE_POWER] = true;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (!room.memory) continue;

    for (const { config } of labWorker.getConfigs(room)) {
      if (config.reagent1) protectedResources[config.reagent1] = true;
      if (config.reagent2) protectedResources[config.reagent2] = true;
    }
  }

  return protectedResources;
}

/**
 * Защищён ли ресурс от продажи (power или реагент активной реакции).
 * Набор считается лениво и переиспользуется в пределах запуска.
 * @param {string} resourceType
 * @returns {boolean}
 */
function isProtectedResource(resourceType) {
  if (!protectedCache) protectedCache = collectProtectedResources();
  return protectedCache[resourceType] === true;
}

/**
 * Продаёт излишек одного ресурса из терминалов империи (по одной сделке на
 * терминал, пока не исчерпан лимит сделок на тик).
 * @param {string} resourceType
 * @param {Object[]} terminals
 * @param {number} dealBudget остаток лимита сделок на этот тик
 * @returns {number} число успешных сделок
 */
function sellSurplus(resourceType, terminals, dealBudget) {
  // Реагенты реакций и power не продаём никогда: это не «излишек», а рабочее
  // сырьё лаб / катализатор GPL. Отсечка до чтения книги заявок.
  if (isProtectedResource(resourceType)) return 0;

  // Дешёвая отсечка: если отдавать нечего, книгу заявок даже не читаем.
  let totalSellable = 0;
  for (let i = 0; i < terminals.length; i++) {
    if (terminals[i].cooldown > 0) continue;
    if (!roomMaySell(terminals[i])) continue;
    totalSellable += sellableFrom(terminals[i], resourceType);
  }
  if (totalSellable < MARKET.MIN_DEAL_AMOUNT) return 0;

  const orders = getOrders(resourceType);
  if (!orders || orders.length === 0) return 0;

  const bid = bestBuyOrder(orders);
  if (!bid) return 0;

  // MIN_SELL_PRICE_RATIO: не отдаём излишек в бид, который сильно ниже того,
  // что за этот ресурс просят другие (лучшая встречная заявка).
  const ask = bestSellOrder(orders);
  if (ask && bid.price < ask.price * MARKET.MIN_SELL_PRICE_RATIO) return 0;

  let deals = 0;
  for (let i = 0; i < terminals.length; i++) {
    if (deals >= dealBudget) break;
    const terminal = terminals[i];
    if (terminal.cooldown > 0) continue;
    if (!roomMaySell(terminal)) continue;

    const amount = sellableFrom(terminal, resourceType);
    if (amount < MARKET.MIN_DEAL_AMOUNT) continue;

    const order = pickSellOrder(amount, terminal.room.name, orders);
    if (!order) continue;

    const dealAmount = Math.min(amount, order.remainingAmount);
    if (dealAmount < MARKET.MIN_DEAL_AMOUNT) continue;

    const txCost = Game.market.calcTransactionCost(
      dealAmount,
      terminal.room.name,
      order.roomName,
    );
    const energy = terminal.store[RESOURCE_ENERGY] || 0;
    // Комиссия платится энергией терминала. Требуем не только саму комиссию,
    // но и неприкосновенный резерв энергии терминала (SELL_RESERVE.energy —
    // он же фонд комиссий и Terminal.send). Иначе продажа power/battery
    // «проедала» резерв: в E35S37 осталось 90 865 при резерве 100 000, и
    // комнате нечем было долить спавны из терминала при пустом storage.
    const energyFloor = txCost + (MARKET.SELL_RESERVE.energy || 0);
    // if (energy < energyFloor) {
    //   warnOnce(
    //     `[Market] ⚡ ${terminal.room.name}: мало энергии на комиссию продажи ` +
    //       `${resourceType} (нужно ${txCost} + резерв ${MARKET.SELL_RESERVE.energy}, есть ${energy})`,
    //   );
    //   continue;
    // }

    const result = Game.market.deal(order.id, dealAmount, terminal.room.name);
    if (result !== OK) {
      console.log(
        `[Market] ❌ ${terminal.room.name}: продажа ${dealAmount} ${resourceType} — ошибка ${result}`,
      );
      continue;
    }

    console.log(
      `[Market] ✅ ${terminal.room.name}: продано ${dealAmount} ${resourceType} ` +
        `по ${order.price} → ${Math.floor(
          dealAmount * order.price,
        )} кредитов ` +
        `(комиссия ${txCost} энергии, ${order.roomName})`,
    );
    // Локально уменьшаем остаток заявки: следующий терминал увидит актуальный
    // объём и не попытается продать больше, чем в заявке.
    order.remainingAmount -= dealAmount;
    deals++;
  }

  return deals;
}

/**
 * Покупает ресурс из лучшей заявки продажи в терминал комнаты.
 * @param {string} resourceType
 * @param {Object[]} terminals
 * @param {number} dealBudget
 * @returns {number} число успешных сделок
 */
function buyResource(resourceType, terminals, dealBudget) {
  const orders = getOrders(resourceType);
  if (!orders || orders.length === 0) return 0;

  const ask = bestSellOrder(orders);
  if (!ask) return 0;

  // MAX_BUY_PRICE_RATIO: не покупаем дороже, чем лучшая заявка покупки ×
  // коэффициент. Если покупок нет вовсе, сравнивать не с чем — цена свободная.
  const bid = bestBuyOrder(orders);
  if (bid && ask.price > bid.price * MARKET.MAX_BUY_PRICE_RATIO) return 0;

  let deals = 0;
  for (let i = 0; i < terminals.length; i++) {
    if (deals >= dealBudget) break;
    const terminal = terminals[i];
    if (terminal.cooldown > 0) continue;

    const override = MARKET.MAX_DEAL_AMOUNT[resourceType];
    const maxDeal =
      override === undefined ? MARKET.MAX_DEAL_AMOUNT_DEFAULT : override;
    let amount = ask.remainingAmount;
    if (maxDeal > 0) amount = Math.min(amount, maxDeal);
    amount = Math.min(amount, terminal.store.getFreeCapacity());
    if (amount < MARKET.MIN_DEAL_AMOUNT) continue;

    const txCost = Game.market.calcTransactionCost(
      amount,
      terminal.room.name,
      ask.roomName,
    );
    // Комиссия покупки тоже платится энергией терминала — держим её резерв
    // нетронутым (см. sellSurplus), чтобы покупка не «проела» комнату.
    const buyEnergyFloor = txCost + (MARKET.SELL_RESERVE.energy || 0);
    if ((terminal.store[RESOURCE_ENERGY] || 0) < buyEnergyFloor) continue;

    const result = Game.market.deal(ask.id, amount, terminal.room.name);
    if (result !== OK) {
      console.log(
        `[Market] ❌ ${terminal.room.name}: закупка ${amount} ${resourceType} — ошибка ${result}`,
      );
      continue;
    }

    console.log(
      `[Market] ✅ ${terminal.room.name}: куплено ${amount} ${resourceType} ` +
        `по ${ask.price} → ${Math.floor(amount * ask.price)} кредитов ` +
        `(комиссия ${txCost} энергии, ${ask.roomName})`,
    );
    ask.remainingAmount -= amount;
    deals++;
  }

  return deals;
}

/**
 * Одно предупреждение на ключ за запуск — защита консоли от спама
 * (энергии под комиссию может не хватать каждый тик).
 * @param {string} message
 */
function warnOnce(message) {
  if (logged[message]) return;
  logged[message] = true;
  console.log(message);
}

/**
 * Точка входа. Вызывается один раз за тик из empire.js.
 */
function run() {
  if (!Game.market) return;

  // Гейт по частоте: книга заявок меняется медленно, а getAllOrders — самая
  // дорогая операция менеджера, поэтому в остальные тики он бесплатен.
  if (MARKET.CHECK_INTERVAL > 1 && Game.time % MARKET.CHECK_INTERVAL !== 0) {
    return;
  }

  const terminals = getEmpireTerminals();
  if (terminals.length === 0) return;

  // Сброс кэшей запуска: книга заявок, цена энергии и журнал предупреждений.
  bookCache = {};
  energyPriceCache = null;
  logged = {};
  protectedCache = null;

  let deals = 0;
  const sell = MARKET.SELL_RESOURCES;
  // Round-robin: каждое срабатывание список начинается со следующего ресурса,
  // иначе первый в списке всегда выбирал бы весь лимит сделок.
  const start =
    sell.length > 0
      ? Math.floor(Game.time / MARKET.CHECK_INTERVAL) % sell.length
      : 0;

  for (let i = 0; i < sell.length; i++) {
    if (deals >= MARKET.MAX_DEALS_PER_TICK) break;
    const resourceType = sell[(start + i) % sell.length];
    deals += sellSurplus(
      resourceType,
      terminals,
      MARKET.MAX_DEALS_PER_TICK - deals,
    );
  }

  for (let i = 0; i < MARKET.BUY_RESOURCES.length; i++) {
    if (deals >= MARKET.MAX_DEALS_PER_TICK) break;
    deals += buyResource(
      MARKET.BUY_RESOURCES[i],
      terminals,
      MARKET.MAX_DEALS_PER_TICK - deals,
    );
  }
}

module.exports = {
  run,
  sellableFrom,
  bestBuyOrder,
  bestSellOrder,
  buyCandidates,
  collectProtectedResources,
  isProtectedResource,
};
