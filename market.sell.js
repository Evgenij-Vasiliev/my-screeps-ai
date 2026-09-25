/**
 * ===================================================
 * MARKET.SELL.JS — MARKET.SELL — продажа излишков
 * ===================================================
 * Продажа излишков из терминалов империи и защита того, что империя
 * расходует сама (power, реагенты активных реакций, бусты буст-лабы, X в
 * дефиците). Пороги — constants.MARKET и constants.STORAGE.
 *
 * Выделено из market.manager.js; точка входа рынка по-прежнему
 * require("./market.manager"), который собирает эти модули вместе.
 * ===================================================
 */
const { MARKET, STORAGE, X_PURCHASE } = require("./constants");
const labWorker = require("./lab.worker");
const recipes = require("./lab.recipes");
const core = require("./market.core");
const {
  state,
  getOrders,
  energyPrice,
  bestBuyOrder,
  bestSellOrder,
  buyCandidates,
  warnOnce,
  roomResourceTotal,
  logXDeal,
} = core;

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
 *   - реагенты ОБОИХ рецептов активных троек — берутся из Memory.rooms[*].labs*
 *     через labWorker.getConfigs (X, O, H, OH, K, L, U, Z и промежуточные
 *     соединения). Именно ОБОИХ: тройка переключается между recipeA и recipeB
 *     по дефициту (lab.recipes), и реагент неактивного сейчас рецепта — не
 *     излишек, а сырьё под следующее переключение. Продать его — значит
 *     застопорить вторую реакцию тройки;
 *   - продукты обоих рецептов тройки — цель производства комнаты (её забирают
 *     финальная тройка E35S37 или буст-лабы обычных комнат);
 *   - бусты буст-лабы комнаты (LAB_BOOST) — расходный материал бустирования.
 *   - X — сырьё финальных реакций, которого империя не добывает вовсе.
 * Продажа реагента морит голодом тройки лаб: терминал — единственный буфер,
 * из которого lab.worker добирает ингредиенты.
 *
 * ОДИН проход по комнатам считает и защищённый набор, и запас X: X нужен всем
 * финальным реакциям (LAB_PLAN), а терминальная сеть делает одну отправку за
 * тик — лишний обход империи только забирал бы CPU у продаж и закупки.
 * @returns {Object<string, boolean>}
 */
function collectProtectedResources() {
  /** @type {Object<string, boolean>} */
  const protectedResources = {};
  protectedResources[RESOURCE_POWER] = true;
  // X — сырьё финальных реакций, которого империя не добывает вовсе. Он
  // защищён от продажи, пока комнаты-ПОТРЕБИТЕЛИ (те, чьи тройки расходуют X
  // как реагент активной реакции — хаб финального производства) держат меньше
  // целевого запаса X_PURCHASE.HIGH. X, лежащий в комнате-заводе промежуточных
  // компонентов, потребителем не является: пока хаб голоден, его нельзя
  // продавать как «излишек» — иначе закупка и продажа шли бы в одном тике.
  const xConsumers = recipes.consumerRooms(X_PURCHASE.RESOURCE);
  const isXConsumer = (name) => xConsumers.indexOf(name) !== -1;

  let xTotal = 0;
  let xReserve = 0;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (!room.memory) continue;

    for (const { config } of labWorker.getConfigs(room)) {
      if (config.reagent1) protectedResources[config.reagent1] = true;
      if (config.reagent2) protectedResources[config.reagent2] = true;
      if (config.recipeA) {
        protectedResources[config.recipeA.reagent1] = true;
        protectedResources[config.recipeA.reagent2] = true;
        protectedResources[config.recipeA.product] = true;
      }
      if (config.recipeB) {
        protectedResources[config.recipeB.reagent1] = true;
        protectedResources[config.recipeB.reagent2] = true;
        protectedResources[config.recipeB.product] = true;
      }
      if (config.boost) {
        for (let i = 0; i < config.boost.length; i++)
          protectedResources[config.boost[i]] = true;
      }
    }

    const inRoom = roomResourceTotal(room, X_PURCHASE.RESOURCE);
    xTotal += inRoom;
    if (!isXConsumer(roomName)) xReserve += inRoom;
  }

  // Потребители вместе с имперским резервом. Продавать X имеет смысл только
  // когда ЛИШНИЙ (не достижимый хабом) запас сам покрывает целевой уровень:
  // тогда терминалы потребителей полны, и продажа не морит финальные тройки.
  const sellable = xTotal - xReserve;

  // state.xProtection — состояние «X в дефиците»: его читает shouldBuyX, чтобы не
  // считать запас второй раз за тот же запуск.
  state.xProtection = sellable < X_PURCHASE.HIGH;
  state.xTotalCache = xTotal;
  if (!state.xProtection) delete protectedResources[X_PURCHASE.RESOURCE];

  return protectedResources;
}

/**
 * Защищён ли ресурс от продажи (power или реагент активной реакции).
 * Набор считается лениво и переиспользуется в пределах запуска.
 * @param {string} resourceType
 * @returns {boolean}
 */
function isProtectedResource(resourceType) {
  if (!state.protectedCache) state.protectedCache = collectProtectedResources();
  return state.protectedCache[resourceType] === true;
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
    // но и неприкосновенный резерв энергии терминала. Иначе продажа
    // power/battery «проедала» резерв: в E35S37 осталось 90 865 при резерве
    // 100 000, и комнате нечем было долить спавны из терминала при пустом
    // storage.
    //
    // ПОЛ — MARKET.SELL_ENERGY_FLOOR (10000), а НЕ SELL_RESERVE.energy (100000):
    // резерв 100000 на живом шарде недостижим (энергия терминалов 6.8–26.5k),
    // из-за чего проверку и закомментировали целиком — предохранитель был
    // выключен, и сделки проходили при энергии терминала в десятки единиц.
    const energyFloor = txCost + (MARKET.SELL_ENERGY_FLOOR || 0);
    if (energy < energyFloor) {
      warnOnce(
        `[Market] ⚡ ${terminal.room.name}: мало энергии на комиссию продажи ` +
          `${resourceType} (нужно ${txCost} + резерв ${MARKET.SELL_ENERGY_FLOOR}, есть ${energy})`,
      );
      continue;
    }

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
    if (resourceType === X_PURCHASE.RESOURCE) {
      logXDeal("sell", terminal.room.name, dealAmount, order.price);
    }
    // Локально уменьшаем остаток заявки: следующий терминал увидит актуальный
    // объём и не попытается продать больше, чем в заявке.
    order.remainingAmount -= dealAmount;
    deals++;
  }

  return deals;
}

module.exports = {
  sellableFrom,
  roomMaySell,
  pickSellOrder,
  collectProtectedResources,
  isProtectedResource,
  sellSurplus,
};
