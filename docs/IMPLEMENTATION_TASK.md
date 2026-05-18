# TASK: VALIDATE & STABILIZE EMPIRE RESOURCE REGISTRY

Статус: IMPLEMENTATION TASK

---

# КОНТЕКСТ

EmpireResourceRegistry v2 уже:

- реализован;
- подключен к main.js;
- вызывается в runtime.

Текущее ТЗ НЕ про создание системы,
а про:

- validation;
- stabilization;
- integration verification.

---

# ЦЕЛЬ

Проверить что EmpireResourceRegistry:

- стабильно работает;
- соответствует архитектуре;
- безопасен для scaling;
- корректно интегрирован в empire core.

---

# ЧТО НУЖНО СДЕЛАТЬ

## 1. Проверить integration point

Registry должен:

- запускаться один раз за тик;
- запускаться централизованно;
- находиться в foundation layer runtime.

---

# ПРАВИЛЬНЫЙ ПОРЯДОК MAIN LOOP

```text id="s9w2mx"
Foundation Layer
↓
EmpireResourceRegistry
↓
Economy Layer
↓
Factory / Market / Logistics
↓
Room Systems
↓
Creep Systems
```

---

# 2. Проверить Memory structure

Убедиться что корректно создаются:

```js id="hy7w3a"
Memory.empire.resources;
Memory.empire.resourcesMeta;
```

---

# 3. Проверить snapshot correctness

Проверить:

- total values;
- room totals;
- поддержку всех ресурсов;
- корректность aggregation.

---

# 4. Проверить metadata

Убедиться что обновляются:

```js id="dz4vxp"
version;
generatedAt;
roomCount;
scanDuration;
```

---

# 5. CPU VALIDATION

Проверить:

- CPU usage;
- отсутствие spikes;
- корректную работу UPDATE_INTERVAL;
- стабильность на multi-room empire.

---

# 6. DEBUG VALIDATION

Проверить:

- controlled logging;
- отсутствие console spam;
- читаемость debug output.

---

# 7. ARCHITECTURAL VALIDATION

Убедиться что Registry:

- НЕ принимает решений;
- НЕ содержит market logic;
- НЕ содержит production logic;
- НЕ содержит logistics logic;
- НЕ мутирует чужие managers.

---

# 8. CODE QUALITY VALIDATION

Проверить:

- отсутствие hidden global state;
- отсутствие direct cross-manager mutation;
- отсутствие repeated expensive scans;
- отсутствие unsafe Memory writes.

---

# 9. OUTPUT

После проверки предоставить:

- CPU measurements;
- пример snapshot;
- integration summary;
- найденные risks;
- найденные architectural violations (если есть).

---

# ГЛАВНЫЙ ПРИНЦИП

Registry — foundation subsystem.

Stability и architectural safety важнее feature expansion.
