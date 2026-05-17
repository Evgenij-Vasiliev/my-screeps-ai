# СТРАТЕГИЧЕСКИЙ ПЛАН ИМПЕРИИ SCREEPS

Проект: Автономная промышленно-экономическая империя
Игра: Screeps
Уровень: Late-Game Empire AI

---

# 1. ГЛАВНАЯ ЦЕЛЬ

Построить полностью автономную империю, которая:

- самостоятельно анализирует экономику;
- принимает стратегические решения;
- управляет фабриками;
- управляет market;
- балансирует ресурсы;
- адаптируется к кризисам;
- масштабируется без разрушения архитектуры.

---

# 2. ФИЛОСОФИЯ АРХИТЕКТУРЫ

## Главный принцип

Архитектура важнее микрооптимизаций.

---

## Центр системы

Центр империи:

НЕ Factory.
НЕ Terminal.
НЕ Market.

Центр системы:

EconomyManager.

Именно он принимает стратегические решения.

---

## Гибридный AI

Глобальный AI:

- ставит цели;
- анализирует экономику;
- распределяет задачи.

Комнаты:

- выполняют задачи локально.

---

## Разделение ответственности

Каждый manager отвечает только за свою область.

Запрещено:

- пересечение ответственности;
- изменение чужих данных;
- хаотическая архитектура.

---

# 3. ГЛОБАЛЬНАЯ АРХИТЕКТУРА

## Empire Layer

EmpireManager
├── EconomyManager
├── FactoryDirector
├── MarketManager
├── LogisticsDirector
├── ResourceBalancer
├── PowerDirector
├── LabDirector
└── AnalyticsSystem

---

## Room Layer

RoomManager
├── FactoryController
├── TerminalController
├── LinkController
├── LabController
├── TaskDispatcher
└── RoomResourceTracker

---

## Intelligence Layer

ProductionPlanner
CommodityEvaluator
ProfitAnalyzer
DemandPredictor
TradeAnalyzer
EconomicStateAnalyzer

---

# 4. ТЕКУЩЕЕ СОСТОЯНИЕ ИМПЕРИИ

## Уже существует

- 5 комнат;
- все комнаты RCL8;
- terminal network;
- автоматический market;
- автоматические labs;
- extractor mining;
- link logistics;
- task manager;
- factories строятся;
- power spawn строятся.

---

# 5. ЭКОНОМИЧЕСКАЯ МОДЕЛЬ

## Империя мыслит глобально

Империя НЕ мыслит комнатами.

Она мыслит:

единым экономическим организмом.

Комнаты являются:

- производственными узлами;
- энергетическими узлами;
- логистическими центрами;
- промышленными платформами.

---

## Global Resource Registry

Система должна знать:

EmpireResources
├── energy
├── battery
├── silicon
├── metal
├── biomass
├── mist
├── ops
├── boosts
├── commodities
└── strategic reserves

---

## Для каждого ресурса AI обязан знать

### Total Amount

Полный объем ресурса.

### Available Amount

Доступный объем.

### Reserved Amount

Зарезервированный объем.

### Income Rate

Скорость поступления.

### Consumption Rate

Скорость расхода.

### Strategic Importance

Критичность ресурса.

### Economic Value

Внутренняя оценка AI.

---

# 6. СОСТОЯНИЯ ЭКОНОМИКИ

## Energy Crisis

Если:

energy income < energy consumption

Тогда AI:

- отключает luxury production;
- включает battery economy;
- ограничивает экспорт;
- усиливает logistics.

---

## Industrial Expansion

Если:

- избыток ресурсов;
- стабильная энергия;
- большие запасы.

Тогда AI:

- запускает commodities;
- расширяет industry;
- усиливает market operations.

---

## War Economy

При войне:

- boosts имеют высший приоритет;
- emergency logistics;
- защита strategic reserves.

---

## Market Opportunity

AI анализирует:

- цены;
- историю рынка;
- прибыльность;
- временный спрос.

---

# 7. ИЕРАРХИЯ ПРИОРИТЕТОВ

## Tier 0 — Выживание

Критически важно:

- energy;
- spawning;
- repairs;
- terminal operation.

---

## Tier 1 — Стабильность

Важно:

- battery reserves;
- mineral reserves;
- logistics stability.

---

## Tier 2 — Рост

Важно:

- commodities;
- factory chains;
- market operations.

---

## Tier 3 — Стратегическая экономика

Важно:

- profit optimization;
- specialization;
- industrial scaling.

---

# 8. СТРАТЕГИЯ FACTORY

## Dynamic Specialization

Комнаты НЕ имеют фиксированных ролей.

Empire AI сам назначает специализацию.

Примеры:

- Room A → battery;
- Room B → electronics;
- Room C → biological;
- Room D → mechanical.

---

## FactoryController

FactoryController:

- получает задачу;
- проверяет ресурсы;
- запускает производство;
- публикует status.

Factory НЕ принимает стратегических решений.

---

# 9. MARKET STRATEGY

## MarketManager отвечает за

- orders;
- trades;
- monitoring;
- arbitrage;
- import/export.

---

## MarketManager НЕ имеет права

- менять стратегию экономики;
- менять глобальные приоритеты;
- управлять production goals.

---

# 10. LOGISTICS STRATEGY

## Текущая система

- link logistics;
- worker-task architecture;
- нет классических transporters.

---

## Будущие цели

- inter-room balancing;
- terminal routing;
- factory supply chains;
- emergency delivery;
- strategic reserve movement.

---

# 11. MEMORY И CACHE

## Постоянные данные

Memory.empire

---

## Runtime cache

global.cache

---

## Cache хранит

- economic snapshots;
- resource totals;
- deficit analysis;
- market calculations;
- production planning.

---

# 12. CPU STRATEGY

## Главная идея

Баланс:

- хорошая архитектура;
- хороший CPU.

---

## Правила

### Запрещено

Полный пересчет империи каждый tick.

### Обязательно

Tick scheduling.

### Предпочтительно

Lazy calculations.

### Кэшировать

Все дорогие вычисления.

---

# 13. OWNERSHIP RULES

## EconomyManager владеет

- economic state;
- priorities;
- strategic reserves;
- production goals.

---

## FactoryDirector владеет

- production execution;
- factory assignment;
- production queues.

---

## LogisticsDirector владеет

- routing;
- deliveries;
- balancing.

---

# 14. ЗАПРЕЩЕННЫЕ ПАТТЕРНЫ

## Запрещено

- room modules не могут менять global economy напрямую;
- FactoryController не выбирает производство;
- MarketManager не меняет стратегические приоритеты;
- cross-manager mutation запрещен;
- скрытые side effects запрещены.

---

# 15. ROADMAP

## Этап 1 — Foundation Layer

Создать:

- resource registry;
- economic snapshots;
- cache layer;
- room reports.

---

## Этап 2 — Industrial Infrastructure

Создать:

- FactoryController;
- production queues;
- terminal routing;
- battery economy.

---

## Этап 3 — Empire Logistics

Создать:

- balancing;
- inter-room routing;
- emergency supply systems.

---

## Этап 4 — Economic Intelligence

Создать:

- profit analysis;
- commodity evaluation;
- production scoring;
- market intelligence.

---

## Этап 5 — Autonomous AI

Создать:

- adaptive specialization;
- autonomous industry;
- war economy;
- strategic planning.

---

# 16. ФИНАЛЬНАЯ ЦЕЛЬ

Построить:

Autonomous Economic Empire

с:

- adaptive industrial AI;
- strategic economy;
- self-balancing logistics;
- autonomous market intelligence;
- scalable architecture.

---

# 17. ГЛАВНЫЙ ПРИНЦИП

Империя должна быть:

архитектурно предсказуемой
и
стратегически адаптивной.
