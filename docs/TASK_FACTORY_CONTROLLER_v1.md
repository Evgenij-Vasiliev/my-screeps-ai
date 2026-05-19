# TASK: FACTORY CONTROLLER v1

Статус: IMPLEMENTATION TASK

---

# КОНТЕКСТ

В империи уже существуют:

```text id="k5m8qa"
EmpireResourceRegistry v2
EconomyManager v1
FactoryDirector v1
```

Pipeline уже построен:

```text id="f2q7wr"
Data
↓
Analysis
↓
Planning
↓
Execution   ← СЕЙЧАС СТРОИМ ЭТОТ LAYER
```

---

# ЦЕЛЬ

Создать систему:

```text id="z4n1pt"
FactoryController
```

которая:

- исполняет factory tasks;
- вызывает factory.produce();
- управляет runtime execution;
- обновляет execution status.

---

# MAIN RESPONSIBILITY

FactoryController отвечает на вопрос:

```text id="y7v3kx"
Как выполнить production task в конкретной комнате?
```

---

# ВАЖНО

FactoryController:

- НЕ принимает strategic decisions;
- НЕ анализирует economy;
- НЕ строит production queues;
- НЕ назначает задачи;
- НЕ управляет market;
- НЕ управляет logistics.

FactoryController:

- pure execution layer;
- runtime industrial executor.

---

# INPUTS

FactoryController читает:

```js id="u3m9wr"
factoryDirector.getTask(room.name);
factoryDirector.hasTask(room.name);
```

---

# OUTPUTS

FactoryController обновляет:

```js id="p6x2qt"
Memory.empire.factory.rooms[roomName].status;
```

---

# TARGET STATUS FLOW

Минимум поддерживать:

```text id="n8q5vp"
queued
producing
cooldown
waiting_input
done
error
```

---

# EXECUTION RULES

---

# 1. Проверка factory existence

Если factory отсутствует:

```text id="r5m1zn"
status = 'error'
```

---

# 2. Проверка cooldown

Если:

```js id="d7w4kx"
factory.cooldown > 0;
```

тогда:

```text id="c2v9qa"
status = 'cooldown'
```

---

# 3. Проверка ресурсов

Перед produce():

- проверить наличие input ресурсов;
- НЕ вызывать produce если inputs отсутствуют.

Если ресурсов недостаточно:

```text id="x8m3pt"
status = 'waiting_input'
```

---

# 4. Execution

Если всё готово:

```js id="q1k7wr"
factory.produce(task.resource);
```

---

# 5. Result handling

Если produce OK:

```text id="t4v2zn"
status = 'producing'
```

Если ошибка:

```text id="f9m5qx"
status = 'error'
```

---

# ВАЖНО

FactoryController НЕ ДОЛЖЕН:

- хранить production strategy;
- менять priorities;
- принимать economic decisions;
- назначать новые tasks;
- сканировать все комнаты.

---

# ROOM-LEVEL DESIGN

FactoryController должен:

- работать per-room;
- вызываться из roomManager;
- контролировать только local room factory.

---

# CPU REQUIREMENTS

FactoryController должен:

- быть lightweight;
- НЕ делать heavy scans;
- использовать existing planning layer.

---

# DEBUGGING

Добавить:

- throttled logs;
- execution summaries;
- count active productions;
- count waiting_input rooms.

Без console spam.

---

# PUBLIC API

Минимум:

```js id="m7q2wr"
run(room);
```

---

# VALIDATION REQUIRED

После реализации предоставить:

- execution flow;
- runtime status examples;
- Memory state transitions;
- CPU measurements;
- integration analysis;
- error handling validation;
- scaling analysis.

---

# ГЛАВНЫЙ ПРИНЦИП

FactoryController — это:

```text id="w2x8kv"
Industrial Runtime Execution Layer
```

а НЕ planning system.
