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

const { MARKET, STORAGE, X_PURCHASE } = require("./constants");
const labWorker = require("./lab.worker");
// Комнаты-потребители X (lab.recipes.consumerRooms) — куда класть купленный X.
const recipes = require("./lab.recipes");

// Кэши одного запуска: книга заявок по ресурсам (чтобы `getAllOrders` для
// одного ресурса вызывался один раз), цена энергии (комиссия платится
// энергией) и журнал предупреждений, чтобы не спамить консоль каждый тик.
let bookCache = null;
let energyPriceCache = null;
let logged = null;

// Ресурсы, которые империя расходует сама (power + реагенты активных реакций)
// и потому не имеет права продавать. Считается лениво один раз за запуск.
let protectedCache = null;

// Включена ли защита X от продажи на этот запуск (запас империи ниже
// X_PURCHASE.HIGH). Считается один раз: и закупка (buyX), и продажа
// (sellSurplus) читают одно и то же решение, поэтому купить и продать X в
// одном тике невозможно. null — решение ещё не принято в этом запуске.
let xProtection = null;

// Запас X по империи, посчитанный вместе с защищённым набором (один обход
// комнат за запуск). Позволяет закупке не ходить по империи второй раз.
let xTotalCache = 0;

// Запас по империи для остальных закупаемых ресурсов (O/Z/H), посчитанный в
// этом тике: у каждого свой обход империи (Storage + Terminal + лаборатории),
// а за один тик такой обход нужен максимум один раз на ресурс. Ключ по Game.time,
// а не только сброс в run(): функцию вызывают и вне run() (диагностика, тесты),
// и тогда кэш прошлого тика не должен «замораживать» ответ.
let importTotalCache = { tick: -1, map: {} };

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

  // xProtection — состояние «X в дефиците»: его читает shouldBuyX, чтобы не
  // считать запас второй раз за тот же запуск.
  xProtection = sellable < X_PURCHASE.HIGH;
  xTotalCache = xTotal;
  if (!xProtection) delete protectedResources[X_PURCHASE.RESOURCE];

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

/**
 * ID буст-лабы в комнате: Memory.rooms[].boostLab. Нужен для подсчёта запаса
 * ресурса по империи (X лежит и в буст-лабах).
 * @param {Object} mem
 * @returns {string|null}
 */
function boostLabId(mem) {
  return mem && mem.boostLab ? mem.boostLab : null;
}

/**
 * Разрешение объекта-лаборатории по id. Проверка на наличие Game.getObjectById —
 * не «защита от тестов», а изоляция подсистемы: если лаборатория не разрешается
 * (нет id, объект снесён), запас по ней равен нулю и это НЕ должно ломать весь
 * менеджер рынка (ошибка в комнатной подсистеме не имеет права отключать
 * имперский рынок — та же политика, что у empire.js с try/catch по блокам).
 * @param {string} id
 * @returns {Object|null}
 */
function resolveLab(id) {
  if (!id || typeof Game.getObjectById !== "function") return null;
  return Game.getObjectById(id) || null;
}

/**
 * Запас ресурса в одной комнате: Storage + Terminal + ВСЕ лаборатории.
 *
 * Лаборатории считаются и как «тройки» (для них взят тот же labWorker.getConfigs,
 * что и у терминальной сети — включая буст-лабу), и по буст-лабе отдельно:
 * X лежит в лабораториях-реагентах финальных троек, а готовый буст — в
 * буст-лабе, и продавать/покупать по одному лишь терминалу нельзя.
 * Прямые ссылки (room.storage/room.terminal) — без Game.getObjectById: обе
 * структуры в комнате ровно в одном экземпляре и уже разрешены движком.
 * @param {Room} room
 * @param {string} resourceType
 * @returns {number}
 */
function roomResourceTotal(room, resourceType) {
  let total = 0;
  if (room.storage) total += room.storage.store[resourceType] || 0;
  if (room.terminal) total += room.terminal.store[resourceType] || 0;

  const seen = {};
  const configs = labWorker.getConfigs(room);
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i].config;
    const ids = [config.lab1, config.lab2, config.reactor];
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      if (!id || seen[id]) continue;
      seen[id] = true;
      const lab = resolveLab(id);
      if (lab) total += lab.store[resourceType] || 0;
    }
  }

  const boostId = boostLabId(room.memory);
  if (boostId && !seen[boostId]) {
    const lab = resolveLab(boostId);
    if (lab) total += lab.store[resourceType] || 0;
  }

  return total;
}

/**
 * Суммарный запас ресурса по империи: Storage + Terminal + лаборатории ВСЕХ
 * собственных комнат. Именно по этой сумме решается, нужна ли закупка X:
 * терминал одной комнаты показывает лишь часть запаса, а X лежит и в
 * лабораториях-реакторах, и в терминалах доноров.
 * @param {string} resourceType
 * @returns {number}
 */
function empireResourceTotal(resourceType) {
  let total = 0;
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    total += roomResourceTotal(room, resourceType);
  }
  return total;
}

/**
 * Запас ресурса по империи с переиспользованием уже посчитанного значения X
 * (его считает collectProtectedResources в том же запуске): без этого закупка
 * делала бы второй полный обход комнат за тот же тик.
 * @param {string} resourceType
 * @returns {number}
 */
function cachedXTotal(resourceType) {
  if (resourceType === X_PURCHASE.RESOURCE && xProtection !== null) {
    return xTotalCache;
  }
  return empireResourceTotal(resourceType);
}

/**
 * Разрешение на закупку X и её объём — единственное место, где решается,
 * покупать ли X.
 *
 * Правила (пороги — X_PURCHASE в constants.js, LOW < HIGH):
 *   - запас X по империи < LOW (5000) → закупка РАЗРЕШЕНА, цель — HIGH (15000);
 *   - запас ≥ LOW      → закупки нет (тратится накопленный запас, без дребезга);
 *   - запас ≥ HIGH     → покупки прекращаются;
 *   - запас снова упал < LOW → закупка разрешается заново.
 * Запас считается по ВСЕЙ империи (Storage + Terminal + лаборатории, включая
 * уже лежащий в реакторах X и зарезервированный планом производства), поэтому
 * закупка прекращается, как только ресурс есть где-то в империи, а не только в
 * терминале получателя.
 *
 * Объём сделки — минимум из «сколько не хватает до HIGH», X_PURCHASE.MAX_AMOUNT
 * и остатка лучшей заявки на продажу, чтобы одна покупка не выгребла терминал.
 * @param {number} [total] запас X по империи (если уже посчитан)
 * @returns {{total: number, buy: boolean, amount: number}}
 */
function shouldBuyX(total) {
  const resourceType = X_PURCHASE.RESOURCE;
  // Запас X уже посчитан в этом запуске (collectProtectedResources) — второй
  // обход империи не нужен. Вне run() (диагностика, тесты) считаем явно.
  if (total === undefined) total = cachedXTotal(resourceType);

  if (total >= X_PURCHASE.LOW) return { total, buy: false, amount: 0 };

  let amount = X_PURCHASE.HIGH - total;
  if (X_PURCHASE.MAX_AMOUNT > 0) amount = Math.min(amount, X_PURCHASE.MAX_AMOUNT);
  return { total, buy: amount > 0, amount };
}

/**
 * Разрешение на закупку критичного импорта (O/Z/H) и её объём.
 *
 * ПОЧЕМУ ЭТО НУЖНО. Империя физически не может добыть O и Z: минералы пяти
 * owned-комнат — K, H, L, L, U (проверено на живом shard3), а H/L/U выработаны
 * ниже порога спавна минерал-майнера. При этом O и H — обязательные участники
 * всех пяти верхних реакций (OH = O + H), а Z — буста MOVE (XZHO2). Без импорта
 * резерв бустов для экспансии не набрать.
 *
 * Правила — те же, что у X (гистерезис против дребезга):
 *   запас < LOW → закупка разрешена, цель HIGH; иначе закупка запрещена.
 * Пороги и потолок сделки — MARKET.IMPORT[resourceType] в constants.js.
 * Запас считается по ВСЕЙ империи (Storage + Terminal + лаборатории всех
 * комнат), потому что ресурс лежит и в лабораториях-реакторах, и в терминалах
 * доноров. Обход империи — один на ресурс за запуск (importTotalCache).
 *
 * @param {string} resourceType
 * @returns {{total: number, buy: boolean, amount: number}}
 */
function shouldBuyImport(resourceType) {
  const cfg = MARKET.IMPORT ? MARKET.IMPORT[resourceType] : null;
  if (!cfg) return { total: 0, buy: false, amount: 0 };

  // Кэш действителен только внутри одного тика (см. объявление importTotalCache).
  if (importTotalCache.tick !== Game.time) {
    importTotalCache = { tick: Game.time, map: {} };
  }
  let total = importTotalCache.map[resourceType];
  if (total === undefined) {
    total = importTotalCache.map[resourceType] =
      empireResourceTotal(resourceType);
  }

  if (total >= cfg.LOW) return { total, buy: false, amount: 0 };

  let amount = cfg.HIGH - total;
  if (cfg.MAX_AMOUNT > 0) amount = Math.min(amount, cfg.MAX_AMOUNT);
  return { total, buy: amount > 0, amount };
}

/**
 * Уже ли этим реагентом управляет курируемая закупка (X_PURCHASE или
 * MARKET.IMPORT)? Такие ресурсы автозаккупка лаб ПРОПУСКАЕТ: у них свои
 * пороги и свои получатели, и если обе подсистемы посмотрят на один ресурс,
 * они купят его дважды за один тик (лимит сделок общий, а цель — разная).
 * @param {string} resourceType
 * @returns {boolean}
 */
function labImportHandled(resourceType) {
  if (resourceType === X_PURCHASE.RESOURCE) return true;
  if (MARKET.IMPORT && MARKET.IMPORT[resourceType]) return true;
  return false;
}

/**
 * Есть ли в империи хоть одна настроенная тройка лаб, которую надо кормить.
 *
 * Без этого гейта автозаккупка работала бы в мире без лабораторий (например, в
 * тестах рынка): план LAB_PLAN статичен и перечисляет реагенты всегда, а
 * покупать их не для кого. Проверяется именно Memory комнат (getConfigs), а не
 * план: план — это намерение, тройка существует только когда её id записаны в
 * Memory.
 * @returns {boolean}
 */
function labImportActive() {
  const cfg = MARKET.LAB_IMPORT;
  if (!cfg || cfg.ENABLED === false) return false;
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;
    if (labWorker.getConfigs(room).length > 0) return true;
  }
  return false;
}

/**
 * Разрешение на автозакупку реагента лаб и её объём.
 *
 * Порог и цель выводятся из ПЛАНОВОГО РЕЗЕРВА (lab.recipes.requiredReagents:
 * сумма LOW троек, расходующих реагент), а не из отдельного списка чисел:
 *   low  = max(MIN_LOW,  резерв × LOW_RATIO)
 *   high = max(MIN_HIGH, low, резерв × HIGH_RATIO)
 *   запас империи < low → покупать до high; иначе закупки нет.
 * Так «не хватает для лаб» и «нет во всех комнатах» — это одно и то же
 * условие: запас ВСЕЙ империи (Storage + Terminal + лаборатории) ниже того,
 * что план считает рабочим резервом.
 *
 * @param {string} resourceType
 * @param {{low: number, rooms: string[]}} reserve
 * @returns {{total: number, low: number, high: number, buy: boolean, amount: number}}
 */
function shouldBuyLabImport(resourceType, reserve) {
  const cfg = MARKET.LAB_IMPORT;

  // Кэш запаса — тот же, что у shouldBuyImport: один обход империи на ресурс
  // за запуск (см. importTotalCache).
  if (importTotalCache.tick !== Game.time) {
    importTotalCache = { tick: Game.time, map: {} };
  }
  let total = importTotalCache.map[resourceType];
  if (total === undefined) {
    total = importTotalCache.map[resourceType] =
      empireResourceTotal(resourceType);
  }

  const planned = reserve && typeof reserve.low === "number" ? reserve.low : 0;
  const low = Math.max(cfg.MIN_LOW, Math.round(planned * cfg.LOW_RATIO));
  const high = Math.max(
    cfg.MIN_HIGH,
    low,
    Math.round(planned * cfg.HIGH_RATIO),
  );

  if (total >= low) return { total, low, high, buy: false, amount: 0 };

  let amount = high - total;
  if (cfg.MAX_AMOUNT > 0) amount = Math.min(amount, cfg.MAX_AMOUNT);
  return { total, low, high, buy: amount > 0, amount };
}

/**
 * Терминалы-получатели автозакупки реагента: сначала терминалы комнат, чьи
 * тройки РАСХОДУЮТ этот реагент (lab.recipes.consumerRooms), внутри группы —
 * по возрастанию запаса ВСЕЙ комнаты. Реагент нужен там, где варит тройка, а
 * не в первом терминале империи: доставка в чужую комнату — это ещё один рейс
 * терминальной сети, то есть потерянные тики простоя.
 * @param {StructureTerminal[]} terminals
 * @param {string} resourceType
 * @returns {StructureTerminal[]}
 */
function labTerminalCandidates(terminals, resourceType) {
  const consumers = recipes.consumerRooms(resourceType);
  const preferred = [];
  const rest = [];
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i];
    if (terminal.store.getFreeCapacity() < MARKET.MIN_DEAL_AMOUNT) continue;
    const roomName = terminal.room ? terminal.room.name : null;
    if (roomName && consumers.indexOf(roomName) !== -1) preferred.push(terminal);
    else rest.push(terminal);
  }
  preferred.sort(
    (a, b) =>
      roomResourceTotal(a.room, resourceType) -
      roomResourceTotal(b.room, resourceType),
  );
  return preferred.concat(rest);
}

/**
 * Журнал сделок автозакупки лаб в Memory (последние 5). Отдельно от __xDeal:
 * live-скрипты читают __xDeal как журнал ИМЕННО X, и подмешивать туда KH2O с
 * UHO2 нельзя — сломается разбор закупки X.
 * @param {string} roomName
 * @param {string} resourceType
 * @param {number} amount
 * @param {number} price
 */
function logLabDeal(roomName, resourceType, amount, price) {
  if (!Memory) return;
  const log = Memory.__labBuys || (Memory.__labBuys = []);
  log.push({
    t: Game.time,
    r: roomName,
    res: resourceType,
    n: amount,
    p: price,
  });
  while (log.length > 5) log.shift();
}

/**
 * Покупка реагента лаб: лучшая заявка продажи → терминал комнаты-потребителя.
 *
 * Отличия от общего buyResource: получатель выбирается по потребителям
 * ресурса (labTerminalCandidates) и по наименьшему запасу комнаты, а объём
 * ограничен дефицитом до HIGH (demand.amount), иначе одна покупка перепрыгнула
 * бы цель. Ценовой предохранитель — абсолютный потолок LAB_IMPORT.MAX_PRICE
 * для тонких рынков соединений, иначе обычное отношение к лучшему биду.
 *
 * @param {string} resourceType
 * @param {StructureTerminal[]} terminals
 * @param {number} dealBudget
 * @param {{total: number, low: number, high: number, amount: number}} demand
 * @returns {number} число успешных сделок
 */
function buyLabImport(resourceType, terminals, dealBudget, demand) {
  if (dealBudget <= 0) return 0;

  const orders = getOrders(resourceType);
  if (!orders || orders.length === 0) return 0;

  const ask = bestSellOrder(orders);
  if (!ask) return 0;

  const cfg = MARKET.LAB_IMPORT;
  const ceiling = cfg.MAX_PRICE ? cfg.MAX_PRICE[resourceType] : undefined;
  if (typeof ceiling === "number") {
    if (ask.price > ceiling) return 0;
  } else {
    const bid = bestBuyOrder(orders);
    if (bid && ask.price > bid.price * MARKET.MAX_BUY_PRICE_RATIO) return 0;
  }

  const candidates = labTerminalCandidates(terminals, resourceType);
  if (candidates.length === 0) return 0;
  const terminal = candidates[0];

  const override = MARKET.MAX_DEAL_AMOUNT[resourceType];
  const maxDeal =
    override === undefined ? MARKET.MAX_DEAL_AMOUNT_DEFAULT : override;
  let amount = Math.min(
    demand.amount,
    ask.remainingAmount,
    terminal.store.getFreeCapacity(),
  );
  if (maxDeal > 0) amount = Math.min(amount, maxDeal);
  if (amount < MARKET.MIN_DEAL_AMOUNT) return 0;

  const txCost = Game.market.calcTransactionCost(
    amount,
    terminal.room.name,
    ask.roomName,
  );
  const buyEnergyFloor = txCost + (MARKET.BUY_ENERGY_FLOOR || 0);
  if ((terminal.store[RESOURCE_ENERGY] || 0) < buyEnergyFloor) return 0;

  const result = Game.market.deal(ask.id, amount, terminal.room.name);
  if (result !== OK) {
    console.log(
      `[Market] ❌ ${terminal.room.name}: закупка реагента ${amount} ${resourceType} — ошибка ${result}`,
    );
    return 0;
  }

  console.log(
    `[Market] ✅ ${terminal.room.name}: куплено ${amount} ${resourceType} ` +
      `(реагент лаб) по ${ask.price} → ${Math.floor(amount * ask.price)} кредитов ` +
      `(комиссия ${txCost} энергии, ${ask.roomName}; в империи было ${demand.total}, ` +
      `порог ${demand.low}, цель ${demand.high})`,
  );
  logLabDeal(terminal.room.name, resourceType, amount, ask.price);
  ask.remainingAmount -= amount;
  return 1;
}

/**
 * Обход автозакупки реагентов лаб за один запуск рынка.
 *
 * Набор ресурсов берётся из плана (lab.recipes.requiredReagents), поэтому
 * новая тройка в LAB_PLAN начинает страховаться без правки рынка. Запуск
 * ограничен MAX_RESOURCES_PER_RUN ресурсами и обходится ПО КРУГУ (сдвиг старта
 * по Game.time): иначе первые в списке реагенты всегда выедали бы лимит сделок
 * и проверку книги заявок, а последние не проверялись бы никогда.
 * @param {StructureTerminal[]} terminals
 * @param {number} dealBudget
 * @returns {number} число успешных сделок
 */
function runLabImport(terminals, dealBudget) {
  if (dealBudget <= 0) return 0;
  if (!labImportActive()) return 0;

  const cfg = MARKET.LAB_IMPORT;
  const all = recipes.requiredReagents();
  const names = [];
  for (const res in all) {
    if (labImportHandled(res)) continue;
    if (!(all[res].low > 0)) continue;
    names.push(res);
  }
  if (names.length === 0) return 0;

  const limit =
    cfg.MAX_RESOURCES_PER_RUN > 0 ? cfg.MAX_RESOURCES_PER_RUN : names.length;
  const step = MARKET.CHECK_INTERVAL > 0 ? MARKET.CHECK_INTERVAL : 1;
  const start = Math.floor(Game.time / step) % names.length;

  const need = [];
  let deals = 0;
  let checked = 0;
  for (let i = 0; i < names.length && checked < limit; i++) {
    if (deals >= dealBudget) break;
    const resourceType = names[(start + i) % names.length];
    checked++;
    const demand = shouldBuyLabImport(resourceType, all[resourceType]);
    if (!demand.buy) continue;
    need.push(resourceType + ":" + demand.total + "/" + demand.low);
    deals += buyLabImport(
      resourceType,
      terminals,
      dealBudget - deals,
      demand,
    );
  }

  // Диагностика для live-скриптов: что именно признано дефицитом на этом
  // запуске. Пишется только при дефиците, чтобы Memory не «пачкалась» каждый
  // тик; список ограничен числом реагентов плана.
  if (Memory) {
    if (need.length > 0) Memory.__labImport = { t: Game.time, need: need };
    else delete Memory.__labImport;
  }

  return deals;
}

/**
 * Включена ли защита X от продажи: пока ЛИШНИЙ запас империи (сверх того, что
 * уже лежит у комнат-потребителей) ниже целевого X_PURCHASE.HIGH, X — не
 * излишек, а сырьё финальных реакций. В обычном тике величина посчитана вместе
 * с защищённым набором (один обход комнат за запуск, см.
 * collectProtectedResources), поэтому второго обхода нет. Резервная ветка —
 * вызов вне run() (диагностика): считаем явно, а не отдаём «неизвестно» как
 * «не защищён». X защищён и при нулевом запасе вовсе.
 * @returns {boolean}
 */
function isXProtectionEnabled() {
  if (xProtection === null) {
    xProtection =
      empireResourceTotal(X_PURCHASE.RESOURCE) < X_PURCHASE.HIGH;
  }
  return xProtection;
}

/**
 * Терминалы-получатели закупки X, в порядке предпочтения.
 *
 * 1. Терминалы комнат, чьи тройки РАСХОДУЮТ X (lab.recipes.consumerRooms)
 *    в первую очередь — это хаб финального производства. Именно эта группа
 *    используется и правилом «покупать не выше HIGH» (см. shouldBuyX), поэтому
 *    закупка и оценка дефицита смотрят на один и тот же набор комнат.
 * 2. Остальные терминалы империи — фоллбэк, если у потребителей нет места.
 * @param {StructureTerminal[]} terminals
 * @returns {StructureTerminal[]}
 */
function xTerminalCandidates(terminals) {
  const consumers = recipes.consumerRooms(X_PURCHASE.RESOURCE);
  const preferred = [];
  const rest = [];
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i];
    if (terminal.store.getFreeCapacity() < MARKET.MIN_DEAL_AMOUNT) continue;
    const roomName = terminal.room ? terminal.room.name : null;
    if (roomName && consumers.indexOf(roomName) !== -1) preferred.push(terminal);
    else rest.push(terminal);
  }
  return preferred.concat(rest);
}

/**
 * Терминал-получатель закупки X: среди терминалов-потребителей — тот, где X
 * меньше всего (у хаба финального производства он и есть цель закупки).
 * @param {StructureTerminal[]} terminals
 * @returns {StructureTerminal|null}
 */
function pickXTerminal(terminals) {
  const resourceType = X_PURCHASE.RESOURCE;
  const candidates = xTerminalCandidates(terminals);
  if (candidates.length === 0) return null;

  const consumers = recipes.consumerRooms(resourceType);
  const inConsumers = candidates.filter(
    t => t.room && consumers.indexOf(t.room.name) !== -1,
  );
  const pool = inConsumers.length ? inConsumers : candidates;

  // Сравнивается запас ВСЕЙ комнаты (терминал + склад + лаборатории), а не
  // только терминала: X у потребителя обычно лежит именно в лабораториях, и
  // по одному лишь терминалу все комнаты выглядят одинаково пустыми.
  let best = pool[0];
  let bestAmount = roomResourceTotal(best.room, resourceType);
  for (let i = 1; i < pool.length; i++) {
    const amount = roomResourceTotal(pool[i].room, resourceType);
    if (amount < bestAmount) {
      bestAmount = amount;
      best = pool[i];
    }
  }
  return best;
}

/**
 * Ищет лучший ордер продажи для закупки с учётом абсолютного лимита цены
 * (X_PURCHASE.MAX_PRICE; 0 — лимита нет) и относительного предохранителя
 * MAX_BUY_PRICE_RATIO. Порядок ордеров — от дешёвых к дорогим.
 * @param {Object[]} orders
 * @returns {Object|null}
 */
function bestAffordableSellOrder(orders) {
  let best = null;
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    if (order.type !== ORDER_SELL) continue;
    if (X_PURCHASE.MAX_PRICE > 0 && order.price > X_PURCHASE.MAX_PRICE)
      continue;
    if (!best || order.price < best.price) best = order;
  }
  return best;
}

/**
 * Журнал сделок по X в Memory: последние несколько записей. Нужен для
 * эксплуатационного контроля (tests/live.verify.*): по нему видно, что закупка
 * реально шла и в какую комнату лёг X. Пишется только при сделке и ограничен
 * пятью записями, поэтому Memory не «пачкается» каждый тик.
 * @param {string} action "buy" | "sell"
 * @param {string} roomName
 * @param {number} amount
 * @param {number} price
 */
function logXDeal(action, roomName, amount, price) {
  if (!Memory) return;
  const log = Memory.__xDeal || (Memory.__xDeal = []);
  log.push({ t: Game.time, a: action, r: roomName, n: amount, p: price });
  while (log.length > 5) log.shift();
}

/**
 * Закупка X: единственный ресурс, который империя не добывает сама.
 *
 * Отдельной торговой системы нет — используется существующий механизм
 * менеджера (getOrders/bestSellOrder/deal, кэш книги заявок на запуск).
 * Отличия от общего buyResource только в том, ЧТО и СКОЛЬКО покупать:
 *   - объём считается от дефицита (shouldBuyX), а не «сколько даст ордер»:
 *     иначе первая же покупка выгребла бы лимит сделок и перепрыгнула HIGH;
 *   - получатель — терминал с наименьшим запасом X (центр потребления), а не
 *     первый терминал империи;
 *   - учитывается абсолютный лимит цены X_PURCHASE.MAX_PRICE.
 * @param {Object[]} terminals
 * @param {number} dealBudget
 * @returns {number} число успешных сделок
 */
function buyX(terminals, dealBudget) {
  if (dealBudget <= 0) return 0;

  // Дефицита нет (в империи X уже >= LOW) — книга заявок НЕ читается:
  // getAllOrders самый дорогой вызов менеджера, а покупать нечего. Заодно это
  // исключает бессмысленный обход книги по X в тики, когда запас в норме.
  const demand = shouldBuyX();
  if (!demand.buy) return 0;

  const resourceType = X_PURCHASE.RESOURCE;
  const orders = getOrders(resourceType);
  if (!orders || orders.length === 0) return 0;

  const ask = bestAffordableSellOrder(orders);
  if (!ask) return 0;

  // Относительный предохранитель цены: не покупаем заметно дороже лучшего
  // встречного бида (если покупок нет вовсе — сравнивать не с чем).
  const bid = bestBuyOrder(orders);
  if (bid && ask.price > bid.price * MARKET.MAX_BUY_PRICE_RATIO) return 0;

  const terminal = pickXTerminal(terminals);
  if (!terminal) return 0;

  let amount = Math.min(demand.amount, ask.remainingAmount);
  amount = Math.min(amount, terminal.store.getFreeCapacity());
  if (amount < MARKET.MIN_DEAL_AMOUNT) return 0;

  const txCost = Game.market.calcTransactionCost(
    amount,
    terminal.room.name,
    ask.roomName,
  );
  // Комиссия покупки платится энергией терминала — резерв остаётся нетронутым
  // (та же политика, что у buyResource/sellSurplus). Пол — MARKET.BUY_ENERGY_FLOOR
  // (20000), а НЕ SELL_RESERVE.energy (100000): в живом shard3 энергия
  // терминалов 48–77k, и старый пол блокировал ЛЮБУЮ закупку, включая X.
  const buyEnergyFloor = txCost + (MARKET.BUY_ENERGY_FLOOR || 0);
  if ((terminal.store[RESOURCE_ENERGY] || 0) < buyEnergyFloor) return 0;

  const result = Game.market.deal(ask.id, amount, terminal.room.name);
  if (result !== OK) {
    console.log(
      `[Market] ❌ ${terminal.room.name}: закупка X ${amount} — ошибка ${result}`,
    );
    return 0;
  }

  console.log(
    `[Market] ✅ ${terminal.room.name}: куплено ${amount} X ` +
      `по ${ask.price} → ${Math.floor(amount * ask.price)} кредитов ` +
      `(комиссия ${txCost} энергии, ${ask.roomName}; запас был ${demand.total}, ` +
      `цель ${X_PURCHASE.HIGH})`,
  );
  logXDeal("buy", terminal.room.name, amount, ask.price);
  ask.remainingAmount -= amount;
  return 1;
}

/**
 * Покупает ресурс из лучшей заявки продажи в терминал комнаты.
 *
 * @param {string} resourceType
 * @param {Object[]} terminals
 * @param {number} dealBudget
 * @param {number} [demandAmount] сколько ресурса ещё НУЖНО империи (дефицит до
 *   HIGH из shouldBuyImport). Без этого потолка покупка шла бы «сколько даст
 *   ордер» и легко перепрыгивала цель. Если не задан (например, закупка без
 *   порогов), объём ограничен только MARKET.MAX_DEAL_AMOUNT*.
 * @returns {number} число успешных сделок
 */
function buyResource(resourceType, terminals, dealBudget, demandAmount) {
  const orders = getOrders(resourceType);
  if (!orders || orders.length === 0) return 0;

  const ask = bestSellOrder(orders);
  if (!ask) return 0;

  // ЦЕНОВОЙ ФИЛЬТР. По умолчанию MAX_BUY_PRICE_RATIO: не покупаем дороже, чем
  // лучшая заявка покупки × коэффициент (если покупок нет вовсе, сравнивать не с
  // чем — цена свободная).
  //
  // ДЛЯ ГОТОВЫХ БУСТОВ ЭТО ПРАВИЛО НЕ РАБОТАЕТ И БЛОКИРУЕТ СДЕЛКУ ЦЕЛИКОМ.
  // Живой замер shard3: у XKH2O лучшая продажа 1531.98 при лучшей покупке
  // 265.98 (отношение 5.76), у XZHO2 — 1205.71 / 189.22 (6.37), у XUHO2 —
  // 466.17 / 258.62 (1.80); порог 1.2 отклонял ЛЮБУЮ покупку бустов, из-за чего
  // подстраховка закупкой не срабатывала вовсе. У сырья (X, O, Z, H, U) спред
  // узкий, поэтому правило для него сохраняется без изменений.
  // Явный потолок цены (BUY_MAX_PRICE) — проверяемый и аудируемый лимит вместо
  // сравнения с чужой заявкой: он не даёт цене уйти вверх, но не запрещает
  // сделку на тонком рынке.
  const ceiling = MARKET.BUY_MAX_PRICE
    ? MARKET.BUY_MAX_PRICE[resourceType]
    : undefined;
  if (typeof ceiling === "number") {
    if (ask.price > ceiling) return 0;
  } else {
    const bid = bestBuyOrder(orders);
    if (bid && ask.price > bid.price * MARKET.MAX_BUY_PRICE_RATIO) return 0;
  }

  let left =
    typeof demandAmount === "number" && demandAmount > 0
      ? demandAmount
      : Number.POSITIVE_INFINITY;

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
    if (left !== Number.POSITIVE_INFINITY) amount = Math.min(amount, left);
    amount = Math.min(amount, terminal.store.getFreeCapacity());
    if (amount < MARKET.MIN_DEAL_AMOUNT) continue;

    const txCost = Game.market.calcTransactionCost(
      amount,
      terminal.room.name,
      ask.roomName,
    );
    // Комиссия покупки тоже платится энергией терминала — держим её резерв
    // нетронутым (см. sellSurplus), чтобы покупка не «проела» комнату.
    // Пол — MARKET.BUY_ENERGY_FLOOR (см. комментарий в buyX).
    const buyEnergyFloor = txCost + (MARKET.BUY_ENERGY_FLOOR || 0);
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
    left -= amount;
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
  xProtection = null;
  xTotalCache = 0;
  importTotalCache = { tick: Game.time, map: {} };

  let deals = 0;

  // ЗАЩИТА X И ЗАКУПКА СЧИТАЮТСЯ ДО ПЕРВОЙ СДЕЛКИ. Запас X по империи (вместе
  // с защитой от продажи) считается здесь, а не лениво во время продаж: иначе
  // между закупкой и продажей решение о защите могло бы быть принято позже, и X
  // попал бы в продажу при активной потребности. Прайминг безусловный — он не
  // зависит от того, включена ли закупка X в BUY_RESOURCES.
  isProtectedResource(X_PURCHASE.RESOURCE);

  // ЗАКУПКА ИДЁТ ПЕРВОЙ: у X приоритет над обычным surplus-поведением.
  // X считается по своим порогам (X_PURCHASE, shouldBuyX внутри buyX), остальные
  // ресурсы — по порогам критичного импорта (MARKET.IMPORT + shouldBuyImport):
  // раньше buyResource вызывался БЕЗ порогов и покупал бы «сколько даст ордер».
  for (let i = 0; i < MARKET.BUY_RESOURCES.length; i++) {
    if (deals >= MARKET.MAX_DEALS_PER_TICK) break;
    const resourceType = MARKET.BUY_RESOURCES[i];
    if (resourceType === X_PURCHASE.RESOURCE) {
      deals += buyX(terminals, MARKET.MAX_DEALS_PER_TICK - deals);
      continue;
    }

    const demand = shouldBuyImport(resourceType);
    if (!demand.buy) {
      // Ресурс в списке закупки, но порогов для него нет — покупать «наугад»
      // нельзя (можно выгрести бюджет). Предупреждаем один раз на ресурс.
      if (!MARKET.IMPORT || !MARKET.IMPORT[resourceType]) {
        warnOnce(
          `[Market] ⚠️ ${resourceType}: в BUY_RESOURCES нет порогов MARKET.IMPORT — закупка пропущена`,
        );
      }
      continue;
    }
    deals += buyResource(
      resourceType,
      terminals,
      MARKET.MAX_DEALS_PER_TICK - deals,
      demand.amount,
    );
  }

  // АВТОЗАКУПКА РЕАГЕНТОВ ЛАБ ИДЁТ ПОСЛЕ КУРИРУЕМОГО ИМПОРТА и делит с ним
  // общий лимит сделок: X/O/Z/H/U и готовые бусты имеют приоритет (у них
  // собственные пороги и они дороже в простое), а промежуточные соединения
  // (KH2O/ZHO2/UHO2/KH/OH/ZO/UO/K/L) добираются тем, что осталось от лимита.
  // Если лимит уже выбран — закупка лаб просто не запускается в этот тик.
  if (deals < MARKET.MAX_DEALS_PER_TICK) {
    deals += runLabImport(terminals, MARKET.MAX_DEALS_PER_TICK - deals);
  }

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
}

module.exports = {
  run,
  sellableFrom,
  bestBuyOrder,
  bestSellOrder,
  buyCandidates,
  collectProtectedResources,
  isProtectedResource,
  roomResourceTotal,
  empireResourceTotal,
  xTerminalCandidates,
  pickXTerminal,
  shouldBuyX,
  shouldBuyImport,
  shouldBuyLabImport,
  labImportHandled,
  labImportActive,
  labTerminalCandidates,
  buyLabImport,
  isXProtectionEnabled,
};
