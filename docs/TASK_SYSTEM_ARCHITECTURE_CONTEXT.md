# Task System Architecture Context

## Screeps Absolute Control Architecture

**Версия:** 1.0

**Назначение:** постоянный архитектурный контекст для Архитектора и Тактика.

**Статус:** утверждено после исследования логистики Overmind.

---

## 1. Цель системы

Создать **простую, предсказуемую и CPU-дешёвую систему задач**, не копируя Overmind целиком.

Главный принцип:

```text
Источник работы
      ↓
    Task
      ↓
  FIFO-очередь
      ↓
    Worker
      ↓
   Executor
```

---

## 2. Ограничения проекта

- CPU — основной ограниченный ресурс.
- shard3: лимит CPU ≈ 20.
- Живая империя должна оставаться работоспособной.
- Изменения — небольшими и обратимыми.
- Не использовать тяжёлые scheduler/dispatcher/assignmentEngine.

---

## 3. Экономический контекст

В империи:

- энергии много;
- батареек много;
- кредитов ≈ 2 млрд.

Следствие:

- система **не должна строиться вокруг экономии энергии**;
- приоритет — **автоматическое распределение и использование избытков**.

---

## 4. Семь постоянных задач

Порядок выполнения фиксирован:

```js
const TASK_CHAIN = [
  "fillSpawnsExtensions",
  "fillTerminals",
  "operateFactory",
  "repairStructures",
  "buildStructures",
  "fillTowers",
  "upgradeController",
];
```

Это **не события**, а **постоянные функции империи**.

Worker проходит цепочку циклически.

---

## 5. Когда задача считается завершённой

Worker переходит к следующей задаче, если:

1. цель достигнута;
2. задача невозможна в текущий момент;
3. закончилась энергия/ресурс;
4. цель перестала существовать.

---

## 6. Минимальные модули системы

```text
task.manager.js
task.executors.js
worker.runner.js
tasks.js
```

### task.manager.js

Отвечает за:

- хранение TASK_CHAIN;
- выдачу следующей задачи;
- завершение/освобождение задачи;
- переход Worker к следующей задаче.

### task.executors.js

Исполнители:

```text
executeFillSpawnsExtensions()
executeFillTerminals()
executeOperateFactory()
executeRepair()
executeBuild()
executeFillTowers()
executeUpgrade()
```

### worker.runner.js

Цикл Worker:

```text
получить задачу
    ↓
выполнить
    ↓
проверить результат
    ↓
завершить / пропустить
    ↓
взять следующую
```

---

## 7. Универсальный формат Task

### Логистическая задача

```js
{
    type: 'transfer',
    sourceId: '...',
    targetId: '...',
    resourceType: RESOURCE_ENERGY,
    amount: 50000
}
```

### Строительство

```js
{
    type: 'build',
    targetId: '...'
}
```

### Ремонт

```js
{
    type: 'repair',
    targetId: '...'
}
```

### Апгрейд

```js
{
    type: 'upgrade',
    targetId: '...'
}
```

**Важно:** один механизм должен работать для энергии, батареек, минералов и любых других ресурсов.

---

## 8. Что было найдено в Overmind

### LogisticsRequest

```ts
interface LogisticsRequest {
  id: string;
  target: LogisticsTarget;
  amount: number;
  dAmountdt: number;
  resourceType: ResourceConstant | "all";
  multiplier: number;
}
```

Главный вывод:

> **Заявка — отдельный объект между потребностью и исполнителем.**

---

## 9. requestInput()

Схема Overmind:

```text
обнаружили потребность
      ↓
requestInput()
      ↓
LogisticsRequest
      ↓
requests[]
```

То есть объект сначала **определяет потребность**, а не Worker ищет её самостоятельно.

---

## 10. requestOutput()

Overmind использует тот же механизм для вывоза ресурсов:

```text
requestOutput()
requestOutputMinerals()
```

Вывод:

> **Один механизм должен обслуживать и вход, и выход ресурсов.**

---

## 11. Matching в Overmind

Найдено:

```ts
this._matching = this.stableMatching(transporters);
```

И затем:

```ts
const request = this.colony.logisticsNetwork.matching[transporter.name];
```

Полная цепочка Overmind:

```text
объект
  ↓
requestInput / requestOutput
  ↓
LogisticsRequest
  ↓
requests[]
  ↓
stableMatching()
  ↓
matching[worker.name]
  ↓
handleTransporter(worker, request)
  ↓
исполнение
```

---

## 12. Что НЕ копируем из Overmind

Не использовать:

```text
stableMatching
scheduler
dispatcher
assignmentEngine
сложную систему предпочтений
```

Причина:

- слишком дорого по CPU;
- избыточно для нашей архитектуры;
- усложняет диагностику.

---

## 13. TerminalNetwork

### Обязательный отдельный модуль

```text
terminalNetwork.js
```

Он отвечает за:

- межкомнатную балансировку;
- поиск избытка/дефицита;
- подготовку торговых операций;
- работу со всеми ресурсами.

### Важно

**TerminalNetwork НЕ таскает ресурсы Worker'ом.**

Он только принимает решения:

```text
что
куда
сколько
купить/продать
```

Физическое перемещение выполняет система задач.

---

## 14. Разделение ответственности Terminal

### TerminalNetwork

```text
определение потребности
межкомнатные решения
торговля
```

### Worker / Task System

```text
Storage → Terminal
Terminal → Storage
```

---

## 15. Фабрики

В текущей империи фабрики производят **только батарейки**.

Поэтому отдельный FactoryNetwork пока не нужен.

### Логика

```text
если cooldown == 0
и есть ресурсы
    ↓
produce(RESOURCE_BATTERY)
```

### Задачи Worker

```text
Storage → Factory
Factory → Storage / Terminal
```

---

## 16. Остальные задачи

### fillSpawnsExtensions

```text
Storage → Spawns / Extensions
```

### fillTowers

Использовать единый порог:

```js
refillTowersBelow;
```

Один источник истины для генератора и исполнителя.

### buildStructures

Модель уже понятна:

```text
ConstructionSite
    ↓
BuildPriorities
    ↓
Tasks.build(target)
```

### repairStructures

В основных 5 комнатах контейнерная логика не нужна без необходимости.

### upgradeController

Подпись controller — **не владение комнатой**.

Remote-комнаты обслуживаются отдельной ролью **reserver**.

---

## 17. Полезные JS/TS выводы

### interface

Интерфейсы существуют только в **TypeScript**.

В обычном JavaScript интерфейсов нет.

### this

`this` — ссылка на **конкретный экземпляр объекта**, на котором вызван метод.

### Object.defineProperty

Используется для ленивого кэширования:

```js
Object.defineProperty(Room.prototype, 'constructionSites', {
    get() { ... }
});
```

Полезно для CPU, но применять только там, где это действительно уменьшает количество `FIND_*`.

---

## 18. Производительность

Приоритеты:

1. хранить постоянные ID;
2. минимизировать `FIND_*`;
3. использовать кэш;
4. не пересчитывать одинаковые данные несколькими модулями;
5. не создавать лишние уровни архитектуры.

---

## 19. Критически важное правило

### Единое условие

Условие появления задачи и условие её исполнения **должны быть одинаковыми**.

### Плохо

```text
generator:
    factory.cooldown === 0

executor:
    cooldown не проверяет
```

### Хорошо

```text
одна политика
    ↓
generator
    ↓
executor
```

---

## 20. Целевая архитектура

```text
              ┌────────────────────┐
              │  Постоянные задачи │
              └─────────┬──────────┘
                        ↓
                  Task Manager
                        ↓
                    FIFO Queue
                        ↓
                ┌───────┴───────┐
                │    Workers    │
                │     1..N      │
                └───────┬───────┘
                        ↓
                  Task Executors
```

Отдельно:

```text
TerminalNetwork
       ↓
межкомнатные решения
       ↓
Task System
       ↓
Worker
```

---

## 21. Порядок реализации

### Этап 1

Зафиксировать формат `Task`.

### Этап 2

Реализовать `task.manager`.

### Этап 3

Реализовать `worker.runner`.

### Этап 4

Реализовать `task.executors`.

### Этап 5

Подключать задачи **по одной**.

---

## 22. Рекомендуемый порядок тестирования

```text
1. fillSpawnsExtensions
2. fillTowers
3. buildStructures
4. repairStructures
5. upgradeController
6. fillTerminals
7. operateFactory
```

---

## 23. Критерии готовности

Система считается рабочей, если:

- один Worker выполняет все 7 задач;
- несколько Worker не берут одну и ту же работу одновременно;
- Worker корректно переходит к следующей задаче;
- невозможная задача не блокирует очередь;
- отсутствие энергии не блокирует остальных Worker;
- TerminalNetwork может создавать работу для локальной доставки;
- Factory может создавать работу для доставки ресурсов и вывоза батареек;
- разные ресурсы используют один механизм transfer;
- живая империя остаётся работоспособной на каждом промежуточном этапе.

---

## 24. Главный архитектурный вывод

Из Overmind берём **идею**, а не код:

```text
потребность
   ↓
заявка
   ↓
назначение
   ↓
исполнение
```

У себя оставляем:

```text
простая заявка
   ↓
FIFO
   ↓
Worker
   ↓
Executor
```

Это обеспечивает:

- низкую CPU-нагрузку;
- простую диагностику;
- поддержку любого количества Worker;
- единый механизм ресурсов;
- интеграцию TerminalNetwork;
- интеграцию Factory;
- возможность постепенного расширения без массового рефакторинга.

---

## 25. Правило проекта

> **Если для реализации очередной функции требуется существенно усложнить эту схему, сначала остановиться и пересмотреть решение, а не автоматически добавлять новый уровень архитектуры.**
