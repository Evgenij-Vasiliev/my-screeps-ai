# TASK: EMPIRE RESOURCE REGISTRY

Статус: IMPLEMENTATION TASK

---

# ЦЕЛЬ

Создать систему глобального учета ресурсов империи.

Система должна:

- сканировать все комнаты;
- собирать ресурсы;
- строить global resource snapshot;
- публиковать aggregated totals.

---

# НАЗНАЧЕНИЕ

Это foundation всей economic AI architecture.

Все future systems будут использовать:

- global resource data;
- deficit analysis;
- surplus analysis;
- strategic calculations.

---

# СИСТЕМА НЕ ДОЛЖНА

- принимать стратегические решения;
- управлять market;
- запускать production;
- изменять priorities;
- управлять logistics.

---

# INPUTS

Система должна читать:

- Storage;
- Terminal;
- Factory;
- Labs;
- Power Spawn;
- Nuker;
- Creeps carrying resources.

---

# OUTPUTS

Система должна публиковать:

```js
Memory.empire.resources;
```

Пример
Memory.empire.resources = {
energy: {
total: 500000,
rooms: {
W1N1: 120000,
W2N3: 80000
}
},

    silicon: {
        total: 12000
    }

}
MINIMUM REQUIREMENTS
Must Have
global totals;
per-room totals;
automatic updates;
support all resources.

UPDATE STRATEGY
Запрещено:
full recalculation every tick.
Предпочтительно:
scheduled updates;
cache usage.

OWNERSHIP

Система владеет:
resource aggregation;
global totals.

Система НЕ владеет:
strategic decisions;
market logic;
production logic.

CPU REQUIREMENTS

Система должна:
быть lightweight;
поддерживать scaling;
работать для multi-room empire.

INTEGRATION RULES

Future systems:
EconomyManager;
FactoryDirector;
MarketManager;
LogisticsDirector
будут читать эти данные.

IMPORTANT

Это foundation system.
Архитектурная чистота важнее микрооптимизаций.

```text id="x6n2tr"
готово
```
