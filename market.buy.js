/**
 * ===================================================
 * MARKET.BUY.JS — MARKET.BUY — курируемая закупка (X и критичный импорт)
 * ===================================================
 * Закупка X (X_PURCHASE) и критичного импорта O/Z/H (MARKET.IMPORT):
 * пороги дефицита по запасу ВСЕЙ империи, выбор терминала-получателя,
 * ценовые предохранители и общий buyResource.
 *
 * Выделено из market.manager.js; точка входа рынка по-прежнему
 * require("./market.manager"), который собирает эти модули вместе.
 * ===================================================
 */
const { MARKET, X_PURCHASE } = require("./constants");
const recipes = require("./lab.recipes");
const core = require("./market.core");
const {
  state,
  getOrders,
  bestBuyOrder,
  bestSellOrder,
  roomResourceTotal,
  empireResourceTotal,
  logXDeal,
} = core;

/**
 * Запас ресурса по империи с переиспользованием уже посчитанного значения X
 * (его считает collectProtectedResources в том же запуске): без этого закупка
 * делала бы второй полный обход комнат за тот же тик.
 * @param {string} resourceType
 * @returns {number}
 */
function cachedXTotal(resourceType) {
  if (resourceType === X_PURCHASE.RESOURCE && state.xProtection !== null) {
    return state.xTotalCache;
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
 * доноров. Обход империи — один на ресурс за запуск (state.importTotalCache).
 *
 * @param {string} resourceType
 * @returns {{total: number, buy: boolean, amount: number}}
 */
function shouldBuyImport(resourceType) {
  const cfg = MARKET.IMPORT ? MARKET.IMPORT[resourceType] : null;
  if (!cfg) return { total: 0, buy: false, amount: 0 };

  // Кэш действителен только внутри одного тика (см. объявление state.importTotalCache).
  if (state.importTotalCache.tick !== Game.time) {
    state.importTotalCache = { tick: Game.time, map: {} };
  }
  let total = state.importTotalCache.map[resourceType];
  if (total === undefined) {
    total = state.importTotalCache.map[resourceType] =
      empireResourceTotal(resourceType);
  }

  if (total >= cfg.LOW) return { total, buy: false, amount: 0 };

  let amount = cfg.HIGH - total;
  if (cfg.MAX_AMOUNT > 0) amount = Math.min(amount, cfg.MAX_AMOUNT);
  return { total, buy: amount > 0, amount };
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
  if (state.xProtection === null) {
    state.xProtection =
      empireResourceTotal(X_PURCHASE.RESOURCE) < X_PURCHASE.HIGH;
  }
  return state.xProtection;
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

module.exports = {
  cachedXTotal,
  shouldBuyX,
  shouldBuyImport,
  isXProtectionEnabled,
  xTerminalCandidates,
  pickXTerminal,
  bestAffordableSellOrder,
  buyX,
  buyResource,
};
