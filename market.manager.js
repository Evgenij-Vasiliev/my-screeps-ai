/**
 * MARKET MANAGER (ТЗ №6 v1.0)
 * Автоматическая продажа избыточных ресурсов через Market.
 */

const {
  TERMINAL_SUPPLY,
  MARKET,
  LAB_BOOST,
  MARKET_BUY,
  TERMINAL_NETWORK,
} = require("./constants");
const loadShed = require("loadShed");
const labWorker = require("./lab.worker");

// Единый источник порогов терминала — TERMINAL_SUPPLY из constants.js.
// Продаём всё, что превышает эти же значения, которые Task System
// использует как цель для довоза. Дублирования порогов больше нет.
const CONFIG = {
  // ── ПРОДАЖА ЭНЕРГИИ ОСТАНОВЛЕНА (правка 05.10.2026) ────────────────────
  // Требование владельца: склад и терминал должны расти постоянно, приход
  // фиксирован, значит управлять можно только расходом. Продажа энергии —
  // это расход терминала, причём единственный, который никем не ограничен:
  // правило ниже продаёт ВСЁ, что выше резерва группы ENERGY
  // (getReserve → TERMINAL_SUPPLY.ENERGY_MIN = 100 000, constants/logistics.js:17),
  // то есть каждый раз, когда терминал переваливает за 100k, излишек уходит
  // на рынок. Рост терминала при этом невозможен по определению.
  //
  // ЖИВОЙ ЗАМЕР, из которого это следует (shard3, tick 83450886 -> 83451058):
  // комиссии и сделки съели ~4 923 энергии терминалов за 172 тика (~29/тик) —
  // это больше, чем весь наблюдаемый рост запаса. Кредитов при этом
  // 1 590 600 178, то есть продажа энергии не нужна ради бюджета вовсе.
  //
  // Что НЕ выключено: закупки отсутствующих реагентов (MARKET_BUY) и продажа
  // остальных групп (BATTERY/MINERALS/COMPOUNDS) — они обслуживают
  // производство бустов и к росту энергозапаса отношения не имеют.
  // Откат: ENABLE_ENERGY: true (одно слово) — прежнее поведение вернётся.
  ENABLE_ENERGY: false,
  ENABLE_BATTERY: true,
  ENABLE_MINERALS: true,
  ENABLE_COMPOUNDS: true,

  MAX_DEALS_PER_TICK: 3,
  MIN_PRICE_RATIO: 0.8,

  ENABLE_POWER_BUY: false,
  POWER_TARGET: 100000,
  POWER_MAX_PRICE_RATIO: 1.2,
};

const BASE_MINERALS = [
  RESOURCE_HYDROGEN,
  RESOURCE_OXYGEN,
  RESOURCE_UTRIUM,
  RESOURCE_LEMERGIUM,
  RESOURCE_KEANIUM,
  RESOURCE_ZYNTHIUM,
  RESOURCE_CATALYST,
];

const COMPOUNDS = RESOURCES_ALL.filter(
  r =>
    r !== RESOURCE_ENERGY &&
    r !== RESOURCE_BATTERY &&
    !BASE_MINERALS.includes(r),
);

/**
 * Ордера по паре (тип, ресурс) с кэшем на текущий тик.
 *
 * Замерено на живом шарде: первый getAllOrders стоит 0.16-0.89 CPU, а
 * повторный запрос с теми же аргументами — 0.09 CPU (кэш движка). Кэш
 * ниже убирает и эти 0.09: за проход рынок обходит все терминалы, и без
 * кэша один и тот же ресурс запрашивался бы по разу на терминал.
 *
 * Кэш живёт ровно один тик (ключ — Game.time), поэтому устаревшие ордера
 * вернуть не может.
 *
 * @param {string} type ORDER_BUY | ORDER_SELL
 * @param {string} resourceType
 * @returns {Array} массив ордеров
 */
function getOrders(type, resourceType) {
  const tick = Game.time;

  if (!global.__marketOrders || global.__marketOrders.tick !== tick) {
    global.__marketOrders = { tick, byKey: {} };
  }

  const key = type + "|" + resourceType;
  const cached = global.__marketOrders.byKey[key];
  if (cached !== undefined) return cached;

  const orders = Game.market.getAllOrders({ type, resourceType });
  global.__marketOrders.byKey[key] = orders;
  return orders;
}

function findAffordableBuyOrders(resourceType, maxPriceRatio = 1.2) {
  const orders = getOrders(ORDER_SELL, resourceType);

  if (orders.length === 0) return [];

  // Цикл вместо Math.min(...orders.map(...)): spread массива в аргументы
  // не масштабируется и лишний раз аллоцирует.
  let minPrice = Infinity;
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].price < minPrice) minPrice = orders[i].price;
  }
  const maxAcceptable = minPrice * maxPriceRatio;

  return orders
    .filter(o => o.price <= maxAcceptable)
    .sort((a, b) => a.price - b.price);
}

/**
 * ── ЗАКУПКА НЕДОСТАЮЩИХ ИНГРЕДИЕНТОВ (MARKET_BUY, правка 02.10.2026) ─────
 * Поручение владельца: «недостающие ингредиенты, если их нет в империи,
 * закупать на рынке». Числа и обоснование — в constants.js (MARKET_BUY).
 *
 * Порядок действий намеренный: СНАЧАЛА проверка запаса по империи, и только
 * потом getAllOrders. В установившемся режиме (запас выше цели) проход рынка не
 * платит за закупку ни одного вызова API — а getAllOrders стоит 0.16-0.89 CPU за
 * вызов (docs/CPU-BASELINE.md).
 */

/**
 * Запас ресурса по ИМПЕРИИ: терминалы + склады своих комнат с терминалом.
 *
 * Почему не лаборатории и не room.find: room.find(FIND_*_STRUCTURES) в проходе
 * рынка — лишний обход всех структур каждой комнаты (правило CPU,
 * DEVELOPMENT_RULES §11.1), а содержимое лабораторий это рабочий буфер на
 * единицы тиков реакции, который закрывается реагентными заявками сети
 * (terminalNetwork.collectLabRequests). Терминал и склад — то, что реально
 * хранит закупленное.
 * @param {string} resourceType
 * @param {Array} terminals
 * @returns {number}
 */
function empireStockOf(resourceType, terminals) {
  let total = 0;
  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i];
    total += terminal.store[resourceType] || 0;
    const room = Game.rooms[terminal.room.name];
    const storage = room && room.storage;
    if (storage) total += storage.store[resourceType] || 0;
  }
  return total;
}

/**
 * Ордера на продажу не дороже потолка, от дешёвых к дорогим.
 *
 * Отличие от findAffordableBuyOrders (там коэффициент от минимальной цены):
 * закупке нужен АБСОЛЮТНЫЙ потолок цены. «Дешёвый относительно рынка» ордер при
 * этом может стоить в разы больше расчётной цены ресурса — а цена здесь внешняя
 * и меняется без нашего участия.
 * @param {string} resourceType
 * @param {number} maxPrice
 * @returns {Array}
 */
function findCheapSellOrders(resourceType, maxPrice) {
  const orders = getOrders(ORDER_SELL, resourceType);
  const out = [];
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].price <= maxPrice) out.push(orders[i]);
  }
  out.sort((a, b) => a.price - b.price);
  return out;
}

/**
 * Комната-получатель: свой терминал с НАИМЕНЬШИМ запасом ресурса, способный
 * принять поставку — есть свободное место под объём и есть энергия на комиссию
 * с полом MARKET_BUY.ENERGY_FLOOR (комиссию движок списывает из терминала
 * получателя, а не из кошелька).
 *
 * Минимум запаса выбран потому, что закупка нужна там, где ресурса нет; развоз
 * по остальным комнатам делает терминальная сеть.
 * @param {string} resourceType
 * @param {number} amount
 * @param {Array} terminals
 * @param {string} orderRoomName
 * @returns {StructureTerminal|null}
 */
function pickBuyDestination(resourceType, amount, terminals, orderRoomName) {
  let best = null;
  let bestStock = Infinity;

  for (let i = 0; i < terminals.length; i++) {
    const terminal = terminals[i];
    if (terminal.store.getFreeCapacity() < amount) continue;

    const cost = getTransactionCost(amount, terminal.room.name, orderRoomName);
    if (
      (terminal.store[RESOURCE_ENERGY] || 0) <
      cost + MARKET_BUY.ENERGY_FLOOR
    ) {
      continue;
    }

    const room = Game.rooms[terminal.room.name];
    const storage = room && room.storage;
    const stock =
      (terminal.store[resourceType] || 0) +
      (storage ? storage.store[resourceType] || 0 : 0);

    if (stock < bestStock) {
      bestStock = stock;
      best = terminal;
    }
  }

  return best;
}

/**
 * Одна закупка: недостача до цели, не больше MAX_AMOUNT_PER_DEAL, по цене не выше
 * потолка ресурса и с потолком расхода за проход рынка.
 *
 * ВЫБОР ОРДЕРА — С МИНИМАЛЬНОЙ ПАРТИЕЙ. Живой dry-run (tick 83374021) показал,
 * как это ломается без правила: самым дешёвым ордером на H оказался лот из
 * 37 единиц, бот купил его и потратил на это одну из MAX_BUYS_PER_TICK сделок
 * прохода — при недостаче 28 556 единиц. Поэтому берётся первый по цене ордер,
 * который закрывает партию не меньше MIN_SEND_AMOUNT (1000 — то же число, что у
 * сети: комиссия пересылки и кулдаун терминала не окупаются мелочью), либо, если
 * сама недостача меньше, — недостача целиком.
 * @param {string} resourceType
 * @param {{target: number, maxPrice: number}} spec
 * @param {{terminals: Array, spent: number}} context
 * @returns {boolean} true — сделка совершена
 */
function tryBuyResource(resourceType, spec, context) {
  if (!spec || !spec.target) return false;

  const stock = empireStockOf(resourceType, context.terminals);
  if (stock >= spec.target) return false;

  const orders = findCheapSellOrders(resourceType, spec.maxPrice);
  if (orders.length === 0) return false;

  const need = spec.target - stock;
  const minDeal = Math.min(need, TERMINAL_NETWORK.MIN_SEND_AMOUNT);

  let order = null;
  let amount = 0;
  for (let i = 0; i < orders.length; i++) {
    const candidate = Math.min(
      need,
      orders[i].amount,
      MARKET_BUY.MAX_AMOUNT_PER_DEAL,
    );
    if (candidate < minDeal) continue;
    order = orders[i];
    amount = candidate;
    break;
  }
  if (!order) return false;

  const cost = amount * order.price;
  if (context.spent + cost > MARKET_BUY.MAX_CREDITS_PER_PASS) return false;

  const destination = pickBuyDestination(
    resourceType,
    amount,
    context.terminals,
    order.roomName,
  );
  if (!destination) return false;

  const result = Game.market.deal(order.id, amount, destination.room.name);
  if (result !== OK) return false;

  context.spent += cost;
  return true;
}

/**
 * Определяет группу ресурса (раздел 9 ТЗ №6): ENERGY / BATTERY /
 * MINERALS / COMPOUNDS — без жёсткой привязки к конкретным названиям.
 * @param {string} resourceType
 */
function getResourceGroup(resourceType) {
  if (resourceType === RESOURCE_ENERGY) return "ENERGY";
  if (resourceType === RESOURCE_BATTERY) return "BATTERY";
  if (BASE_MINERALS.includes(resourceType)) return "MINERALS";
  return "COMPOUNDS";
}

function isGroupEnabled(group) {
  return CONFIG[`ENABLE_${group}`];
}

function getReserve(group) {
  const map = {
    ENERGY: TERMINAL_SUPPLY.ENERGY_MIN,
    BATTERY: TERMINAL_SUPPLY.BATTERY_MAX,
    MINERALS: TERMINAL_SUPPLY.MINERAL_MAX,
    COMPOUNDS: TERMINAL_SUPPLY.COMPOUND_MAX,
  };
  return map[group];
}

/**
 * Собирает все терминалы Империи (раздел 10 ТЗ №6).
 */
function getEmpireTerminals() {
  // Кэшируются ИМЕНА комнат, а не объекты терминалов: игровые объекты
  // живут только в пределах тика, и ссылка, сохранённая в global, на
  // следующем тике уже невалидна.
  const cached = global.__marketTerminalRooms;
  let names;

  if (cached && Game.time - cached.tick < MARKET.TERMINALS_CACHE_TTL) {
    names = cached.names;
  } else {
    names = [];
    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.terminal && room.terminal.my) names.push(name);
    }
    global.__marketTerminalRooms = { tick: Game.time, names };
  }

  const terminals = [];
  for (let i = 0; i < names.length; i++) {
    const room = Game.rooms[names[i]];
    if (room && room.terminal && room.terminal.my) terminals.push(room.terminal);
  }
  return terminals;
}

/**
 * Ищет лучший подходящий BUY Order для ресурса.
 * Правило (решение Координатора): не продавать дешевле 80%
 * от максимальной цены среди всех доступных BUY Order.
 * @param {string} resourceType
 */
function findBestOrder(resourceType) {
  const orders = getOrders(ORDER_BUY, resourceType);

  if (orders.length === 0) return null;

  let maxPrice = -Infinity;
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].price > maxPrice) maxPrice = orders[i].price;
  }
  const minAcceptable = maxPrice * CONFIG.MIN_PRICE_RATIO;

  const goodOrders = orders.filter(o => o.price >= minAcceptable);
  if (goodOrders.length === 0) return null;

  goodOrders.sort((a, b) => b.price - a.price);
  return goodOrders[0];
}

/**
 * Основной цикл Market Manager. Вызывается один раз за тик для всей
 * Империи (не для каждой комнаты по отдельности — раздел 6 ТЗ №6).
 */
// Порядок обхода групп (ENERGY первой). Без явного порядка перебор
// ресурсов в terminal.store идёт в произвольном/стабильном порядке
// ключей объекта, и лимит MAX_DEALS_PER_TICK может каждый тик
// расходоваться на одну и ту же группу, не давая другим шанса.
const GROUP_ORDER = ["ENERGY", "BATTERY", "MINERALS", "COMPOUNDS"];

/**
 * Ресурсы, которые НЕЛЬЗЯ продавать даже при формальном излишке в терминале.
 *
 * Зачем. Правило продажи в этом файле простое: всё, что в терминале выше
 * резерва группы (TERMINAL_SUPPLY.MINERAL_MAX / COMPOUND_MAX и т.д.), считается
 * излишком и уходит на рынок. Для лаб это неверно: терминал — ЕДИНСТВЕННЫЙ
 * буфер, из которого lab.worker добирает реагенты (лабы их не производят).
 * Живой пример из замера: в терминале E35S39 лежало KO 15630 при
 * TERMINAL_SUPPLY.COMPOUND_MAX = 10000 (constants/logistics.js:21) — то есть 5630 единиц
 * формально «излишек», хотя терминал обслуживает тройки всей комнаты.
 *
 * Что защищено:
 *   - power — катализатор PowerSpawn;
 *   - реагенты ОБОИХ рецептов каждой тройки и ПРОДУКТЫ обоих рецептов
 *     (конфиги Memory.rooms[*].labs* через lab.worker.getConfigs). Именно обоих:
 *     тройка переключается между recipeA и recipeB по дефициту (lab.recipes),
 *     поэтому реагент неактивного сейчас рецепта — сырьё под следующее
 *     переключение, а продукт — цель производства комнаты;
 *   - бусты буст-лабы комнаты (config.boost, политика LAB_BOOST) — расходный
 *     материал бустирования;
 *   - ресурсы резервов LAB_BOOST.ROOM_RESERVE и HUB_RESERVE (XKH2O, XZHO2,
 *     XUHO2): это ПОЛ, ниже которого бусты не выдаются.
 *   - X (RESOURCE_CATALYST) — сырьё финальных реакций, которого империя не
 *     добывает вовсе. В ветке-источнике он защищался, пока хаб голоден
 *     (X_PURCHASE.HIGH + market.buy); закупки X здесь нет, поэтому он защищён
 *     ВСЕГДА — сознательно консервативнее. Откат — убрать строку ниже.
 *
 * Чего здесь НЕТ: KO и прочие соединения, не входящие ни в один рецепт
 * LAB_PLAN и ни в одну политику бустов, остаются «излишком» и продаются как
 * раньше — защита не должна останавливать рынок целиком.
 *
 * Стоимость: один проход по своим комнатам ЗА ПРОХОД РЫНКА
 * (MARKET.INTERVAL = 30 тиков, constants.js), а не за тик.
 *
 * @returns {Object<string, boolean>} ресурс → true (продавать нельзя)
 */
function collectProtectedResources() {
  /** @type {Object<string, boolean>} */
  const protectedResources = {};
  protectedResources[RESOURCE_POWER] = true;
  protectedResources[RESOURCE_CATALYST] = true;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    const configs = labWorker.getConfigs(room);
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i].config;

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
        for (let b = 0; b < config.boost.length; b++) {
          protectedResources[config.boost[b]] = true;
        }
      }
    }
  }

  // Ресурсы резервов бустов: HUB_RESERVE (комната-финишёр) и ROOM_RESERVE
  // (рабочая комната) держат пол запаса, ниже которого буст не выдаётся.
  const reserveMaps = [LAB_BOOST.ROOM_RESERVE, LAB_BOOST.HUB_RESERVE];
  for (let m = 0; m < reserveMaps.length; m++) {
    const map = reserveMaps[m];
    for (const resourceType in map) protectedResources[resourceType] = true;
  }

  return protectedResources;
}

function trySellResource(terminal, resourceType, surplus) {
  const order = findBestOrder(resourceType);
  if (!order) return false;

  const amount = Math.min(surplus, order.amount);
  if (amount <= 0) return false;

  const energyForDeal = Game.market.calcTransactionCost(
    amount,
    terminal.room.name,
    order.roomName,
  );
  if (terminal.store[RESOURCE_ENERGY] < energyForDeal) return false;

  const result = Game.market.deal(order.id, amount, terminal.room.name);
  return result === OK;
}

function tryBuyPower(terminal) {
  const currentPower = terminal.store[RESOURCE_POWER] || 0;

  if (currentPower >= CONFIG.POWER_TARGET) {
    return false;
  }

  const needed = CONFIG.POWER_TARGET - currentPower;

  const orders = findAffordableBuyOrders(
    RESOURCE_POWER,
    CONFIG.POWER_MAX_PRICE_RATIO,
  );
  if (orders.length === 0) {
    return false;
  }

  const order = orders[0];
  const amount = Math.min(needed, order.amount);

  if (amount <= 0) {
    return false;
  }

  const energyForDeal = Game.market.calcTransactionCost(
    amount,
    terminal.room.name,
    order.roomName,
  );

  if (terminal.store[RESOURCE_ENERGY] < energyForDeal) {
    return false;
  }

  const result = Game.market.deal(order.id, amount, terminal.room.name);
  return result === OK;
}

function run() {
  if (!Game.market) return;

  // ── Гейт по bucket: «рынок по требованию» (шаг 6 плана) ─────────────
  // Торговля не критична: ордер живёт 30 суток (MARKET_ORDER_LIFE_TIME),
  // за один тик он не исчезает, а в просадке запас CPU дороже сделки.
  // Поэтому при низком bucket проход рынка пропускается целиком.
  //
  // Порог — НЕ своё число: он берётся из loadShed (DEFAULT_THRESHOLDS.lite
  // = 9000, loadShed.js:139) и потому настраивается из консоли без
  // выгрузки: Memory.loadShedThresholds = { lite: 11000 }.
  // bucketLevel() === 0 означает «bucket не ниже порога lite».
  // Граница: порог в loadShed строгий (`bucket < lite`), поэтому при
  // bucket == 9000 гейт пропускает рынок — как и уровень off у loadShed.
  // Без Game.cpu (офлайн-тест, симулятор) bucketLevel() возвращает off,
  // то есть рынок работает как раньше.
  // Откат шага: удалить эти две строки — поведение вернётся к прежнему.
  if (loadShed.bucketLevel() > 0) return;

  // ── Внутритиковый гейт (Шаг 8 плана): бюджет тика исчерпан → не начинаем ─
  // Рынок — самая дорогая необязательная подсистема (`getAllOrders` 0.16–0.89
  // CPU за вызов, docs/CPU-BASELINE.md:76-79) и исполняется ПОСЛЕДНЕЙ в тике
  // (empire.js:80), поэтому эта проверка видит наибольший `getUsed()` за тик.
  // Порог — доля лимита из loadShed (default 0.8, настраивается Memory.
  // loadShedBudgetRatio); без Game.cpu overBudget() возвращает false, то есть
  // офлайн-тест и симулятор работают как раньше.
  // Откат шага: удалить эту строку.
  if (loadShed.overBudget()) return;

  // Throttle: проход рынка стоит 1-4 CPU, работать каждый тик он не может.
  // Откат к прежнему поведению — MARKET.INTERVAL = 1 в constants.js.
  if (Game.time % MARKET.INTERVAL !== 0) return;

  const terminals = getEmpireTerminals();
  if (terminals.length === 0) return;

  // Ресурсы лаб/бустов считаются «излишком» только формально: их продажа
  // морит голодом тройки и буст-лабы (см. collectProtectedResources).
  const protectedResources = collectProtectedResources();

  let dealsCount = 0;

  // ── ЗАКУПКА — ПЕРЕД ПРОДАЖЕЙ ────────────────────────────────────────────
  // Почему закупка раньше: у империи нет K, H, O и U для T1-контура (замер
  // tick 83373733), и без них лабы стоят. Продажа — операция над ИЗЛИШКОМ,
  // закупка — над дефицитом: при общем лимите сделок
  // (CONFIG.MAX_DEALS_PER_TICK) первым идёт то, без чего производство встанет.
  // Откат: убрать этот блок — продажа вернётся к прежнему порядку.
  //
  // РОТАЦИЯ РЕСУРСОВ (правка 02.10.2026, живой дефект фазы накопления).
  // При жёстком порядке списка H и K — расходники KH-троек, они уходят ниже цели
  // КАЖДЫЙ тик, поэтому занимали оба слота сделок на каждом проходе, а U, O и UO
  // не покупались НИКОГДА (живой замер: O 695 при цели 10 000). Указатель
  // round-robin в heap сдвигает начало обхода после каждой удачной закупки,
  // поэтому каждый ресурс получает свою сделку не реже, чем раз в длину списка
  // проходов (5 × 30 = 150 тиков).
  if (MARKET_BUY.ENABLED) {
    const context = { terminals: terminals, spent: 0 };
    const names = Object.keys(MARKET_BUY.RESOURCES);
    if (!global._marketBuyCursor) global._marketBuyCursor = { at: 0 };

    let cursor = global._marketBuyCursor.at % names.length;
    let buys = 0;

    for (let k = 0; k < names.length; k++) {
      if (buys >= MARKET_BUY.MAX_BUYS_PER_TICK) break;
      if (dealsCount >= CONFIG.MAX_DEALS_PER_TICK) break;

      const resourceType = names[cursor];
      cursor = (cursor + 1) % names.length;

      if (tryBuyResource(resourceType, MARKET_BUY.RESOURCES[resourceType], context)) {
        buys++;
        dealsCount++;
        // Следующий проход начнёт со СЛЕДУЮЩЕГО ресурса: расходные ресурсы не
        // вытесняют из очереди те, до которых проход ещё не доходил.
        global._marketBuyCursor.at = cursor;
      }
    }
  }

  for (const group of GROUP_ORDER) {
    if (dealsCount >= CONFIG.MAX_DEALS_PER_TICK) break;
    if (!isGroupEnabled(group)) continue;

    // Порог группы одинаков для всех ресурсов и терминалов — считаем один раз.
    const reserve = getReserve(group);

    for (const terminal of terminals) {
      if (dealsCount >= CONFIG.MAX_DEALS_PER_TICK) break;

      for (const resourceType in terminal.store) {
        if (dealsCount >= CONFIG.MAX_DEALS_PER_TICK) break;
        if (getResourceGroup(resourceType) !== group) continue;
        if (protectedResources[resourceType]) continue;

        const surplus = terminal.store[resourceType] - reserve;
        if (surplus <= 0) continue;

        if (trySellResource(terminal, resourceType, surplus)) {
          dealsCount++;
        }
      }
    }
  }

  if (CONFIG.ENABLE_POWER_BUY) {
    for (const terminal of terminals) {
      if (dealsCount >= CONFIG.MAX_DEALS_PER_TICK) break;

      if (tryBuyPower(terminal)) {
        dealsCount++;
      }
    }
  }
}

/**
 * Стоимость пересылки ресурса терминалом (в энергии) — обёртка над
 * `Game.market.calcTransactionCost(amount, fromRoomName, toRoomName)`.
 *
 * Зачем обёртка, а не прямой вызов на месте: правило проекта
 * (tests/rules.test.js:258-260) требует, чтобы `Game.market` встречался
 * ТОЛЬКО в этом файле. terminalNetwork (terminalNetwork.fitSendAmount)
 * считает этой функцией комиссию каждой отправки, поэтому вызов идёт сюда.
 *
 * Формула движка: ceil(amount × (1 − exp(−d/30))), где d — расстояние между
 * комнатами (docs/market.html, engine src/utils.js calcTerminalEnergyCost).
 * Кэша нет намеренно: это чистая арифметика, состояние игры она не читает.
 *
 * @param {number} amount объём отправки
 * @param {string} fromRoomName комната-отправитель
 * @param {string} toRoomName комната-получатель
 * @returns {number} энергия, которую спишет движок за пересылку
 */
function getTransactionCost(amount, fromRoomName, toRoomName) {
  return Game.market.calcTransactionCost(amount, fromRoomName, toRoomName);
}

module.exports.CONFIG = CONFIG;
module.exports.run = run;
module.exports.getTransactionCost = getTransactionCost;
// Внутренняя функция отдаётся наружу только ради офлайн-теста
// (tests/market.lab.protection.test.js): какая именно защита строится по
// конфигам троек и политике бустов.
module.exports.collectProtectedResources = collectProtectedResources;
