# Руководство по консоли и диагностике

## Screeps Empire AI — Координатор

---

## Подключение

В `main.js` должно быть:

```js
const diagnostics = require("./diagnostics");
require("./console");

// внутри loop():
diagnostics.run(); // автодиагностика раз в 50 тиков
```

---

## КОМАНДЫ ДИАГНОСТИКИ

---

### `room('E35S37')` — состояние комнаты

Показывает RCL, энергия в storage и terminal, состояние фабрики, список крипов по ролям.

```js
room("E35S37");
```

---

### `diag('E35S37')` — полная диагностика комнаты

Всё что `room()` плюс зависшие крипы, проблемы с линками, подробное состояние каждого крипа.

```js
diag("E35S37");
```

---

### `creepDiag('name')` — диагностика крипа

Роль, комната, позиция, состояние, store, assignment, невалидные ID, зависший или нет.

```js
creepDiag("test_deliveryWorker_80451022");
```

---

### `factory('E35S37')` — состояние фабрики

Статус, задача, cooldown, store фабрики, активные deliveries.

```js
factory("E35S37");
```

---

### `links('E35S37')` — состояние линков

Все линки: энергия, заполненность %, cooldown.

```js
links("E35S37");
```

---

### `logistics()` — состояние логистики

Все активные deliveries по всем комнатам (кроме completed/cancelled).

```js
logistics();
```

---

### `labs('E35S37')` — состояние лаб _(NEW v3.0)_

Показывает каждую тройку лаб (labs, labs2...):

- реакция (reagent1 + reagent2 → product)
- количество реагентов в L1 и L2
- количество продукта в L3 (реактор) и его cooldown
- статус из labController (running / waiting_input / cooldown / error)
- список labWorker'ов в комнате

```js
labs("E35S37");
```

```
========== ЛАБЫ: E35S37 ==========

  [labs] Реакция: H + O → OH
    L1 input H:  ✅ 1200
    L2 input O:  ✅ 900
    L3 output OH: ✅ 3400 | cooldown: 0
    Статус: 🟢 running

  [labs2] Реакция: Z + K → ZK
    L1 input Z:  ⚠️  200
    L2 input K:  ✅ 1500
    L3 output ZK: ⏳ 0 | cooldown: 3
    Статус: 🟡 waiting_input
    ⚠️  Нет реагентов: Z
==================================
```

---

### `terminal('E35S37')` — состояние терминала _(NEW v3.0)_

Заполненность, cooldown, все ресурсы с количеством > 0 (отсортированы по убыванию), pending отправки.

```js
terminal("E35S37");
```

```
========== ТЕРМИНАЛ: E35S37 ==========
  Заполнен: 🟢 82000/300000 (27%)
  Cooldown: 0

  Ресурсы:
    energy               : 52000
    KH                   : 4300
    H                    : 2000
    battery              : 1100
==========================================
```

---

### `market()` — маркет _(NEW v3.0)_

Buy/sell интенты из MarketManager, реальные ордера на рынке, последние 5 сделок, статистика MarketDirector.

```js
market();
```

```
========== МАРКЕТ ==========
  Credits: 284500
  Тик: 12345678

  BUY интенты:
    нет

  SELL интенты:
    battery              x50000 [normal] — surplus
    KH                   x14000 [normal] — surplus

  Активные ордера на рынке: 3
  SELL:
    battery              x45000 @ 8.2
    KH                   x12000 @ 1.6
  BUY:
    H                    x5000 @ 0.41

  Последние сделки (3):
    t=12345600 SELL battery x2000 @ 8.2 (+16400cr)
============================
```

---

### `balance()` — баланс ресурсов _(NEW v3.0)_

Показывает energy, H, O, OH, battery по всем своим комнатам.
Автоматически выявляет дисбаланс и подсказывает команду sendResource.

```js
balance();
```

```
========== БАЛАНС РЕСУРСОВ ==========

  energy:
    E35S37: 🟢 268000 (st=200000 term=68000)
    E37S37: 🔴 12000  (st=10000 term=2000)
    → ДИСБАЛАНС: E35S37 → E37S37 (можно отправить ~50000)
      Команда: sendResource('E35S37', 'E37S37', 'energy', 50000)

  H:
    E35S37: 🟢 8400 (st=6000 term=2400)
    E37S37: 🟢 3200 (st=3200 term=0)
======================================
```

Иконки: 🟢 норма · 🔴 дефицит (меньше min) · 🟡 избыток (больше max)

---

### `empire()` — сводка по всей империи

Тик, CPU bucket, критические/low ресурсы, storage/terminal по комнатам, TaskDispatcher.

```js
empire();
```

---

### `history()` — история событий

```js
history(); // последние 20 событий империи
history("E35S37"); // события комнаты
history("E35S37", 10); // последние 10 событий комнаты
```

---

### `roomHealth('E35S37')` — быстрый статус комнаты

Показывает OK / WARN / ERROR по каждому контуру.
v3.0: добавлены Labs, Market, Balance.

```js
roomHealth("E35S37");
```

```
ROOM E35S37
──────────────────
  ✅ Storage   : OK
  ✅ Terminal  : OK
  ⚠️  Labs      : WARN
  ✅ Factory   : OK
  ✅ Delivery  : OK
  ✅ Links     : OK
  ✅ Market    : OK
  ✅ Balance   : OK
  ⚠️  Remote    : WARN
──────────────────
```

---

## КОМАНДЫ УПРАВЛЕНИЯ

---

### `deliver(roomName, resource, target, targetLabId, amount)` — создать доставку вручную

```js
deliver("E35S39", "H", "storage", null, 8900); // вывезти минерал в storage
deliver("E35S37", "energy", "factory", null, 5000); // энергию на фабрику
deliver("E35S37", "KH", "lab", "67e224dd...", 1000); // реагент в лаб
```

---

### `sendResource(from, to, resource, amount)` — отправить через terminal _(NEW v3.0)_

Немедленная ручная отправка ресурса из одной комнаты в другую через terminal.
Проверяет cooldown и наличие ресурса перед отправкой.

```js
sendResource("E35S37", "E37S37", "KH", 3000);
sendResource("E35S37", "E37S37", "energy", 50000);
```

---

### `clearCreep('name')` — сбросить память крипа

Очищает deliveryAssignment, deliveryState, task, working. Крип перейдёт в idle.

```js
clearCreep("test_deliveryWorker_80451022");
```

---

### `resetFactory('E35S37')` — сбросить состояние фабрики

Переводит фабрику в статус `queued`. Использовать если застряла в `error` или `waiting_input`.

```js
resetFactory("E35S37");
```

---

### `resetRoom('E35S37')` — очистить все deliveries комнаты

```js
resetRoom("E35S37");
// LogisticsDirector создаст новые через 5 тиков
```

---

### `killDelivery('E35S37', id)` — отменить конкретную delivery

ID — это значение поля `createdAt` у delivery.

```js
killDelivery("E35S37", 80451000);
```

---

### `setFactoryProduct('E35S37', 'battery')` — сменить продукт фабрики

```js
setFactoryProduct("E35S37", "battery");
```

---

## УПРАВЛЕНИЕ ДИАГНОСТИКОЙ

```js
diagOn(); // включить подробные [DIAG] логи
diagOff(); // выключить
autoRefill(); // купить Z и O если < 10000 (запускается автоматически каждые 1000 тиков)
```

---

## ТИПИЧНЫЕ СЦЕНАРИИ

---

### Крип стоит и кричит "Жду"

```js
creepDiag("test_deliveryWorker_80451022");
logistics();
deliver("E35S37", "energy", "factory", null, 5000);
clearCreep("test_deliveryWorker_80451022");
```

---

### Фабрика не работает

```js
factory("E35S37");
logistics();
deliver("E35S37", "energy", "factory", null, 5000);
resetFactory("E35S37"); // если в error
```

---

### Лаба голодает (нет реагентов)

```js
labs("E35S37"); // смотрим что нужно
terminal("E35S37"); // есть ли ресурс в другой комнате
sendResource("E37S37", "E35S37", "H", 3000); // отправляем вручную
deliver("E35S37", "H", "lab", "67e224dd...", 1000); // доставляем в лабу
```

---

### Дисбаланс между комнатами

```js
balance(); // находим дисбаланс
sendResource("E35S37", "E37S37", "energy", 50000); // выравниваем вручную
```

---

### Логистика рассинхронизирована

```js
resetRoom("E35S37");
```

---

### Быстрая проверка всего

```js
empire();
roomHealth("E35S37");
```

---

## СЫРЫЕ ДАННЫЕ

```js
JSON.stringify(Memory.empire.factory.rooms);
JSON.stringify(Memory.empire.logistics.deliveries["E35S37"]);
JSON.stringify(Memory.empire.economy["battery"]);
JSON.stringify(Memory.empire.dispatcherMeta);
JSON.stringify(Memory.empire.market);
JSON.stringify(Memory.empire.labController.rooms["E35S37"]);
JSON.stringify(Memory.creeps["test_deliveryWorker_80451022"]);
```
