# TASK: FACTORY DIRECTOR v1

Статус: IMPLEMENTATION TASK

---

# КОНТЕКСТ

В империи уже существуют:

```text id="k2v8mx"
EmpireResourceRegistry v2
EconomyManager v1
```

Registry:

- агрегирует ресурсы.

EconomyManager:

- анализирует дефициты и surplus.

Теперь нужен первый industrial execution layer.

---

# ЦЕЛЬ

Создать систему:

```text id="m4q7wr"
FactoryDirector
```

которая:

- управляет factory production;
- строит production queues;
- назначает задачи фабрикам;
- поддерживает strategic reserves через производство.

---

# ВАЖНО

FactoryDirector:

- НЕ управляет market;
- НЕ управляет logistics;
- НЕ принимает room-level tactical decisions;
- НЕ сканирует ресурсы напрямую;
- НЕ анализирует economy самостоятельно.

FactoryDirector:

- execution layer;
- industrial orchestration layer.

---

# MAIN RESPONSIBILITY

FactoryDirector отвечает на вопрос:

```text id="f9w2zt"
Что должна производить каждая фабрика?
```

---

# INPUTS

FactoryDirector читает:

```js id="q5x1rn"
economyManager.getState();
economyManager.getDeficit();
economyManager.isCritical();

empireResourceRegistry.getResources();
empireResourceRegistry.getInRoom();
```

---

# OUTPUTS

Публиковать:

```js id="u8v3ka"
Memory.empire.factory;
```

---

# TARGET STRUCTURE

Пример:

```js id="c7m2qp"
Memory.empire.factory = {
  rooms: {
    E35S37: {
      task: {
        resource: RESOURCE_BATTERY,
        amount: 5000,
        priority: "high",
      },

      status: "producing",
      assignedAt: 80240000,
    },
  },
};
```

---

# MINIMUM PRODUCTION SUPPORT

FactoryDirector v1 должен поддерживать:

```text id="w3r9xt"
RESOURCE_BATTERY
RESOURCE_ENERGY
```

---

# ПОЧЕМУ ТОЛЬКО ЭТО

v1 должен:

- доказать architecture;
- доказать orchestration;
- доказать production pipeline.

Complex commodities будут позже.

---

# PRODUCTION PRIORITIES

## HIGH

Если:

```js id="t6k4zn"
economyManager.isCritical(resource);
```

---

## NORMAL

Если:

```text id="d2v8qy"
state === 'low'
```

---

## NONE

Если:

```text id="x4m7pk"
state === 'stable' || state === 'surplus'
```

---

# FACTORY ASSIGNMENT RULES

## Один factory task на комнату

Запрещено:

- multiple simultaneous tasks;
- conflicting production orders.

---

# FactoryDirector НЕ ДОЛЖЕН

- напрямую запускать factory.produce() в creep logic;
- хранить hidden state;
- принимать market decisions;
- балансировать terminals;
- сканировать комнаты через find().

---

# UPDATE STRATEGY

FactoryDirector:

- работает по interval;
- использует snapshots;
- НЕ делает heavy recalculation every tick.

---

# CPU REQUIREMENTS

FactoryDirector должен:

- быть lightweight;
- использовать только existing data layers;
- НЕ выполнять expensive searches.

---

# PUBLIC API

Минимум:

```js id="v5n2rq"
getTask(roomName);
hasTask(roomName);
getAllTasks();
```

---

# DEBUGGING

Добавить:

- throttled logging;
- production summary;
- count active factories.

Без console spam.

---

# VALIDATION REQUIRED

После реализации предоставить:

- architecture summary;
- production flow;
- Memory structure;
- CPU measurements;
- example production queue;
- integration analysis;
- scaling analysis.

---

# ГЛАВНЫЙ ПРИНЦИП

FactoryDirector — это:

```text id="p8q4wy"
Industrial Execution Layer
```

а НЕ economic intelligence system.
