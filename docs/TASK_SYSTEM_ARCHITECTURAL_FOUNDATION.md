Конечно. Вот сам документ — можно сохранить в проекте как:

`docs/Task System — Архитектурный фундамент.md`

````md
# Task System — Архитектурный фундамент

**Проект:** Screeps Absolute Control Architecture  
**Система:** Task System  
**Версия:** 1.0  
**Статус:** Архитектурные решения зафиксированы

---

## 1. Главный принцип

Система задач строится по простой схеме:

Потребность  
↓  
Task  
↓  
FIFO  
↓  
Worker  
↓  
Executor

Не используются:

- scheduler;
- dispatcher;
- assignmentEngine;
- stableMatching;
- сложная система priority;
- отдельный Task Registry.

Главный критерий — простота, предсказуемость и низкая CPU-нагрузка.

---

## 2. TASK_CHAIN

`TASK_CHAIN` — это не очередь конкретных заявок.

Это фиксированная последовательность функций Worker:

```js
const TASK_CHAIN = [
  "fillSpawnsExtensions",
  "fillPowerSpawn",
  "fillTerminals",
  "operateFactory",
  "repairStructures",
  "buildStructures",
  "fillTowers",
  "upgradeController",
];
```
````

Worker циклически проходит эти типы задач.

`taskType` определяет категорию работы.

---

## 3. Task и taskType — разные понятия

### taskType

Категория очереди:

```text
fillSpawnsExtensions
fillPowerSpawn
fillTerminals
operateFactory
repairStructures
buildStructures
fillTowers
upgradeController
```

### task.type

Тип физической операции:

```text
transfer
build
repair
upgrade
```

Например:

```js
{
    type: "transfer",
    sourceId: "...",
    targetId: "...",
    resourceType: RESOURCE_ENERGY
}
```

---

## 4. Кто создаёт Task

Task создаёт **источник потребности**.

Task Manager не определяет, нужна ли работа.

Пример:

```text
Extension
    ↓
обнаружена потребность в энергии
    ↓
fillSpawnsExtensions
    ↓
создаёт Task
    ↓
Task Manager
    ↓
FIFO
```

Аналогично:

```text
PowerSpawn → fillPowerSpawn
Terminal    → fillTerminals
Factory     → operateFactory
Structure   → repairStructures
ConstructionSite → buildStructures
Tower       → fillTowers
Controller  → upgradeController
```

---

## 5. Когда создаётся Task

Task создаётся только при наличии фактической потребности.

Алгоритм:

```text
Потребность есть?
    ↓
    нет → ничего не создавать

    да
    ↓
Такая Task уже существует?
    ↓
    да → ничего не создавать

    нет → создать Task
```

Одна и та же потребность не должна создавать бесконечное количество одинаковых Task.

---

## 6. Идентичность потребности

Отдельный `taskId` не используется.

Для логистической Task идентичность определяется:

```text
taskType + targetId + resourceType
```

Например:

```text
fillSpawnsExtensions
+
extension123
+
energy
```

означает одну конкретную потребность.

Для строительства:

```text
buildStructures + constructionSiteId
```

Для ремонта:

```text
repairStructures + structureId
```

Для upgrade:

```text
upgradeController + controllerId
```

`sourceId` не участвует в идентичности потребности.

Источник может измениться — потребность остаётся той же.

---

## 7. Task остаётся в FIFO до завершения

Это принципиальное решение.

Task **не удаляется из FIFO при выдаче Worker'у**.

Жизненный цикл:

```text
Потребность
    ↓
Task создана
    ↓
FIFO
    ↓
Worker получает Task
    ↓
Task остаётся в FIFO
    ↓
Executor выполняет Task
    ↓
DONE / SKIP
    ↓
Task удаляется из FIFO
```

Поэтому наличие Task в FIFO означает:

> эта потребность существует и ещё не завершена.

---

## 8. Почему Task не удаляется при выдаче

Если удалить Task сразу после выдачи:

```text
FIFO → Worker
```

то источник потребности увидит пустую очередь и может создать вторую Task для той же потребности.

Это приводит к дубликатам.

Поэтому:

```text
Task существует
    ↓
пока потребность не завершена
    ↓
Task остаётся в FIFO
```

---

## 9. Назначение Task Worker'у

Для предотвращения одновременного выполнения одной Task несколькими Worker используется одно служебное поле:

```js
assignedTo;
```

Пример:

```js
{
    type: "transfer",
    sourceId: "...",
    targetId: "...",
    resourceType: RESOURCE_ENERGY,
    assignedTo: "worker_123"
}
```

---

## 10. Начальное состояние Task

При создании:

```js
assignedTo: null;
```

То есть Task свободна.

```text
Task
 ↓
assignedTo = null
 ↓
FIFO
```

---

## 11. Получение Task Worker'ом

Worker смотрит первую подходящую Task.

Если:

```text
assignedTo == null
```

Worker назначает её себе:

```js
task.assignedTo = creep.name;
```

После этого:

```text
Worker 1 → Task A
```

Другой Worker не имеет права взять эту же Task.

---

## 12. Несколько Worker

Например:

```text
FIFO:

Task A
Task B
Task C
```

Есть:

```text
Worker 1
Worker 2
```

Worker 1 назначает:

```text
Task A → Worker 1
```

Worker 2 видит:

```text
Task A
assignedTo = Worker 1
```

и пропускает её.

Он может взять следующую свободную Task:

```text
Task B → Worker 2
```

---

## 13. Task остаётся общей заявкой

`assignedTo` — это только состояние назначения.

Это не:

- `workerId`;
- priority;
- status;
- taskId;
- отдельный registry.

Не создаётся дополнительная система управления назначениями.

---

## 14. Гибель Worker

Если Worker погиб, Task не восстанавливается искусственно.

Проверяется:

```text
assignedTo существует?
        ↓
Worker существует?
```

Если Worker больше не существует:

```text
assignedTo = null
```

Task снова становится свободной.

После этого другой Worker может её получить.

---

## 15. Executor

Executor не создаёт Task.

Executor не управляет FIFO.

Executor получает:

```text
creep
+
Task
```

и возвращает результат:

```text
CONTINUE
DONE
SKIP
```

### CONTINUE

Task остаётся:

```text
в FIFO
+
assignedTo = текущий Worker
```

Worker продолжает её выполнять.

### DONE

Потребность выполнена.

Task удаляется из FIFO.

### SKIP

Task больше невозможно выполнить или она недействительна.

Task удаляется из FIFO.

---

## 16. Ответственность Task Manager

Task Manager отвечает только за управление очередями:

```text
addTask
getNextTask
pop/assignment logic
completeTask
removeTask
```

Он не должен:

- искать объекты через `FIND_*`;
- определять потребность;
- перемещать Worker;
- делать withdraw;
- делать transfer;
- строить;
- ремонтировать;
- улучшать Controller;
- принимать экономические решения.

---

## 17. Ответственность источника потребности

Источник потребности:

1. определяет наличие потребности;
2. определяет идентичность потребности;
3. проверяет наличие существующей Task;
4. создаёт Task при необходимости;
5. передаёт Task в Task Manager.

---

## 18. Ответственность Worker

Worker:

1. проходит `TASK_CHAIN`;
2. ищет свободную Task текущего `taskType`;
3. назначает Task себе через `assignedTo`;
4. передаёт Task Executor;
5. продолжает выполнение до `DONE` или `SKIP`.

---

## 19. Ответственность Executor

Executor:

```text
Task
 ↓
физическое выполнение
 ↓
CONTINUE / DONE / SKIP
```

Executor не должен создавать новые Task.

---

## 20. Главный жизненный цикл

```text
┌─────────────────────┐
│      Потребность    │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│   Источник создаёт  │
│        Task         │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│        FIFO         │
│ assignedTo = null   │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│       Worker        │
│ назначает себя      │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│      Executor       │
└──────────┬──────────┘
           ↓
      ┌────┴────┐
      ↓         ↓
 CONTINUE    DONE/SKIP
      │         │
      ↓         ↓
   Task      Task
 остаётся   удаляется
```

---

## 21. Что принципиально НЕ добавляем

Без отдельного архитектурного решения запрещено добавлять:

```text
taskId
priority
amount
status
workerId
scheduler
dispatcher
assignmentEngine
stableMatching
Task Registry
глобальную очередь
```

Если новая функция требует нового уровня архитектуры, сначала пересматривается решение.

---

## 22. Следующий архитектурный вопрос

Следующим необходимо определить:

> **Кто и когда выполняет проверку существования одинаковой Task перед её созданием?**

После этого можно переходить к проектированию генераторов потребностей.

---

## 23. Основное правило проекта

> Если решение можно реализовать существующими механизмами без добавления нового архитектурного уровня — используется существующий механизм.

> Сначала простая модель, затем код.

> Один шаг — одно действие.

```

```
