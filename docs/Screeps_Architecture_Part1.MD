# Архитектуры высокого уровня в Screeps

## Главный принцип

У сильных игроков решения принимаются на разных уровнях абстракции.

```text
ИМПЕРИЯ
    ↓
КОМНАТА
    ↓
СИСТЕМА
    ↓
ГРУППА КРИПОВ
    ↓
КРИП
```

Каждый уровень отвечает только за свой горизонт планирования.

---

# Уровень 1 — Империя

Империя является стратегическим штабом.

Она отвечает за:

- развитие комнат;
- поддержку слабых комнат;
- распределение ресурсов;
- экспансию;
- военные операции;
- торговлю;
- глобальную экономику.

Примеры решений:

```text
Отправить энергию из комнаты A в комнату B.
Запустить новую колонию.
Начать военную операцию.
```

---

# Уровень 2 — Комната

Комната — автономная экономическая единица.

Отвечает за:

- энергетику;
- логистику;
- оборону;
- строительство;
- добычу;
- спавн крипов.

Структура:

```text
ROOM

├─ Economy
├─ Logistics
├─ Defense
├─ Spawn
├─ Construction
└─ Remote Mining
```

---

# Уровень 3 — Системы

Комната состоит из независимых сервисов.

Примеры:

```text
Energy System
Logistics System
Spawn System
Defense System
Lab System
Market System
```

Каждая система отвечает только за свою область ответственности.

---

# Энергетическая система

Задачи:

- анализ запасов энергии;
- анализ доходов;
- анализ расходов;
- определение состояния комнаты.

Возможные состояния:

```text
CRITICAL
LOW
NORMAL
SURPLUS
```

Энергия становится управляющим сигналом для других систем.

---

# Логистическая система

Отвечает только за перемещение ресурсов.

Пример задачи:

```js
{
    from: storage.id,
    to: spawn.id,
    resource: RESOURCE_ENERGY,
    amount: 300
}
```

Логистика управляет потоками ресурсов, а не отдельными крипами.

---

# Военная система

Иерархия:

```text
Empire
   ↓
Operation
   ↓
Squad
   ↓
Creep
```

Империя определяет цель.

Военная система определяет состав сил.

Пример:

```text
2 Healer
3 Attacker
1 Dismantler
```

---

# Уровень групп

Промежуточный уровень между комнатой и крипом.

Примеры:

```text
Mining Team
Remote Team
Builder Team
Attack Squad
```

Комната управляет группой, а не каждым крипом отдельно.

---

# Уровень крипа

Крип является исполнителем.

Он не принимает стратегических решений.

Пример задачи:

```js
{
    action: "withdraw",
    target: storage.id
}
```

Крип выполняет задачу и ожидает следующую.

---

# Пирамида принятия решений

```text
EMPIRE
│
├─ Стратегия
│
ROOM
│
├─ Тактика
│
SYSTEM
│
├─ Планирование
│
GROUP
│
├─ Координация
│
CREEP
│
└─ Исполнение
```

---

# Сервисная архитектура

Наиболее зрелые империи строятся как набор сервисов.

```text
Empire

├─ Intelligence Service
├─ Economy Service
├─ Logistics Service
├─ Military Service
├─ Market Service
├─ Expansion Service
├─ Planning Service
└─ Room Service
```

---

# Пример структуры модулей

## Имперский уровень

```text
src/

├─ empire/
│
├─ empire.js
├─ empire.economy.js
├─ empire.logistics.js
├─ empire.market.js
├─ empire.military.js
├─ empire.expansion.js
├─ empire.intelligence.js
├─ empire.diplomacy.js
├─ empire.planner.js
└─ empire.report.js
```

Пример выполнения:

```js
empire.run();
```

Внутри:

```js
empire.intelligence.run();
empire.economy.run();
empire.market.run();
empire.expansion.run();
empire.military.run();
roomManager.run();
```

---

## Уровень комнат

```text
room/

├─ room.manager.js
├─ room.state.js
├─ room.planner.js
├─ room.spawn.js
├─ room.energy.js
├─ room.logistics.js
├─ room.defense.js
├─ room.construction.js
├─ room.remote.js
├─ room.labs.js
├─ room.factory.js
└─ room.observer.js
```

Каждая комната запускает:

```js
room.energy.run(room);
room.logistics.run(room);
room.spawn.run(room);
room.defense.run(room);
```

---

## Логистическая система

```text
logistics/

├─ logistics.manager.js
├─ logistics.network.js
├─ logistics.requests.js
├─ logistics.scheduler.js
├─ logistics.dispatcher.js
└─ logistics.report.js
```

---

## Энергетическая система

```text
energy/

├─ energy.manager.js
├─ energy.analyzer.js
├─ energy.forecast.js
├─ energy.policy.js
└─ energy.report.js
```

Выход системы:

```js
{
  state: "critical";
}
```

или

```js
{
  state: "surplus";
}
```

---

## Спавн-система

```text
spawn/

├─ spawn.manager.js
├─ spawn.quota.js
├─ spawn.priority.js
├─ spawn.queue.js
├─ spawn.bodybuilder.js
└─ spawn.report.js
```

Комната сообщает потребность:

```js
{
    miner: 2,
    hauler: 4
}
```

Спавн определяет порядок производства.

---

## Военная система

```text
military/

├─ military.manager.js
├─ military.operations.js
├─ military.intelligence.js
├─ military.squads.js
├─ military.spawn.js
├─ military.commands.js
└─ military.report.js
```

---

## Разведка

```text
intel/

├─ intel.manager.js
├─ intel.rooms.js
├─ intel.hostiles.js
├─ intel.resources.js
├─ intel.expansion.js
└─ intel.report.js
```

---

## Планировщик

```text
planner/

├─ planner.manager.js
├─ planner.room.js
├─ planner.remote.js
├─ planner.roads.js
├─ planner.stamps.js
└─ planner.report.js
```

Планировщик отвечает за проектирование, а не выполнение.

---

## Система задач

```text
tasks/

├─ task.manager.js
├─ task.queue.js
├─ task.dispatcher.js
├─ task.types.js
└─ task.report.js
```

Типовая задача:

```js
{
    type: "transfer",
    from: storage.id,
    to: spawn.id,
    amount: 300
}
```

---

## Система операций

```text
operations/

├─ operation.manager.js
├─ operation.remoteMining.js
├─ operation.attack.js
├─ operation.claim.js
├─ operation.bootstrap.js
└─ operation.report.js
```

Операция может управлять несколькими комнатами и десятками крипов.

---

## Уровень крипов

```text
creep/

├─ creep.manager.js
├─ creep.task.js
├─ creep.move.js
├─ creep.actions.js
└─ creep.report.js
```

Крип получает задачу:

```js
{
    action: "withdraw",
    target: storage.id
}
```

и выполняет её.

---

# Формула зрелой архитектуры

```text
Empire решает ЧТО делать.

Room решает КАК делать.

System решает ЧЕМ делать.

Creep выполняет.
```
