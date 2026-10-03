---
name: screeps-market-terminal
description: Справочник по Game.market и терминалам Screeps — точные сигнатуры, комиссии и формулы стоимости пересылки, механика ордеров и deal, бюджет, троттлинг и подводные камни, сверенные с @types/screeps, screeps/engine и screeps/common.
whenToUse: Когда нужно писать или ревьюить market-логику бота (покупка/продажа ресурсов, снабжение базы, арбитраж), считать комиссию и стоимость транзакции либо проверять, какие поля и коды ошибок реально существуют у Game.market и терминала.
---

# Маркет и терминал (`Game.market`, `StructureTerminal`)

Файл содержит только проверенные в этой сессии факты: сигнатуры сверены с `@types/screeps`, поведение — с исходниками
`screeps/engine` и `screeps/common`, механика — с официальными docs. Теги источников расшифрованы в «Источники».
Всё, что не подтверждено исходником, помечено `[НЕ ПРОВЕРЕНО]`.

## Когда использовать

При написании/правке market-модуля бота: расчёт комиссии и стоимости пересылки, выставление и снятие ордеров,
исполнение `deal`, планирование под кулдаун терминала, ограничение трат и логирование сделок.
Перед использованием любого метода проверять его наличие по `[DT]` — в API нет `calcMarketFee` и `ordersIndex`.

## Ключевые факты

### 1. Поверхность API (только то, что есть в `@types/screeps`)

| метод/поле | сигнатура | источник |
|---|---|---|
| `Game.market.credits` | `number`; движок отдаёт `runtimeData.user.money / 1000` | `[DT]`, `[E/market]` |
| `Game.market.orders` | `{ [id: string]: Order }` — **только свои** ордера, с полем `active` | `[DT]`, `[E/market]` |
| `Game.market.incomingTransactions` | `Transaction[]`, последние 100 входящих | `[DT]` |
| `Game.market.outgoingTransactions` | `Transaction[]`, последние 100 исходящих | `[DT]` |
| `getAllOrders(filter?)` | `Order[]`; принимает объект-фильтр или функцию | `[DT]`, `[E/market]` |
| `getOrderById(id)` | `Order \| null` | `[DT]` |
| `getHistory(resource?)` | `PriceHistory[]` — дневная история за **последние 14 дней** | `[DT]`, `[DOC/api]` |
| `createOrder(params)` | `ScreepsReturnCode` | `[DT]` |
| `cancelOrder(orderId)` | `ScreepsReturnCode` | `[DT]` |
| `changeOrderPrice(orderId, newPrice)` | `ScreepsReturnCode` | `[DT]` |
| `extendOrder(orderId, addAmount)` | `ScreepsReturnCode` | `[DT]` |
| `deal(orderId, amount, yourRoomName?)` | `ScreepsReturnCode` | `[DT]` |
| `calcTransactionCost(amount, roomName1, roomName2)` | `number` (энергия) | `[DT]`, `[E/market]` |

- `Order` = `{ id, created, active?, type: ORDER_BUY|ORDER_SELL, resourceType, roomName?, amount, remainingAmount, totalAmount?, price }` `[DT]`.
- `PriceHistory` = `{ resourceType, date, transactions, volume, avgPrice, stddevPrice }` `[DT]`, `[DOC/api]`.
- `Transaction` = `{ transactionId, time, sender?, recipient?, resourceType, amount, from, to, description, order? }` `[DT]`.
- **`calcMarketFee` и `ordersIndex` в `@types/screeps` отсутствуют** (grep по скачанному `index.d.ts` — 0 совпадений) `[DT]`;
  комиссия задаётся константой `MARKET_FEE = 0.05` `[C]`, а «индекс ордеров» — это `Game.market.orders` (свои) + `getAllOrders` (все).

### 2. Терминал: константы и лимиты

| параметр | значение | источник |
|---|---|---|
| `TERMINAL_CAPACITY` | 300 000 | `[C]`, `[DOC/api]` |
| `TERMINAL_COOLDOWN` | 10 тиков | `[C]`, `[DOC/api]` |
| `TERMINAL_HITS` | 3000 | `[C]`, `[DOC/api]` |
| стоимость постройки | 100 000 | `[C]` `CONSTRUCTION_COST.terminal` |
| доступность | `CONTROLLER_STRUCTURES.terminal` = `{6:1, 7:1, 8:1}` (RCL 6+) | `[C]`, `[DOC/api]` |
| ёмкость при RCL < 6 | `storeCapacity = 0` (терминал не работает) | `[E/i/terminal/tick]` |
| `TERMINAL_MIN_SEND` | 100 — константа объявлена, но в открытом коде `engine`/`common` **не используется** ни в `send`, ни в `deal` | `[C]` + grep по обоим репозиториям; применяется ли на официальном сервере — `[НЕ ПРОВЕРЕНО]` |
| `terminal.cooldown` | оставшиеся тики до следующей `send`/`deal` | `[E/structures]`, `[DOC/api]` |

### 3. Стоимость транзакции (энергия)

`calcTransactionCost(amount, r1, r2) = ceil(amount × (1 − exp(−d/30)))`, где
`d = calcRoomsDistance(r1, r2, true) = max(|dx|, |dy|)` с замыканием мира (`driver.getWorldSize()`) `[E/market]`, `[E/utils]`, `[DT]`, `[DOC/api]`.

| amount | d=1 | d=2 | d=5 | d=10 | d=20 |
|---|---|---|---|---|---|
| 100 | 4 | 7 | 16 | 29 | 49 |
| 1 000 | 33 | 65 | 154 | 284 | 487 |
| 10 000 | 328 | 645 | 1 536 | 2 835 | 4 866 |
| 100 000 | 3 279 | 6 450 | 15 352 | 28 347 | 48 659 |

(расчёт по формуле `[E/utils].calcTerminalEnergyCost` = `Math.ceil(amount * (1 - Math.exp(-range/30)))`).

**Расхождения внутри официальной доки (проверено арифметикой):**

| утверждение доки | что даёт формула | вывод |
|---|---|---|
| `[DOC/api]` (пример `calcTransactionCost`): 1000 из W0N0 в W10N5 → 284 | `ceil(1000×(1−e^(−10/30))) = 284` | совпадает |
| `[DOC/api]` (`StructureTerminal`): 1000 из W0N0 в W10N5 → 742 | 742 соответствует d ≈ 40.6, а не 10 | **ошибка в доке**, верить формуле |
| `[DOC/market]` (пример): 200 единиц на 3 комнаты → 60 энергии | `ceil(200×(1−e^(−3/30))) = 20` | **ошибка в доке** |
| `[DOC/market]` (пример): 4000 энергии на 4 комнаты → 1600 энергии | `ceil(4000×(1−e^(−4/30))) = 500` | **ошибка в доке** |

Практическое следствие: считать стоимость только через `Game.market.calcTransactionCost(...)` в рантайме, не по примерам из доки.

### 4. Комиссии и время жизни ордера

| операция | комиссия | источник |
|---|---|---|
| `createOrder` | `price × totalAmount × 0.05` списывается сразу; при нехватке кредитов — `ERR_NOT_ENOUGH_RESOURCES` | `[DT]`, `[DOC/api]`, `[E/market]` |
| `extendOrder` | `price × addAmount × 0.05`; срок жизни ордера **не** продлевается | `[DT]`, `[E/gi-market]` |
| `changeOrderPrice` | только при повышении: `(newPrice − oldPrice) × remainingAmount × 0.05`; при понижении комиссия не возвращается | `[DT]`, `[DOC/api]`, `[E/gi-market]` |
| `cancelOrder` | комиссия **не** возвращается | `[DT]`, `[DOC/api]` |
| истечение ордера | `MARKET_ORDER_LIFE_TIME` = 30 суток; остаток комиссии `remainingAmount × price × 0.05` возвращается | `[C]`, `[E/gi-market]`, `[DT]` |
| максимум ордеров | `MARKET_MAX_ORDERS` = **300** на игрока (`ERR_FULL` при превышении) | `[C]`, `[E/market]` |

Проверки движка в `createOrder` `[E/market]`: ресурс из `RESOURCES_ALL` или `INTERSHARD_RESOURCES`;
`type` строго `ORDER_BUY`/`ORDER_SELL`; `price > 0` и `totalAmount > 0` после `parseFloat`/`parseInt`;
`price × totalAmount × MARKET_FEE ≤ credits`; для не-`INTERSHARD_RESOURCES` нужен свой терминал в `roomName`, иначе `ERR_NOT_OWNER`.

**Противоречие внутри доки:** в описании `createOrder` написано «The maximum orders count is 300 per player»,
а в списке кодов ошибок того же метода — «ERR_FULL: You cannot create more than 50 orders» `[DT]`, `[DOC/api]`; движок даёт 300 `[C]`, `[E/market]`.

### 5. `deal`: кто что платит и когда

| правило | факт | источник |
|---|---|---|
| энергию пересылки платит **дилер** (вызывающий `deal`), даже при покупке по sell-ордеру | да | `[DOC/market]`, `[E/gi-market]` (`transferFeeTerminal = targetTerminal`) |
| кулдаун 10 тиков получает терминал **дилера** | да | `[E/gi-market]`, `[DOC/market]` |
| не больше 10 сделок за тик | да; лимит интентов 10, превышение → `ERR_FULL` | `[E/market]`, `[DOC/api]`, `[DT]` |
| `yourRoomName` обязателен для обычных ресурсов | да, иначе `ERR_INVALID_ARGS` | `[E/market]` |
| для `INTERSHARD_RESOURCES` (`token`, `cpuUnlock`, `pixel`, `accessKey`) терминал не нужен | да | `[E/market]`, `[C]` `INTERSHARD_RESOURCES`, `[DT]` |
| кто получает ресурс при `ORDER_SELL` | дилер = покупатель: ресурс идёт из терминала владельца ордера в терминал дилера | `[E/gi-market]` |
| частичное исполнение | `amount = min(запрошено, remainingAmount, store продавца, свободное место покупателя, floor(деньги покупателя / price))` | `[E/gi-market]` |

Проверки движка в `Game.market.deal` до постановки интента `[E/market]`:
`ERR_INVALID_ARGS` — ордера нет (`!order`), `amount` нечисло/≤ 0, для обычного ресурса не передан `yourRoomName`;
`ERR_NOT_OWNER` — в `yourRoomName` нет вашего терминала;
`ERR_NOT_ENOUGH_RESOURCES` — `store.energy < transferCost`; для buy-ордера не хватает самого ресурса
(для энергетического — `store.energy < amount + transferCost`); для sell-ордера `credits < amount × price`;
`ERR_TIRED` — `terminal.cooldownTime > Game.time`.

### 6. Активность ордера и «съеденный» ордер

- **sell-ордер**: движок каждый тик синхронизирует `amount` с фактическим наличием ресурса в терминале;
  если ресурса нет — `active: false, amount: 0`; появился — снова `active: true` `[E/gi-market]`.
- **buy-ордер**: `amount = min(floor(money / price), remainingAmount)`, дополнительно ограничен свободным местом терминала
  (`storeCapacity − занято`) → ордер может «усохнуть» или деактивироваться `[E/gi-market]`.
- ордер NPC-терминала (`!order.user`) не пересчитывается и не истекает по сроку владельца `[E/gi-market]`;
  NPC-терминалы стоят на «перекрёстках» секторов (W0N0, W10N0, W10N10, …) `[DOC/market]`.
- `getAllOrders` отдаёт цену в кредитах: движок хранит `price × 1000` и делит на 1000 при выдаче `[E/market]`.
- Порядок исполнения нескольких `deal` на один ордер за тик: сортировка по расстоянию дилер→ордер
  (`terminalDeals.sort(...)`), т.е. приоритет у ближайшего `[E/gi-market]`.

### 7. Взаимодействие `send` и маркета

`StructureTerminal.send(resourceType, amount, targetRoomName, description?)` `[E/structures]`:
проверяется формат имени комнаты `/^(W|E)\d+(N|S)\d+$/`, наличие ресурса, кулдаун, энергия `≥ cost`
(для energy — `amount + cost`) и длина `description` ≤ 100; **наличие терминала в целевой комнате не проверяется**.
Далее в global-intents `[E/gi-market]`: если в целевой комнате нет терминала с владельцем, передача просто не выполняется,
ресурс остаётся в вашем терминале, кулдаун не ставится.

## Рецепты (код и расчёты)

**1. Проверка ордера перед `deal` (защита от слива кредитов).** Все используемые поля существуют `[DT]`:

```js
const cost = Game.market.calcTransactionCost(amount, myRoom, order.roomName); // [E/market]
const okOrder = order.type === ORDER_SELL
  && order.resourceType === RESOURCE_ENERGY
  && order.price <= Memory.market.maxPrice          // ваш порог, не API
  && order.remainingAmount >= amount
  && cost <= Memory.market.maxTransferCost;
if (okOrder && Game.market.deal(order.id, amount, myRoom) === OK) { /* ... */ }
```
`ORDER_SELL` как покупатель: нужны кредиты `≥ amount × price` и энергия `≥ cost` `[E/market]`.

**2. Бюджет.** Никакого API бюджета нет: комиссия списывается при создании ордера, кредиты — при `deal` `[E/market]`.
Держать счётчики в `Memory` (например `Memory.market = { dayTick, spent, cap }`) и сверять `Game.market.credits` `[DT]`.
Явные лимиты, которые нужно проверять самому: `credits ≥ price × totalAmount × 0.05` для `createOrder` и
`credits ≥ amount × price` для покупки `[E/market]`.

**3. Троттлинг.** API не имеет кэша между тиками; движок кэширует выборку **внутри одного тика**
(`cachedOrders[resourceType]`), при этом делает `JSON.parse(JSON.stringify(...))` всего индекса `[E/market]`.
Отсюда: (а) не вызывать `getAllOrders()` без фильтра по `resourceType` чаще, чем нужно; (б) держать свой кэш в `global`
с TTL (`Game.time % N === 0`) и хранить только агрегаты (лучшая цена/объём), а не весь массив;
(в) историю (`getHistory`) не тянуть каждый тик — она дневная `[DT]`, `[DOC/api]`.

**4. Логирование сделок.** Публичного «журнала сделок» нет; доступны `Game.market.incomingTransactions` /
`outgoingTransactions` (последние 100) и `Game.market.orders` `[DT]`. Для аудита писать свои записи в `RawMemory`/`Memory`
по факту `OK` от `deal`/`createOrder`.

**5. Планирование под кулдаун.** `TERMINAL_COOLDOWN` = 10 тиков на терминал дилера `[C]`, `[E/gi-market]`.
Значит одна сделка на терминал раз в 10 тиков: либо ставить сделки в очередь и делать не более одной за тик на терминал,
либо держать N терминалов в разных комнатах (по 1 на комнату `[DOC/api]`) — тогда до N сделок за 10 тиков.
Лимит 10 сделок за тик общий на игрока `[E/market]`.

**6. Пример расчёта снабжения энергией.** Покупка 10 000 энергии на расстоянии d=10:
кредиты `= 10 000 × price`, энергия на пересылку `= 2 835` (таблица выше).
Полезная энергия на базе `= 10 000`, а затраченная = `10 000 + 2 835` → фактическая цена единицы
`= price × 10000 / 10000` в кредитах плюс `0.2835` энергии на единицу. Сравнивать с ценой своей генерации.

## Подводные камни

- **`deal` не откатывается**: метода отмены сделки в API нет `[DT]`; после `OK` ресурс уже ушёл/пришёл.
- **`ERR_INVALID_ARGS` при «протухшем» ордере**: движок возвращает его, если ордер исчез из индекса
  (исполнен, отменён, истёк) `[E/market]` — обязательно проверять код возврата `deal`, а не только `OK`.
- **Нет энергии — нет сделки**: `ERR_NOT_ENOUGH_RESOURCES`, если `store.energy < transferCost`; для покупки энергии
  нужно `store.energy ≥ amount + transferCost` `[E/market]`.
- **Кулдаун**: `ERR_TIRED`, если терминал дилера ещё остывает `[E/market]`; кулдаун ставится только дилеру `[E/gi-market]`.
- **Отправка в комнату без терминала**: `send` вернёт `OK`, но передачи не будет; ресурс **не теряется**, кулдаун не ставится
  (проверка наличия терминала живёт в global-intents, а не в API-методе) `[E/structures]`, `[E/gi-market]`.
- **«Съеденный» ордер**: `amount`/`remainingAmount` меняются каждый тик и без вашего участия (синхронизация с терминалом владельца) `[E/gi-market]`;
  между чтением `getAllOrders` и вызовом `deal` состояние может измениться, поэтому `deal` на `remainingAmount` — частичный.
- **Цена**: API принимает `price > 0` (`parseFloat`), т.е. «цена в 1 кредит» — это не минимум движка, а ваша проверка;
  чем ниже цена, тем больше шанс, что ордер исполнят не вы. Допустимый минимум с учётом внутреннего хранения `price × 1000` — `[НЕ ПРОВЕРЕНО]`.
- **Комиссия невозвратна** при `cancelOrder` и при понижении цены; при истечении 30 дней возвращается только остаток `[DT]`, `[E/gi-market]`.
- **300 ордеров** на игрока (`ERR_FULL`) `[C]`, `[E/market]` — при массовой закупке базовых минералов это реальный предел.
- **`INTERSHARD_RESOURCES`** (`token`, `cpuUnlock`, `pixel`, `accessKey`) торгуются без терминала и без `yourRoomName` `[E/market]`, `[C]`.
- **Цена истории** (`avgPrice`, `stddevPrice`) — дневная за 14 дней, а не текущий стакан `[DT]`, `[DOC/api]`;
  интервал обновления внутри суток в исходниках не найден → `[НЕ ПРОВЕРЕНО]`.

## Источники

Скачано в этой сессии (curl):

- `[DT]` https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/screeps/index.d.ts — 250 348 байт;
  `interface Market` (credits/orders/transactions/calcTransactionCost/cancelOrder/changeOrderPrice/createOrder/deal/extendOrder/getAllOrders/getHistory/getOrderById),
  `interface Order`, `interface Transaction`, `interface PriceHistory`, `interface CreateOrderParam`; grep `ordersIndex|calcMarketFee` → 0 совпадений.
- `[C]` https://raw.githubusercontent.com/screeps/common/master/lib/constants.js — `MARKET_FEE: 0.05` (стр. 372),
  `MARKET_MAX_ORDERS: 300` (374), `MARKET_ORDER_LIFE_TIME: 1000*60*60*24*30` (375),
  `TERMINAL_CAPACITY: 300000` (333), `TERMINAL_HITS: 3000` (334), `TERMINAL_SEND_COST: 0.1` (335),
  `TERMINAL_MIN_SEND: 100` (336), `TERMINAL_COOLDOWN: 10` (337), `ORDER_SELL`/`ORDER_BUY` (369–370),
  `EXTRACTOR_COOLDOWN` (272), `CONTROLLER_STRUCTURES.terminal` (226), `CONSTRUCTION_COST.terminal` (205), `INTERSHARD_RESOURCES` (730+).
- `[E/market]` https://raw.githubusercontent.com/screeps/engine/master/src/game/market.js — `calcTransactionCost` 31, `getAllOrders` 36, `getHistory` 41, `createOrder` 68, `deal` 108, `changeOrderPrice` 155, `extendOrder` 174, геттеры `credits`/`orders`/`incomingTransactions`/`outgoingTransactions` 194–250.
- `[E/gi-market]` https://raw.githubusercontent.com/screeps/engine/master/src/processor/global-intents/market.js — `executeTransfer` (в начале файла), обработка `send`, `createOrder`, `changeOrderPrice`, `extendOrder`, `cancelOrder`, `deal`, синхронизация активности ордеров и истечение `MARKET_ORDER_LIFE_TIME`.
- `[E/structures]` https://raw.githubusercontent.com/screeps/engine/master/src/game/structures.js — `StructureTerminal` 702–747 (свойство `cooldown`, метод `send`), `spawnCreep` ~1063.
- `[E/utils]` https://raw.githubusercontent.com/screeps/engine/master/src/utils.js — `calcRoomsDistance` 644, `calcTerminalEnergyCost` 657.
- `[E/i/terminal/tick]` https://raw.githubusercontent.com/screeps/engine/master/src/processor/intents/terminal/tick.js — ёмкость терминала по RCL.
- `[DOC/market]` https://docs.screeps.com/market.html — 5 % fee, «энергию платит дилер», кулдаун дилера, примеры с NPC-терминалами.
- `[DOC/api]` https://docs.screeps.com/api/ — `Game.market.*`, `StructureTerminal`, пример `calcTransactionCost(1000,'W0N0','W10N5') -> 284`, «10 deals per tick», «14 days» history.
