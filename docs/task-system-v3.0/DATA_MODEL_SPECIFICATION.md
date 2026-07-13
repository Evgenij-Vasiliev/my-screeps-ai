# TASK SYSTEM v3.0

## Data Model Specification

---

# 1. Назначение

Документ определяет структуру данных Task System v3.0.

Все компоненты системы работают только через данные, описанные в настоящем документе.

Изменение структуры допускается только после изменения архитектурной спецификации.

---

# 2. Общая структура Memory

```text
Memory
│
├── empire
├── rooms
├── creeps
│
└── taskSystem
    ├── dispatcher
    ├── scheduler
    ├── tasks
    ├── executors
    ├── events
    ├── switches
    ├── diagnostics
    └── log
```

Task System не изменяет существующие структуры `Memory.empire`, `Memory.rooms` и `Memory.creeps`.

Все новые данные размещаются внутри `Memory.taskSystem`.

---

# 3. Dispatcher

```text
dispatcher
```

Назначение:

Хранит текущее состояние центрального диспетчера.

Основные поля:

- state
- mode
- emergency
- tick

Dispatcher не хранит игровые объекты.

Он хранит только состояние управления.

---

# 4. Scheduler

```text
scheduler
```

Назначение:

Хранит параметры планировщика.

Пример состава:

- cpuMode
- bucketMode
- energyMode
- roomPolicies
- globalPolicies

Scheduler хранит только политики.

---

# 5. Task Registry

```text
tasks
```

Единый реестр задач.

Каждая задача имеет уникальный идентификатор.

Минимальный состав записи:

```text
id
type
priority
state
owner
room
target
executor
created
updated
timeout
retries
metadata
```

---

## Возможные состояния

- created
- waiting
- ready
- assigned
- running
- completed
- failed
- cancelled
- timeout
- disabled

---

# 6. Executor Registry

```text
executors
```

Каждый исполнитель имеет запись.

Минимальный состав:

```text
id
creep
role
room
state
task
updated
disabled
```

---

Состояния:

- idle
- moving
- working
- blocked
- sleeping
- disabled
- dead

---

# 7. Event Queue

```text
events
```

Содержит события Империи.

Пример записи:

```text
id
type
room
source
priority
created
payload
```

После обработки событие удаляется либо архивируется согласно принятой политике.

---

# 8. Feature Switches

```text
switches
```

Единая система рубильников.

Структура:

```text
empire
rooms
roles
groups
managers
tasks
creeps
```

Каждый переключатель имеет единый формат:

```text
enabled
reason
updated
```

---

# 9. Diagnostics

```text
diagnostics
```

Хранит агрегированную информацию.

Например:

```text
activeTasks
waitingTasks
runningTasks
failedTasks
idleExecutors
blockedExecutors
cpu
bucket
lastTick
```

---

# 10. Logging

```text
log
```

Хранит историю событий.

Минимальная запись:

```text
tick
time
source
event
details
```

Политика хранения (размер, ротация, очистка) определяется отдельно.

---

# 11. Связи между сущностями

```text
Dispatcher
        │
        ▼
Scheduler
        │
        ▼
Task Registry
        │
        ▼
Assignment Engine
        │
        ▼
Executor Registry

Events ───────────────► Dispatcher

Switches ─────────────► Все компоненты

Watchdog ─────────────► Task Registry

Diagnostics ─────────► Все компоненты

Logging ◄──────────── Все компоненты
```

---

# 12. Принципы хранения данных

1. Один источник истины для каждой сущности.
2. Минимальное дублирование данных.
3. Хранение только необходимой информации.
4. Возможность восстановления после перезапуска.
5. Независимость компонентов друг от друга.
6. Расширение структуры без изменения существующих записей.

---

# 13. Совместимость

На период миграции допускается одновременное существование:

- существующих структур Task System v2.0;
- новой структуры `Memory.taskSystem`.

До полного завершения миграции существующая система продолжает работать без изменений.

---

# 14. Основной принцип

`Memory.taskSystem` становится единой точкой хранения состояния Task System v3.0.

Ни один компонент системы не должен создавать собственые независимые структуры данных, если соответствующая информация уже хранится в `Memory.taskSystem`.
