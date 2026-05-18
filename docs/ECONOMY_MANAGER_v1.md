# TASK: ECONOMY MANAGER v1

Статус: IMPLEMENTATION TASK

---

# КОНТЕКСТ

Foundation subsystem уже существует:

```text
EmpireResourceRegistry v2
```

Он:

- агрегирует ресурсы;
- публикует global snapshot;
- НЕ принимает решений.

Теперь нужен первый настоящий economic AI layer.

---

# ЦЕЛЬ

Создать систему:

```text
EconomyManager
```

которая:

- анализирует состояние экономики;
- определяет deficits;
- определяет surpluses;
- вычисляет strategic reserves;
- публикует economic state для других managers.

---

# ВАЖНО

EconomyManager:

- НЕ управляет market;
- НЕ запускает factories;
- НЕ управляет logistics;
- НЕ создает terminal transfers;
- НЕ принимает tactical room decisions.

Это:

- analysis layer;
- strategic evaluation layer.

---

# MAIN RESPONSIBILITY

EconomyManager должен отвечать на вопрос:

```text
Какие ресурсы у империи:
- в дефиците;
- в избытке;
- в норме.
```

---

# INPUTS

EconomyManager читает:

```js
empireResourceRegistry.getResources();
empireResourceRegistry.getTotal();
empireResourceRegistry.getInRoom();
```

---

# OUTPUTS

Публиковать:

```js
Memory.empire.economy;
```

---

# TARGET STRUCTURE

Пример:

```js
Memory.empire.economy = {
  energy: {
    state: "stable",
    total: 1400000,
    reserveTarget: 1000000,
    surplus: 400000,
    deficit: 0,
  },

  XGH2O: {
    state: "critical",
    total: 1200,
    reserveTarget: 10000,
    surplus: 0,
    deficit: 8800,
  },
};
```

---

# ECONOMIC STATES

Минимум:

```text
critical
low
stable
surplus
```

---

# RESERVE TARGETS

Система должна поддерживать:

```js
RESERVE_TARGETS;
```

Пример:

```js
RESOURCE_ENERGY: 1000000;
RESOURCE_BATTERY: 50000;
RESOURCE_XGH2O: 10000;
```

---

# ВАЖНО

Reserve targets:

- пока static;
- configurable;
- НЕ dynamic AI.

Dynamic economy balancing будет позже.

---

# ANALYSIS RULES

## critical

```text
resource < 25% reserve target
```

---

## low

```text
resource < reserve target
```

---

## stable

```text
resource >= reserve target
AND
resource < 2x reserve target
```

---

## surplus

```text
resource >= 2x reserve target
```

---

# CPU REQUIREMENTS

EconomyManager должен:

- быть lightweight;
- использовать ResourceRegistry snapshot;
- НЕ сканировать комнаты напрямую;
- НЕ делать expensive searches.

---

# ARCHITECTURAL RULES

EconomyManager:

- НЕ мутирует ResourceRegistry;
- НЕ пишет в чужие managers;
- НЕ принимает execution decisions.

---

# PUBLIC API

Минимум:

```js
getState(resourceType);
getDeficit(resourceType);
getSurplus(resourceType);
isCritical(resourceType);
```

---

# DEBUGGING

Добавить:

- throttled logging;
- summary output;
- count critical resources.

Без console spam.

---

# VALIDATION REQUIRED

После реализации предоставить:

- architecture summary;
- Memory structure;
- CPU measurements;
- example economy snapshot;
- list of detected critical resources;
- scaling analysis.

---

# ГЛАВНЫЙ ПРИНЦИП

EconomyManager — это:

```text
Strategic Economic Intelligence Layer
```

а НЕ execution system.
