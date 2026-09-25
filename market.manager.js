/**
 * ===================================================
 * MARKET.MANAGER.JS — менеджер рынка: точка входа и бюджет сделок
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
 *
 * РАЗБИТ НА МОДУЛИ. Здесь остаётся только run() — очерёдность подсистем и
 * общий лимит сделок на тик; сама торговля живёт в:
 *   market.sell      — продажа излишков и защита ресурсов;
 *   market.buy       — закупка X и критичного импорта (O/Z/H/U);
 *   market.labImport — автозакупка реагентов лаб;
 *   market.core      — состояние запуска и помощники книги заявок.
 * Публичный API сохранён: require("./market.manager") отдаёт те же функции,
 * что и до разбиения (на них опираются tests/market.*.test.js и live-скрипты).
 * ===================================================
 */

const { MARKET, X_PURCHASE } = require("./constants");
const core = require("./market.core");
const sell = require("./market.sell");
const buy = require("./market.buy");
const labImport = require("./market.labImport");

const { getEmpireTerminals, warnOnce } = core;
const { sellSurplus, isProtectedResource } = sell;
const { buyX, shouldBuyImport, buyResource } = buy;
const { runLabImport } = labImport;

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

  // Сброс кэшей запуска (книга заявок, цена энергии, журнал предупреждений,
  // решения о защите X): общее состояние живёт в market.core.
  core.resetRun();

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

  const sellList = MARKET.SELL_RESOURCES;
  // Round-robin: каждое срабатывание список начинается со следующего ресурса,
  // иначе первый в списке всегда выбирал бы весь лимит сделок.
  const start =
    sellList.length > 0
      ? Math.floor(Game.time / MARKET.CHECK_INTERVAL) % sellList.length
      : 0;

  for (let i = 0; i < sellList.length; i++) {
    if (deals >= MARKET.MAX_DEALS_PER_TICK) break;
    const resourceType = sellList[(start + i) % sellList.length];
    deals += sellSurplus(
      resourceType,
      terminals,
      MARKET.MAX_DEALS_PER_TICK - deals,
    );
  }
}

// Публичный API менеджера рынка: те же имена и те же объекты, что до
// разбиения. Доменные модули можно требовать напрямую, но внешний код
// (empire.js, live-скрипты, тесты) ходит через require("./market.manager").
module.exports = {
  run,
  sellableFrom: sell.sellableFrom,
  bestBuyOrder: core.bestBuyOrder,
  bestSellOrder: core.bestSellOrder,
  buyCandidates: core.buyCandidates,
  collectProtectedResources: sell.collectProtectedResources,
  isProtectedResource: sell.isProtectedResource,
  roomResourceTotal: core.roomResourceTotal,
  empireResourceTotal: core.empireResourceTotal,
  xTerminalCandidates: buy.xTerminalCandidates,
  pickXTerminal: buy.pickXTerminal,
  shouldBuyX: buy.shouldBuyX,
  shouldBuyImport: buy.shouldBuyImport,
  shouldBuyLabImport: labImport.shouldBuyLabImport,
  labImportHandled: labImport.labImportHandled,
  labImportActive: labImport.labImportActive,
  labTerminalCandidates: labImport.labTerminalCandidates,
  buyLabImport: labImport.buyLabImport,
  isXProtectionEnabled: buy.isXProtectionEnabled,
};
