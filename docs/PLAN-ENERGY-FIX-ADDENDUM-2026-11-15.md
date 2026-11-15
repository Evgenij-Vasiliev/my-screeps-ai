# ДОПОЛНЕНИЕ К ПЛАНУ ЭНЕРГЕТИКИ — 2026-11-15

Уточнение перед реализацией. Код не менялся.

## 1. Резервирование энергии задач

**Решение: отказаться от инкрементального `Memory.rooms[].energyReserved`.** Резерв — производная от очереди, а не отдельный счётчик. Это исключает рассинхронизацию по построению.

### Механизм

- В задаче появляется поле `reserve` — сколько энергии она вправе забрать за рейс (`maxEnergy`). Поле ставит генератор: `factory 600`, `terminal 1000`, `tower/repair/build/upgrade 500`, `spawn 1600`.
- Резерв **создаётся при назначении задачи исполнителю**, а не при создании задачи в очереди: `worker.runner` перед `taskManager.reserveTask(...)` вызывает `energyPolicy.canReserve(room, task)`.
- `canReserve(room, task)`:
  ```
  free = storage.energy - STORAGE.ENERGY_MIN - DEFENSE_RESERVE
  reserved = Σ task.reserve для задач, у которых reservedBy — живой крип
  return free - reserved >= task.reserve
  ```
- Резерв **освобождается**:
  - `completeTask` / `removeTask` — задача удаляется (надгробие `null`), в сумму больше не входит;
  - `releaseTask` — `reservedBy` снят, задача снова свободна, резерв не считается;
  - смерть крипа — `reservedBy` указывает на несуществующего крипа; `reserved()` такие задачи не считает (как уже делает `countQueue`, task.manager.js:181);
  - истечение — задача удаляется при `compactAll`/`getNextTask`, резерв исчезает.
- `reserved()` считает задачи по `Memory.rooms[room].tasks` всех очередей `TASK_CHAIN`, пропускает `null`-надгробия и задачи с мёртвым `reservedBy`. Кэш — в heap на тик (`global.__energyReserved[room]`), сбрасывается в `addTask/reserveTask/releaseTask/completeTask/compactAll`. В `Memory.rooms[room].energyReserved` можно писать только диагностический снимок раз в тик; решения по нему не принимаются.

### Почему не счётчик

Инкрементальный счётчик ломается на: завершении (надгробие), удалении, смерти крипа, компакции, внешней правке Memory. Производная сумма переживает всё это без отдельной логики. Цена — один проход по 11 очередям при `canReserve` (вызывается на назначение задачи, не каждый тик), кэш на тик.

### Минимальные правки

- `task.manager.js`: ничего не хранить; `getNextTask/freeTasks` пропускают `expiresAt < Game.time`; `compactAll` удаляет просроченные.
- `worker.runner.js`: перед `reserveTask` — `canReserve`; при отказе задача остаётся свободной, воркер ищет следующую.
- `energy.policy.js`: `reserved(room)`, `canReserve(room, task)`.
- `task.generators.js`: проставить `reserve` и `expiresAt`.

## 2. Бюджет фабрик

Одна партия — 600 энергии, 50 батарей, кулдаун 10. Расход — 60/тик на активную фабрику.

### Условия одной партии

`factoryAllowed(room)` = все условия:
1. `batteryStock(room) < BATTERY_STOCK_TARGET` (20 000 империя; сейчас 71 200 — производство сначала стоит).
2. `free(room) >= FACTORY_BATCH_ENERGY + FACTORY_SAFETY` (600 + 600).
3. `storage.energy >= FACTORY_START` (200 000) — нижняя страховка.
4. `Game.time >= Memory.rooms[room].factoryNextBatchAt`.
5. `room` входит в глобальный лимит активных фабрик.

### Глобальный лимит без менеджера

`energy.policy` считает один раз на тик:
```
estSurplus = (Σ storage.energy - Σ snapshot100TicksAgo) / 100
MAX_ACTIVE = clamp(floor(estSurplus / 60), 0, 5)   // старт 1, пока истории нет
```
Право на партию получают `MAX_ACTIVE` комнат с наибольшим `free(room)`. Решение кэшируется на тик; это функция политики, не Scheduler и не очередь.

### Согласование с запасом и продажей

- При `batteryStock >= BATTERY_STOCK_TARGET` производство = 0, продажа приоритетна.
- При `batteryStock + 50 <= BATTERY_STOCK_TARGET` и свободном профиците — одна партия.
- `fillFactoryEnergy` несёт `maxEnergy = 600`, `reserve = 600`; воркер везёт ровно 600, не 1600. Буфер 2000 больше не нужен.
- После партии `factoryNextBatchAt = Game.time + 10`.
- `factory.manager` проверяет `energyPolicy.factoryAllowed(room)` перед `produce`; заливка без этого не создаётся.

## 3. Межкомнатное распределение

Условий «донор >250k, получатель <150k» **недостаточно**:

1. Комиссия `terminal.send` списывается из **терминала**, а не склада; `fitSendAmount` сейчас держит в терминале всего `ENERGY_FLOOR = 10000`, значит отправка может уронить терминал ниже 100k.
2. Донор может отдать энергию и остаться ниже собственного резерва: проверяется только `storageEnergy > surplusMin`, а не «после отправки ≥ резерв».
3. Не проверяется свободное место терминала получателя.
4. При 250k донор с текущими складами 214–229k не отправит ничего; порог надо считать от резерва, а не от абсолютных 250k.

### Исправление в `terminalNetwork.js`

- `balanceEnergy`:
  - получатель: `storageEnergy < STORAGE.ENERGY_MIN` (150k), цель — 150k;
  - донор: `storageEnergy > STORAGE.ENERGY_MIN + TRANSFER_BUFFER` (200k), после отправки ≥200k;
  - `amount = min(150k - to.storage, from.storage - 200k, to.terminal.freeCapacity, from.terminal.energy - 100k - cost)`;
  - `amount >= MIN_SEND_AMOUNT` (1000), иначе не отправлять.
- `fitSendAmount` для `RESOURCE_ENERGY`: `keepEnergy = TERMINAL_SUPPLY.ENERGY_MIN` (100k), а не 10k; для ресурсов — прежний 10k/priority.
- Комиссия уже считается в цикле; её нужно списывать в счётчик `energySpent` комнаты-донора (для аудита), но решение от этого не зависит.
- `send` не должен отправлять энергию, если после неё `storageEnergy < 200k` или терминал <100k; проверку ставить в `balanceEnergy`/`fitSendAmount`.

Рекомендуемые параметры: `TRANSFER_BUFFER = 50000` (донор после отправки ≥200k), `TRANSFER_TARGET = 150000`, `TERMINAL_ENERGY_FLOOR = 100000`.

## 4. Окончательный список изменений и порядок

### Файлы и функции

| Файл | Функция | Изменение |
| --- | --- | --- |
| `constants.js` | `TASK_ENERGY_LIMITS` → `TASK_ENERGY_POLICY` | `reserve`, `maxEnergy`, `priority`, `expiresAt`; `BATTERY_STOCK_TARGET`, `FACTORY_START/STOP`, `TRANSFER_*` |
| `energy.policy.js` | `allows` | `reserved`, `canReserve`, `free`, `factoryAllowed`, `sellAllowed`, `transferAllowed`; старые bands — только диагностика |
| `task.manager.js` | `getNextTask/freeTasks/compactAll` | пропуск/удаление просроченных; без счётчика резерва |
| `task.generators.js` | все генераторы | `reserve`, `expiresAt`; фабрика — `maxEnergy=600`, условия стока |
| `worker.runner.js` | выбор задачи | `canReserve` до `reserveTask`; отказ → следующая |
| `energySource.js` | `withdrawFromStorage` | `amount`, `minStorage`; не больше `task.reserve` |
| `task.executors.js` | все energy-executor’ы | передают `amount = min(carry, task.maxEnergy)` |
| `factory.manager.js` | `run` | `factoryAllowed` перед `produce` |
| `market.manager.js` | `trySellResource` | продажа по стоку/цене, не по 240k; учёт комиссии |
| `terminalNetwork.js` | `fitSendAmount/balanceEnergy` | терминальный пол 100k, донор после отправки ≥200k, capacity/commission |

### Зависимости

1. `constants` + `energy.policy` (без них нет полей).
2. `task.generators` + `task.manager` + `worker.runner` + `energySource` (резерв/исполнение).
3. `factory.manager` + `market.manager` (сток/продажа).
4. `terminalNetwork` (перераспределение).

### Первый безопасный этап

**Этап 0: поля и проверка без изменения поведения.**
- `constants.energyPolicy` добавляет `reserve/maxEnergy/priority/expiresAt` со значениями по умолчанию `0/null`; `energy.policy.canReserve` возвращает true, если `reserve` не задан.
- `worker.runner` вызывает `canReserve`; при `reserve=0` — всегда true.
- Тесты: все существующие зелёные; поведение на 200 тиках не меняется.
- Откат: один коммит.

Затем этапы: резерв на `fillFactoryEnergy`/`fillSpawn`; фабрика; продажа; терминал. Каждый этап — отдельный коммит и замер 100–200 тиков.
