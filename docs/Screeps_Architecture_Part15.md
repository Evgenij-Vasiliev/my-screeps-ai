# Screeps — Архитектура зрелой империи

## Часть 15. Event System (Система событий)

---

# Главная идея

К этому моменту архитектура уже содержит:

```text id="e1"
Intelligence

Goals

Strategy

Policy

Operations

Flows

Logistics

Tasks
```

---

Возникает новая проблема.

---

Как всем этим системам общаться?

---

Наивный вариант:

```js id="e2"
if (...) {
    ...
}
```

---

Потом:

```js id="e3"
if (...) {
    ...
}
```

---

Потом ещё:

```js id="e4"
if (...) {
    ...
}
```

---

Через несколько месяцев получается:

```text id="e5"
Спагетти из зависимостей.
```

---

Event System решает именно эту проблему.

---

# Что такое событие

Событие — это сообщение о произошедшем факте.

---

Например:

```text id="e6"
Комната потеряла Storage.
```

---

или:

```text id="e7"
Операция завершена.
```

---

или:

```text id="e8"
Появился враг.
```

---

# Главное правило

Событие сообщает:

```text id="e9"
Что произошло.
```

---

Событие НЕ сообщает:

```text id="e10"
Что делать.
```

---

Это принципиально важно.

---

# Пример

Плохо:

```text id="e11"
Враг появился.

Нужно построить башню.
```

---

Хорошо:

```text id="e12"
hostileDetected
```

---

А дальше разные системы сами решают, что делать.

---

# Аналогия

Пожарная сигнализация.

---

Она сообщает:

```text id="e13"
Пожар.
```

---

Она не говорит:

```text id="e14"
Как тушить.
```

---

# Event Driven Architecture

Очень популярная архитектура.

---

Схема:

```text id="e15"
Producer
      ↓

Event
      ↓

Subscribers
```

---

# Producer

Источник события.

---

Например:

```text id="e16"
State System
```

---

обнаруживает:

```text id="e17"
Hostile
```

---

и публикует:

```js id="e18"
hostileDetected;
```

---

# Subscriber

Подписчик на событие.

---

Например:

```text id="e19"
Military System
```

---

слушает:

```js id="e20"
hostileDetected;
```

---

и реагирует.

---

# Один ко многим

Главное преимущество.

---

Одно событие:

```text id="e21"
hostileDetected
```

---

могут использовать:

```text id="e22"
Military

Strategy

Intel

Reports

Notifications
```

---

Одновременно.

---

# Типичные события

---

## Room Events

---

```text id="e23"
roomClaimed

roomLost

roomDeveloped
```

---

## Economy Events

---

```text id="e24"
energyLow

energySurplus

bankrupt
```

---

## Military Events

---

```text id="e25"
hostileDetected

attackStarted

attackEnded
```

---

## Operation Events

---

```text id="e26"
operationCreated

operationStarted

operationCompleted
```

---

## Goal Events

---

```text id="e27"
goalCreated

goalCompleted

goalFailed
```

---

# Event Object

Обычно событие содержит данные.

---

Пример:

```js id="e28"
{
    type: "hostileDetected",

    room: "W8N3",

    tick: Game.time
}
```

---

# Event Bus

Центральный канал передачи событий.

---

Пример:

```js id="e29"
eventBus.emit(...)
```

---

и

```js id="e30"
eventBus.on(...)
```

---

Все системы работают через него.

---

# Event Queue

Часто используется очередь.

---

Например:

```js id="e31"
Memory.events;
```

---

или:

```js id="e32"
global.events;
```

---

События сначала записываются.

---

Потом обрабатываются.

---

# События против опроса

Без Event System:

```js id="e33"
if (hostiles.length > 0)
```

каждый тик.

---

Во многих местах.

---

С Event System:

```text id="e34"
hostileDetected
```

один раз.

---

# Loose Coupling

Главное архитектурное преимущество.

---

Без событий:

```text id="e35"
Military знает про Economy.

Economy знает про Operations.

Operations знают про Planning.
```

---

Получается сеть зависимостей.

---

С событиями:

```text id="e36"
Все знают только Event Bus.
```

---

# История событий

Очень полезная практика.

---

Например:

```js id="e37"
eventHistory;
```

---

Позволяет анализировать:

```text id="e38"
Что произошло?
Когда произошло?
Почему произошло?
```

---

# Event Sourcing

Очень продвинутая концепция.

---

Вместо хранения состояния:

```text id="e39"
Храним историю событий.
```

---

Например:

```text id="e40"
roomClaimed

roomDeveloped

roomLost
```

---

По истории можно восстановить состояние.

---

# Priority Events

Некоторые события важнее других.

---

Например:

```text id="e41"
hostileDetected
```

---

должно обрабатываться раньше чем:

```text id="e42"
roadBuilt
```

---

# Delayed Events

Иногда полезно отложить событие.

---

Пример:

```js id="e43"
{
  executeAt: Game.time + 100;
}
```

---

Получается встроенный таймер.

---

# Event Aggregation

Очень полезная техника.

---

Вместо:

```text id="e44"
100 событий
```

---

создаётся:

```text id="e45"
1 агрегированное событие
```

---

Например:

```text id="e46"
energyCrisis
```

---

вместо сотни сообщений:

```text id="e47"
containerEmpty
```

---

# Реакция нескольких систем

Пример.

---

Событие:

```text id="e48"
roomLost
```

---

Military:

```text id="e49"
Останавливает оборону.
```

---

Economy:

```text id="e50"
Пересчитывает баланс.
```

---

Strategy:

```text id="e51"
Меняет планы развития.
```

---

Intel:

```text id="e52"
Обновляет карту.
```

---

Никто напрямую друг друга не вызывает.

---

# Типичная структура модулей

```text id="e53"
events/

├─ event.bus.js
├─ event.manager.js
├─ event.queue.js
├─ event.history.js
├─ event.types.js
├─ event.priority.js
├─ event.scheduler.js
└─ event.report.js
```

---

# Полный цикл

```text id="e54"
Producer
      ↓

Event
      ↓

Event Bus
      ↓

Subscribers
      ↓

Actions
```

---

# Event System как нервная система

Очень хорошая аналогия.

---

Империя состоит из органов.

---

```text id="e55"
Economy

Military

Planning

Strategy

Goals
```

---

Event System является:

```text id="e56"
Нервной системой.
```

---

Через неё распространяются сигналы.

---

# Главное отличие от Command System

Command:

```text id="e57"
Что нужно сделать?
```

---

Event:

```text id="e58"
Что произошло?
```

---

Command идёт сверху вниз.

---

Event распространяется во все стороны.

---

# Главный архитектурный эффект

После появления Event System архитектура перестаёт быть набором модулей.

---

Она превращается в:

```text id="e59"
Операционную систему империи.
```

---

Каждая система становится независимым сервисом.

---

И может развиваться отдельно от остальных.

---

# Полная зрелая архитектура

```text id="e60"
Player
      ↓

Control
      ↓

Goals
      ↓

Strategy
      ↓

Policy
      ↓

Operations
      ↓

Event Bus
      ↓

Flows
      ↓

Logistics
      ↓

Tasks
      ↓

Executors
      ↓

Creeps
```

---

# Главные выводы

1. Event System отвечает за обмен информацией между системами.

2. События сообщают факты, а не решения.

3. Одно событие может обслуживать множество подписчиков.

4. Event Bus уменьшает связанность модулей.

5. События позволяют строить масштабируемую архитектуру.

6. История событий полезна для анализа и отладки.

7. Event System превращает набор модулей в единую платформу.

8. Это один из последних признаков по-настоящему зрелой архитектуры.

---

# Что находится выше Event System?

На практике остаётся только один уровень.

---

```text id="e61"
Vision System
```

или

```text id="e62"
Empire Doctrine
```

---

Это уже не техническая система.

Это ответ на вопрос:

```text id="e63"
Какой должна стать империя?
```

---

Например:

```text id="e64"
Максимальный рост

Военное доминирование

Полная автономность

Минимальный CPU

Максимальная прибыль
```

---

Именно оттуда рождаются все цели, стратегии и правила всей архитектуры.
