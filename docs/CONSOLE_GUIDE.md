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

Показывает:

- RCL
- энергия в storage и terminal
- состояние фабрики (статус, задача, store)
- список крипов по ролям

**Пример:**

```js
room("E35S37");
```

```
========== КОМНАТА: E35S37 ==========
  RCL:      8
  Storage:  268543
  Terminal: 100005
  Factory:  status=producing task=battery
    store: energy=4800 battery=1200
  Крипов:   10
    test_deliveryWorker: 1
    test_miner: 2
    test_worker: 1
======================================
```

---

### `diag('E35S37')` — полная диагностика комнаты

Показывает всё что `room()` плюс:

- зависшие крипы
- проблемы с линками
- состояние каждого крипа подробно

**Пример:**

```js
diag("E35S37");
```

---

### `creepDiag('test_deliveryWorker_80451022')` — диагностика крипа

Показывает:

- роль, комната, позиция
- текущее состояние (deliveryState / task)
- store (что несёт)
- текущее assignment и его статус в logistics
- есть ли невалидные ID в памяти
- зависший или нет

**Пример:**

```js
creepDiag("test_deliveryWorker_80451022");
```

```
========== ДИАГНОСТИКА КРИПА: test_deliveryWorker_80451022 ==========
  role:          test_deliveryWorker
  room:          E35S37
  pos:           [room E35S37 pos 23,18]
  deliveryState: cycle_deliver
  store:         {"energy":500}
  assignment:    energy → factory_cycle [80451000]
  delivery:      delivering
=====================================================================
```

---

### `factory('E35S37')` — состояние фабрики

Показывает:

- статус (producing / waiting_input / cooldown / idle)
- текущая задача
- cooldown
- содержимое store фабрики
- активные deliveries для этой комнаты

**Пример:**

```js
factory("E35S37");
```

---

### `links('E35S37')` — состояние линков

Показывает все линки в комнате:

- энергия и заполненность в %
- cooldown

**Пример:**

```js
links("E35S37");
```

```
========== ЛИНКИ: E35S37 ==========
  id=...a3f12c energy=800 (100%) cooldown=0
  id=...b92e41 energy=0 (0%) cooldown=5
  id=...c18d77 energy=400 (50%) cooldown=0
====================================
```

---

### `logistics()` — состояние всей логистики

Показывает активные deliveries по всем комнатам (кроме completed/cancelled).

**Пример:**

```js
logistics();
```

---

### `empire()` — сводка по всей империи

Показывает:

- текущий тик
- CPU bucket
- критические и low ресурсы
- storage/terminal по каждой комнате
- состояние TaskDispatcher

**Пример:**

```js
empire();
```

---

## КОМАНДЫ УПРАВЛЕНИЯ

---

### `deliver(roomName, resource, target, targetLabId, amount)` — создать доставку вручную

Создаёт задачу доставки напрямую в logistics.
TaskDispatcher назначит её свободному воркеру.

**Параметры:**

- `roomName` — комната
- `resource` — ресурс (константа или строка)
- `target` — `'factory'` / `'storage'` / `'lab'`
- `targetLabId` — ID лаба (для lab) или `null`
- `amount` — количество

**Примеры:**

Вывезти минерал H из фабрики в storage:

```js
deliver("E35S39", "H", "storage", null, 8900);
```

Доставить энергию на фабрику:

```js
deliver("E35S37", "energy", "factory", null, 5000);
```

Доставить реагент в лаб:

```js
deliver("E35S37", "KH", "lab", "67e224dd83913309fdb87a1a", 1000);
```

---

### `clearCreep('name')` — сбросить память крипа

Очищает: deliveryAssignment, deliveryState, task, working.
Крип перейдёт в idle и получит новое задание.

**Когда использовать:** крип завис, стоит и кричит "Жду".

**Пример:**

```js
clearCreep("test_deliveryWorker_80451022");
```

---

### `resetFactory('E35S37')` — сбросить состояние фабрики

Переводит фабрику обратно в статус `queued`.
Используйте если фабрика застряла в `error` или `waiting_input` слишком долго.

**Пример:**

```js
resetFactory("E35S37");
```

---

### `resetRoom('E35S37')` — очистить все deliveries комнаты

Удаляет все записи deliveries для комнаты.
LogisticsDirector создаст новые на следующем цикле.

**Когда использовать:** deliveries полностью рассинхронизированы.

**Пример:**

```js
resetRoom("E35S37");
```

---

### `killDelivery('E35S37', 80451000)` — отменить конкретную delivery

Отменяет delivery по её `createdAt` (ID).
Чтобы узнать ID — смотрите через `logistics()` или:

```js
JSON.stringify(Memory.empire.logistics.deliveries["E35S37"]);
```

**Пример:**

```js
killDelivery("E35S37", 80451000);
```

---

## УПРАВЛЕНИЕ ДИАГНОСТИКОЙ

---

### `diagOn()` — включить подробные логи

После включения в консоли появятся `[DIAG]` сообщения:

- статус каждой фабрики каждые 50 тиков
- детали по линкам
- CPU диагностики

```js
diagOn();
```

---

### `diagOff()` — выключить подробные логи

```js
diagOff();
```

---

### `autoRefill()` — купить реагенты

Покупает Z и O если меньше 10000 в любой комнате.
Запускается автоматически раз в 1000 тиков.
Можно запустить вручную:

```js
autoRefill();
```

---

## ТИПИЧНЫЕ СЦЕНАРИИ

---

### Крип стоит и кричит "Жду"

```js
// 1. Смотрим что с крипом
creepDiag("test_deliveryWorker_80451022");

// 2. Смотрим что в логистике
logistics();

// 3. Если нет задач — создаём вручную
deliver("E35S37", "energy", "factory", null, 5000);

// 4. Если крип завис — сбрасываем
clearCreep("test_deliveryWorker_80451022");
```

---

### Фабрика не работает

```js
// 1. Смотрим состояние
factory("E35S37");

// 2. Если waiting_input — проверяем есть ли доставка
logistics();

// 3. Если нет — создаём вручную
deliver("E35S37", "energy", "factory", null, 5000);

// 4. Если фабрика в error — сбрасываем
resetFactory("E35S37");
```

---

### В фабрике лежит лишний минерал

```js
// Вывезти в storage
deliver("E35S39", "H", "storage", null, 8900);
```

---

### Логистика полностью рассинхронизирована

```js
// Сбросить все deliveries комнаты
resetRoom("E35S37");
// LogisticsDirector сам создаст новые через 5 тиков
```

---

### Быстрая проверка всей империи

```js
empire();
```

---

## ПАМЯТЬ И ДАННЫЕ

Если нужно посмотреть сырые данные:

```js
// Состояние фабрик
JSON.stringify(Memory.empire.factory.rooms);

// Deliveries комнаты
JSON.stringify(Memory.empire.logistics.deliveries["E35S37"]);

// Состояние экономики
JSON.stringify(Memory.empire.economy["battery"]);

// Диспетчер
JSON.stringify(Memory.empire.dispatcherMeta);

// Память крипа
JSON.stringify(Memory.creeps["test_deliveryWorker_80451022"]);
```
