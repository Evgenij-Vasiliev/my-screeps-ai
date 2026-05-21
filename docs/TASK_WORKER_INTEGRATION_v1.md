ТЗ ДЛЯ ТАКТИКА — ЭТАП 6
Worker Integration v1
Интеграция LogisticsDirector → Worker System
ЦЕЛЬ ЭТАПА

Подключить существующих worker/transporter крипов к новой Empire Logistics System.

После этапа:

LogisticsDirector
↓
создаёт delivery tasks
↓
Worker System
↓
забирает energy
↓
доставляет в factory
↓
FactoryController
↓
producing
АРХИТЕКТУРНОЕ РЕШЕНИЕ

Выбран:

ВАРИАНТ A — ИНТЕГРАЦИЯ С СУЩЕСТВУЮЩЕЙ СИСТЕМОЙ

Причины:

минимальный риск;
минимальные изменения;
быстрая интеграция;
пользователь слабо знает кодовую базу;
Empire Core уже стабилен.

TaskDispatcher будет позже.

ЗАДАЧА ТАКТИКА

Нужно:

1. Подключить workers к deliveries

Worker должен:

1. Найти queued delivery
2. Взять задачу
3. Забрать energy
4. Доставить energy в factory
5. Завершить delivery
   ГЛАВНОЕ ПРАВИЛО
   LogisticsDirector НЕ управляет крипами

Он только публикует deliveries.

Worker System сама:

выбирает delivery;
исполняет;
обновляет status.
DATA OWNERSHIP
Данные Владелец
deliveries[] LogisticsDirector
delivery.status Worker System
creep.memory Worker System
factory tasks FactoryDirector
factory status FactoryController
ЧТО МОЖНО ДЕЛАТЬ

✅ читать:

Memory.empire.logistics.deliveries

✅ обновлять:

delivery.status
delivery.updatedAt
delivery.assignedTo

✅ использовать:

creep.memory.deliveryTask
ЧТО ЗАПРЕЩЕНО

❌ менять:

FactoryDirector
EconomyManager
EmpireResourceRegistry

❌ создавать новые deliveries внутри workers

❌ удалять deliveries напрямую

❌ вызывать LogisticsDirector.plan()

DELIVERY LIFECYCLE

Worker обязан поддерживать lifecycle:

queued
↓
assigned
↓
delivering
↓
completed

или:

queued
↓
cancelled
REQUIRED API

Тактик должен добавить:

1. LogisticsDirector API
   Метод:
   getQueuedDelivery(roomName)
   Поведение:

Возвращает:

первый delivery со status === "queued"
или null
Пример
const delivery =
logisticsDirector.getQueuedDelivery(room.name); 2. Worker Integration

Worker должен:

ШАГ 1

Если:

!creep.memory.deliveryTask

то:

получить queued delivery
ШАГ 2

Назначить delivery:

delivery.status = "assigned";
delivery.assignedTo = creep.name;
delivery.updatedAt = Game.time;
ШАГ 3

Сохранить ссылку:

creep.memory.deliveryTask = {
roomName,
createdAt
}
ПОЧЕМУ НЕ INDEX

Нельзя хранить index массива.

Только:

roomName
createdAt

потому что массив может cleanup'иться.

ШАГ 4 — ENERGY ACQUIRE

Worker:

берёт energy
из storage/container

Текущую систему получения energy НЕ ломать.

ШАГ 5 — DELIVERY

Worker:

несёт energy в factory
ШАГ 6 — COMPLETE

После transfer():

delivery.status = "completed";
delivery.updatedAt = Game.time;

и:

delete creep.memory.deliveryTask;
FAILURE HANDLING

Если:

factory уничтожена
delivery исчез
delivery cancelled

то:

delete creep.memory.deliveryTask;

без ошибок.

CLEANUP RULE

Worker НЕ удаляет deliveries.

Cleanup остаётся за LogisticsDirector.

CPU REQUIREMENTS

Интеграция должна быть:

< 0.1 CPU на комнату

Запрещено:

❌ глобальное сканирование deliveries каждый тик

РЕКОМЕНДУЕМАЯ АРХИТЕКТУРА
role.worker.js
↓
deliveryHelper.js
↓
logisticsDirector API

НО:

это рекомендация,
не обязательство.

ОЖИДАЕМЫЙ RESULT

После интеграции:

queued
↓
assigned
↓
delivering
↓
completed

FactoryController должен начать видеть:

waiting_input
↓
producing

в нескольких комнатах.

VALIDATION REQUIREMENTS

Тактик обязан проверить:

1. Delivery assignment

Worker реально получает delivery.

2. Delivery completion

status меняется на completed.

3. Factory fill

factory.store.energy увеличивается.

4. Factory production

FactoryController меняет:

waiting_input → producing 5. Duplicate safety

Два worker не берут один delivery.

6. Recovery safety

Если worker умер:

delivery не зависает навсегда
ДОПОЛНИТЕЛЬНО (НЕ ОБЯЗАТЕЛЬНО)

Можно добавить timeout:

assigned > 100 ticks
→ queued

Но это v1.1.

ФИНАЛЬНАЯ ЦЕЛЬ ЭТАПА

После интеграции Empire впервые станет:

SELF-SUPPLYING INDUSTRIAL SYSTEM
Economy detects deficit
↓
FactoryDirector plans
↓
FactoryController requests input
↓
LogisticsDirector creates deliveries
↓
Workers transport resources
↓
Factories produce automatically
