/**
 * ===================================================
 * MARKET.LABIMPORT.JS — MARKET.LABIMPORT — автозакупка реагентов лаб
 * ===================================================
 * Страховка плана LAB_PLAN: покупает недостающие реагенты реакций по
 * порогам, выведенным из планового резерва (lab.recipes.requiredReagents),
 * в терминалы комнат-потребителей.
 *
 * Выделено из market.manager.js; точка входа рынка по-прежнему
 * require("./market.manager"), который собирает эти модули вместе.
 * ===================================================
 */
const { MARKET, X_PURCHASE } = require("./constants");
const labWorker = require("./lab.worker");
const recipes = require("./lab.recipes");
const core = require("./market.core");
const {
  state,
  getOrders,
  bestSellOrder,
  bestBuyOrder,
  roomResourceTotal,
  empireResourceTotal,
} = core;

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
  // за запуск (см. state.importTotalCache).
  if (state.importTotalCache.tick !== Game.time) {
    state.importTotalCache = { tick: Game.time, map: {} };
  }
  let total = state.importTotalCache.map[resourceType];
  if (total === undefined) {
    total = state.importTotalCache.map[resourceType] =
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

module.exports = {
  labImportHandled,
  labImportActive,
  shouldBuyLabImport,
  labTerminalCandidates,
  logLabDeal,
  buyLabImport,
  runLabImport,
};
