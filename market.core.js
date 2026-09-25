/**
 * ===================================================
 * MARKET.CORE.JS — MARKET.CORE — общая инфраструктура рынка
 * ===================================================
 * Состояние одного запуска (кэш книги заявок, цена энергии, журналы
 * предупреждений и решений) и общие помощники, которыми пользуются
 * market.sell / market.buy / market.labImport: чтение книги заявок,
 * лучшие заявки, обход терминалов империи, запас ресурса по комнате и
 * империи, журнал сделок по X.
 *
 * Выделено из market.manager.js; точка входа рынка по-прежнему
 * require("./market.manager"), который собирает эти модули вместе.
 * ===================================================
 */
const { MARKET } = require("./constants");
const labWorker = require("./lab.worker");

// ── Состояние одного запуска рынка ───────────────────────────────────────
// Кэши собраны в один объект, потому что их делят все три подсистемы:
// книга заявок читается один раз на ресурс за запуск, цена энергии — один
// раз на запуск, решение о защите X считается в продаже
// (market.sell.collectProtectedResources), а читается закупкой
// (market.buy.cachedXTotal/isXProtectionEnabled). Сброс — core.resetRun()
// в начале market.manager.run().
const state = {
  bookCache: null, // книга заявок по ресурсам
  energyPriceCache: null, // цена энергии (комиссия сделок платится ею)
  logged: null, // журнал предупреждений: одно сообщение на ключ за запуск
  protectedCache: null, // ресурсы, защищённые от продажи (ленивый набор)
  xProtection: null, // защита X: null — решение ещё не принято
  xTotalCache: 0, // запас X по империи (считается вместе с защитой)
  importTotalCache: { tick: -1, map: {} }, // запас O/Z/H и т.п. на тик
};

/**
 * Сбрасывает состояние запуска. Вызывается из market.manager.run(); функции
 * вне run() (диагностика, тесты) работают с уже накопленным состоянием.
 */
function resetRun() {
  state.bookCache = {};
  state.energyPriceCache = null;
  state.logged = {};
  state.protectedCache = null;
  state.xProtection = null;
  state.xTotalCache = 0;
  state.importTotalCache = { tick: Game.time, map: {} };
}

/**
 * Книга заявок ресурса, прочитанная один раз за запуск.
 * @param {string} resourceType
 * @returns {Object[]}
 */
function getOrders(resourceType) {
  if (!state.bookCache[resourceType]) {
    state.bookCache[resourceType] =
      Game.market.getAllOrders({
        // Типы Screeps: строка из конфига → MarketResourceConstant.
        resourceType: /** @type {MarketResourceConstant} */ (resourceType),
      }) || [];
  }
  return state.bookCache[resourceType];
}

/**
 * Цена энергии, которой оплачивается комиссия сделки — «упущенная выгода»
 * от того, что комиссию нельзя продать как ресурс. Читается один раз за
 * запуск (лучший бид по энергии) и переиспользуется всеми сделками.
 * @returns {number}
 */
function energyPrice() {
  if (state.energyPriceCache === null) {
    const bid = bestBuyOrder(getOrders(RESOURCE_ENERGY));
    state.energyPriceCache = bid ? bid.price : 0;
  }
  return state.energyPriceCache;
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
 * Одно предупреждение на ключ за запуск — защита консоли от спама
 * (энергии под комиссию может не хватать каждый тик).
 * @param {string} message
 */
function warnOnce(message) {
  if (state.logged[message]) return;
  state.logged[message] = true;
  console.log(message);
}

module.exports = {
  state,
  resetRun,
  getOrders,
  energyPrice,
  getEmpireTerminals,
  bestBuyOrder,
  bestSellOrder,
  buyCandidates,
  boostLabId,
  resolveLab,
  roomResourceTotal,
  empireResourceTotal,
  logXDeal,
  warnOnce,
};
