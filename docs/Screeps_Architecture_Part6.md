# Screeps — Архитектура зрелой империи

## Часть 6. State System (Система состояний)

---

# Главная идея

Если посмотреть на уже изученную цепочку:

```text id="1n6i5a"
State
    ↓
Policy
    ↓
Operation
    ↓
Task
    ↓
Creep
```

то возникает вопрос:

```text id="q8m3r1"
Откуда берётся Policy?
```

Ответ:

```text id="s4f9v2"
Из State System
```

---

# Что такое State

State (состояние) — это описание текущей реальности.

State не принимает решений.

State не отдаёт команд.

State отвечает только на вопрос:

```text id="m7k1c8"
Что сейчас происходит?
```

---

# Самая важная мысль

State должен быть отделён от решений.

Плохо:

```js id="f2x8m4"
if (storage.store.energy < 10000) {
  stopUpgrade();
}
```

---

Здесь:

```text id="h9t3q5"
Анализ
Решение
Исполнение
```

смешаны в одном месте.

---

Хорошо:

```js id="z6p4r7"
state.energy = "LOW";
```

---

Дальше:

```text id="k3n8w2"
Policy принимает решение.
```

---

# Аналогия

Представим автомобиль.

---

State сообщает:

```text id="v7d2m9"
Скорость = 120
Топливо = 10%
Температура = высокая
```

---

State не говорит:

```text id="r5x1k6"
Нажми на тормоз.
```

---

Он только сообщает факты.

---

# Иерархия состояний

Состояния могут существовать на нескольких уровнях.

```text id="w8n4j3"
Empire State
    ↓
Room State
    ↓
System State
```

---

# Empire State

Описывает состояние всей империи.

Пример:

```js id="a4q7t1"
{
    energyTrend: "surplus",

    warMode: false,

    expansionAllowed: true,

    roomCount: 12
}
```

---

Империя получает глобальную картину мира.

---

# Room State

Описывает состояние комнаты.

Пример:

```js id="p9r6m2"
{
    energy: "low",

    defense: "safe",

    economy: "stable"
}
```

---

# System State

Состояние отдельной системы.

Например:

```js id="u3k8v4"
{
  logistics: "overloaded";
}
```

или

```js id="t5n2c7"
{
  spawn: "blocked";
}
```

---

# Почему это важно

Большинство архитектурных проблем возникает потому, что системы сами анализируют мир.

Например:

```js id="e7m4q8"
spawn.js

energy check

tower check

hostile check

storage check
```

---

Каждая система начинает дублировать анализ.

---

State System решает эту проблему.

---

# Анализ производится один раз

```text id="c8r3p6"
Game World
      ↓
State Analyzer
      ↓
State
```

---

Все остальные используют готовый результат.

---

# State Analyzer

Специализированный сервис.

Пример структуры:

```text id="x5k7t2"
state/

├─ state.manager.js
├─ state.empire.js
├─ state.room.js
├─ state.energy.js
├─ state.defense.js
├─ state.logistics.js
└─ state.report.js
```

---

# Энергетические состояния

Самый распространённый пример.

---

Вместо:

```js id="j4r8m1"
storage.store.energy;
```

используется:

```js id="g7n3v5"
roomState.energy;
```

---

Например:

```text id="s2m9k4"
CRITICAL
LOW
NORMAL
SURPLUS
```

---

# Расчёт состояния

Исходные данные:

```js id="f8q5w2"
{
    stored: 12000,

    income: 18,

    expense: 22
}
```

---

Результат:

```js id="r6t1m8"
{
  energy: "LOW";
}
```

---

# Состояние обороны

Пример:

```text id="v1n7q3"
SAFE
THREAT
UNDER_ATTACK
```

---

Исходные данные:

```text id="u4k8r6"
Количество врагов
Сила врагов
Наличие башен
```

---

Результат:

```js id="n9m2t5"
{
  defense: "UNDER_ATTACK";
}
```

---

# Состояние логистики

Пример:

```text id="w6p3j9"
NORMAL
CONGESTED
OVERLOADED
```

---

Исходные данные:

```text id="q1r7v4"
Количество задач
Свободные перевозчики
Среднее время ожидания
```

---

Результат:

```js id="m8k4t2"
{
  logistics: "OVERLOADED";
}
```

---

# Состояние спавна

Пример:

```text id="z2n6r1"
IDLE
BUSY
BLOCKED
```

---

Результат:

```js id="h5q9v7"
{
  spawn: "BLOCKED";
}
```

---

# Состояние операции

У операций тоже есть состояния.

Например:

```text id="k8m2r4"
PLANNING
STARTING
ACTIVE
COMPLETED
FAILED
```

---

Пример:

```js id="t1q7m5"
{
  operation: "ACTIVE";
}
```

---

# State как единый источник истины

Очень важная концепция.

---

Плохо:

```text id="r9v5n2"
Каждая система считает всё сама.
```

---

Хорошо:

```text id="x4m8k6"
State System считает один раз.
Все используют результат.
```

---

# Single Source of Truth

Архитектурный принцип:

```text id="g2q7r9"
Single Source of Truth
```

---

То есть:

```text id="c5n1v8"
Одни данные
Одна интерпретация
Один результат
```

---

# State Pipeline

Типичная схема зрелой архитектуры.

```text id="m3k8q2"
Game World
      ↓
Analyzers
      ↓
States
      ↓
Policies
      ↓
Operations
      ↓
Tasks
```

---

# Почему это масштабируется

Представим:

```text id="p6r2m4"
50 комнат
```

---

Без State System:

```text id="v8q5n1"
50 комнат × 10 систем
```

Каждая система анализирует мир самостоятельно.

---

С State System:

```text id="u1m7k3"
50 анализов
```

а не

```text id="w4n9q6"
500 анализов
```

---

# State Cache

Часто состояния кешируются.

Пример:

```js id="r2k8m5"
Memory.states.rooms["W8N3"];
```

---

Или:

```js id="t6v1q9"
global.states;
```

---

Чтобы не выполнять дорогие вычисления несколько раз за тик.

---

# Типичная структура объекта состояния

```js id="n3r7m1"
{
    room: "W8N3",

    energy: "LOW",

    defense: "SAFE",

    logistics: "NORMAL",

    economy: "STABLE",

    spawn: "BUSY"
}
```

---

# Главный архитектурный эффект

State отделяет:

```text id="f5m8q2"
Факты
от
Решений
```

---

State говорит:

```text id="c7r4n6"
Что происходит?
```

---

Policy говорит:

```text id="v2m9k1"
Что разрешено делать?
```

---

Operation говорит:

```text id="u8q3r5"
Какой цели нужно достичь?
```

---

Task говорит:

```text id="x1n7m4"
Какая работа должна быть выполнена?
```

---

Creep говорит:

```text id="z6r2q8"
Выполняю.
```

---

# Полная зрелая архитектура

```text id="k4m8r1"
Game World
      ↓
State System
      ↓
Policy System
      ↓
Operation System
      ↓
Task System
      ↓
Scheduler
      ↓
Dispatcher
      ↓
Executor
      ↓
Creeps
```

---

# Главные выводы

1. State — описание реальности.

2. State не принимает решений.

3. State не отдаёт команд.

4. State является источником данных для Policy System.

5. Все анализы должны выполняться централизованно.

6. State создаёт единый источник истины.

7. State значительно уменьшает дублирование логики.

8. Большинство зрелых архитектур начинается именно с качественной State System.

---

# Следующая тема

Resource Flow System

Момент, когда игрок перестаёт видеть:

```text id="a8m2q7"
Крипов
```

и начинает видеть:

```text id="r5n9v1"
Потоки ресурсов
```

Именно после этого обычно появляются по-настоящему масштабируемые логистические системы.
