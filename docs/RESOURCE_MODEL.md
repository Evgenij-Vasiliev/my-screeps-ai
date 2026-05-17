# RESOURCE_MODEL.md

Проект: Autonomous Economic Empire
Игра: Screeps
Документ: Resource Model Specification
Статус: Foundation Layer

---

# 1. НАЗНАЧЕНИЕ ДОКУМЕНТА

Этот документ определяет:

- как империя видит ресурсы;
- как AI оценивает ресурсы;
- как определяется дефицит;
- как определяется избыток;
- как рассчитывается стратегическая ценность;
- кто владеет ресурсными данными.

Этот документ является фундаментом всей экономики империи.

---

# 2. ОСНОВНАЯ КОНЦЕПЦИЯ

Империя НЕ мыслит:

```text
комнатами
```

Империя мыслит:

```text
глобальной экономикой
```

Все комнаты являются частью:

```text
Global Resource Network
```

---

# 3. GLOBAL RESOURCE REGISTRY

Система должна иметь единый глобальный реестр ресурсов.

Пример:

```text
EmpireResources
├── energy
├── battery
├── power
├── ops
├── silicon
├── metal
├── biomass
├── mist
├── commodities
├── boosts
├── ghodium
└── strategic reserves
```

---

# 4. RESOURCE CATEGORIES

Каждый ресурс принадлежит к категории.

---

## 4.1 CORE RESOURCES

Критически важные ресурсы.

Примеры:

- energy
- battery
- power
- ops

---

## 4.2 INDUSTRIAL RESOURCES

Ресурсы промышленности.

Примеры:

- silicon
- metal
- biomass
- mist
- commodities

---

## 4.3 MILITARY RESOURCES

Военные ресурсы.

Примеры:

- boosts
- ghodium
- nuker resources

---

## 4.4 LUXURY RESOURCES

Некритичные ресурсы.

Могут быть:

- редкие commodities;
- market surplus;
- временные production chains.

---

# 5. RESOURCE STATE

Главная сущность экономики:

```text
ResourceState
```

Это базовая единица мышления AI.

---

# 6. RESOURCE STATE STRUCTURE

Каждый ресурс должен иметь:

```js
ResourceState {
    resourceType,
    totalAmount,
    availableAmount,
    reservedAmount,
    incomingAmount,
    outgoingAmount,
    incomeRate,
    consumptionRate,
    trend,
    category,
    strategicPriority,
    strategicValue,
    deficitLevel,
    surplusLevel,
    marketValue,
    logisticsCost,
    productionComplexity,
    futureDemand,
    warModifier,
    lastUpdated
}
```

---

# 7. FIELD EXPLANATIONS

## resourceType

Тип ресурса.

Пример:

```text
energy
battery
silicon
```

---

## totalAmount

Полный объем ресурса во всей империи.

---

## availableAmount

Доступный объем.

НЕ включает:

- зарезервированные ресурсы;
- production allocations;
- emergency reserves.

---

## reservedAmount

Ресурсы, уже обещанные системе.

Примеры:

- factory chains;
- lab requests;
- market export;
- emergency logistics.

---

## incomingAmount

Ресурсы в пути.

Примеры:

- terminal transfer;
- market delivery;
- production queue.

---

## outgoingAmount

Ресурсы, покидающие систему.

---

## incomeRate

Средняя скорость поступления.

Пример:

```text
+530 energy/tick
```

---

## consumptionRate

Средняя скорость расхода.

Пример:

```text
-610 energy/tick
```

---

## trend

Общий тренд ресурса.

Возможные значения:

```text
stable
growing
declining
critical
```

---

## strategicPriority

Важность ресурса.

Пример:

```text
critical
high
medium
low
luxury
```

---

## strategicValue

Главный economic score ресурса.

AI принимает решения на основе этого значения.

---

## deficitLevel

Насколько ресурс дефицитен.

Пример:

```text
none
low
medium
high
critical
```

---

## surplusLevel

Насколько ресурс избыточен.

---

## marketValue

Текущая рыночная стоимость.

---

## logisticsCost

Стоимость транспортировки.

Учитывает:

- distance;
- terminal energy cost;
- routing pressure.

---

## productionComplexity

Насколько сложно произвести ресурс.

Учитывает:

- chain depth;
- factory requirements;
- cooldown pressure;
- required infrastructure.

---

## futureDemand

Прогноз будущего спроса.

---

## warModifier

Военный коэффициент.

Во время войны:

- boosts;
- energy;
- ghodium

получают повышенную ценность.

---

# 8. STRATEGIC VALUE SYSTEM

Главная концепция экономики:

```text
Strategic Resource Value
```

Ресурс НЕ имеет одной фиксированной цены.

AI вычисляет ценность динамически.

---

# 9. STRATEGIC VALUE FACTORS

StrategicValue формируется из:

---

## 9.1 Market Value

Цена на рынке.

---

## 9.2 Strategic Importance

Насколько ресурс важен для империи.

---

## 9.3 Deficit Pressure

Насколько не хватает ресурса.

---

## 9.4 Production Complexity

Сложность производства.

---

## 9.5 Logistics Cost

Стоимость доставки.

---

## 9.6 Future Demand Prediction

Прогноз будущего спроса.

---

## 9.7 War Modifier

Военные коэффициенты.

---

# 10. DEFICIT MODEL

AI должен понимать:

НЕ просто:

```text
ресурса мало
```

А:

```text
насколько опасен дефицит
```

---

## Пример

Energy deficit:

```text
income < consumption
```

AI должен:

- ограничить luxury production;
- усилить battery economy;
- ограничить export;
- активировать emergency logistics.

---

# 11. SURPLUS MODEL

Избыток ресурсов должен использоваться.

Примеры:

- market export;
- commodity production;
- strategic stockpiling;
- industrial scaling.

---

# 12. STRATEGIC RESERVES

Некоторые ресурсы нельзя полностью тратить.

Примеры:

- emergency energy;
- war boosts;
- power reserves;
- ghodium reserve.

---

# 13. RESOURCE OWNERSHIP

## EconomyManager владеет:

- global resource state;
- strategic value;
- deficits;
- priorities;
- strategic reserves.

---

## FactoryDirector использует:

- production goals;
- resource requests.

Но НЕ изменяет:

- strategic priorities;
- global resource scores.

---

## MarketManager использует:

- export permissions;
- market targets.

Но НЕ изменяет:

- strategic value.

---

# 14. FORBIDDEN PATTERNS

Запрещено:

---

## FactoryController deciding production independently

---

## MarketManager overriding strategic reserves

---

## Room modules mutating global resources directly

---

## Hidden resource reservations

---

## Direct terminal exports without EconomyManager approval

---

# 15. FUTURE EXPANSION

В будущем модель должна поддерживать:

- war economy;
- predictive economics;
- adaptive specialization;
- market intelligence;
- autonomous industrial planning;
- CPU-aware economy.

---

# 16. FINAL PRINCIPLE

Империя должна понимать:

```text
не количество ресурсов
а
экономическое значение ресурсов
```

Это фундамент всей industrial AI architecture.
