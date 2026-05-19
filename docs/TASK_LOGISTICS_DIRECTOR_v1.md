# TASK: LOGISTICS DIRECTOR v1

Статус: IMPLEMENTATION TASK

---

# КОНТЕКСТ

Empire Core уже существует:

```text id="m2q7wr"
EmpireResourceRegistry v2
EconomyManager v1
FactoryDirector v1
FactoryController v1
```

Pipeline:

```text id="f9v3kx"
Data
↓
Analysis
↓
Planning
↓
Execution
↓
Bottleneck Detection   ← уже появился waiting_input
```

Теперь нужен logistics orchestration layer.

---

# ЦЕЛЬ

Создать систему:

```text id="u4x8pt"
LogisticsDirector
```

которая:

- анализирует logistics bottlenecks;
- определяет потребности фабрик;
- создаёт delivery tasks;
- orchestrates resource movement.

---

# MAIN RESPONSIBILITY

LogisticsDirector отвечает на вопрос:

```text id="p7m2zn"
Какие ресурсы куда нужно доставить?
```

---

# ВАЖНО

LogisticsDirector:

- НЕ двигает ресурсы напрямую;
- НЕ управляет worker behavior;
- НЕ вызывает transfer();
- НЕ управляет market;
- НЕ принимает economic decisions;
- НЕ строит production queues.

LogisticsDirector:

- orchestration layer;
- logistics planning layer.

---

# INPUTS

LogisticsDirector читает:

```js id="w5q1xr"
FactoryDirector.getAllTasks();

Memory.empire.factory.rooms[roomName].status;

empireResourceRegistry.getInRoom(resource, roomName);

economyManager.getState(resource);
```

---

# OUTPUTS

Публиковать:

```js id="n8v4qa"
Memory.empire.logistics;
```

---

# TARGET STRUCTURE

Пример:

```js id="r3m7wp"
Memory.empire.logistics = {
  deliveries: {
    E35S37: [
      {
        resource: RESOURCE_ENERGY,
        target: "factory",
        amount: 2000,
        priority: "high",
        createdAt: 80250000,
      },
    ],
  },
};
```

---

# DELIVERY RULES

---

# 1. waiting_input detection

Если:

```text id="c6x2zn"
factory.status === 'waiting_input'
```

тогда:

- создать delivery task;
- определить необходимые input resources.

---

# 2. Initial scope

v1 поддерживает только:

```text id="d4q9kt"
RESOURCE_ENERGY → FACTORY
```

---

# ПОЧЕМУ

v1 должен:

- доказать logistics pipeline;
- доказать orchestration;
- доказать delivery lifecycle.

Complex multi-resource logistics будет позже.

---

# 3. Priority Rules

## HIGH

Если:

```js id="k7m3wr"
economyManager.isCritical(task.resource);
```

---

## NORMAL

Во всех остальных случаях.

---

# 4. Duplicate Protection

LogisticsDirector НЕ должен:

- создавать duplicate deliveries;
- создавать бесконечные tasks каждый тик.

---

# 5. Delivery Lifecycle

Delivery task должен иметь lifecycle:

```text id="x2v8qp"
queued
assigned
delivering
completed
cancelled
```

---

# ВАЖНО

LogisticsDirector НЕ ДОЛЖЕН:

- напрямую управлять worker;
- напрямую изменять creep.memory;
- делать transfer();
- принимать tactical movement decisions.

---

# WORKER INTEGRATION

Будущий worker/task system будет:

- читать delivery tasks;
- брать assignments;
- выполнять transfer.

Но НЕ сейчас.

---

# CPU REQUIREMENTS

LogisticsDirector должен:

- быть lightweight;
- использовать existing data layers;
- НЕ делать heavy scans every tick.

---

# PUBLIC API

Минимум:

```js id="t5n1vx"
getDeliveries(roomName);
hasDeliveries(roomName);
getAllDeliveries();
```

---

# DEBUGGING

Добавить:

- throttled logging;
- delivery summaries;
- count waiting_input factories;
- count active deliveries.

Без console spam.

---

# VALIDATION REQUIRED

После реализации предоставить:

- logistics flow;
- delivery lifecycle examples;
- Memory structure;
- duplicate protection validation;
- CPU measurements;
- integration analysis;
- scaling analysis.

---

# ГЛАВНЫЙ ПРИНЦИП

LogisticsDirector — это:

```text id="g9w4kr"
Logistics Orchestration Layer
```

а НЕ transport execution system.
