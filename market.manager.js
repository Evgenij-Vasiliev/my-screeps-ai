/**
 * MARKET MANAGER (ТЗ №6 v1.0)
 * Автоматическая продажа избыточных ресурсов через Market.
 */

const { TERMINAL_SUPPLY, MARKET } = require("./constants");

// Единый источник порогов терминала — TERMINAL_SUPPLY из constants.js.
// Продаём всё, что превышает эти же значения, которые Task System
// использует как цель для довоза. Дублирования порогов больше нет.
const CONFIG = {
  ENABLE_ENERGY: true,
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

  // Throttle: проход рынка стоит 1-4 CPU, работать каждый тик он не может.
  // Откат к прежнему поведению — MARKET.INTERVAL = 1 в constants.js.
  if (Game.time % MARKET.INTERVAL !== 0) return;

  const terminals = getEmpireTerminals();
  if (terminals.length === 0) return;

  let dealsCount = 0;

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

module.exports.CONFIG = CONFIG;
module.exports.run = run;
