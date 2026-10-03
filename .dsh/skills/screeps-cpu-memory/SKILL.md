---
name: screeps-cpu-memory
description: Справочник по CPU-бюджету, bucket, кэшированию и Memory в Screeps, сверенный с @types/screeps, исходниками screeps/engine и официальными docs.
whenToUse: Когда считаешь бюджет CPU на комнату или крипа, выбираешь между heap-кэшем и Memory, разбираешься с bucket или с объёмом Memory.
---

# CPU, bucket и Memory в Screeps

Что реально есть в `Game.cpu` и `RawMemory` (а чего нет), какие лимиты действуют
на официальном сервере, как измерять стоимость своей функции и куда класть кэш.
Числа сверены с `@types/screeps` 3.3.8 (локальная копия проекта; совпадает с
master по проверенным сигнатурам), исходниками `screeps/engine` и официальными
docs. Непроверенное помечено `[НЕ ПРОВЕРЕНО]` — его нельзя использовать как основание.

## Когда использовать

- Проектируешь бюджет: сколько CPU на комнату, на крипа, что отключить при низком bucket.
- Выбираешь хранилище для кэша: `global` (heap) или `Memory` (сериализуется каждый тик).
- Нужно точно знать, существует ли метод/поле (`Game.cpu.halt`, `setShardLimits`), а не «вроде есть».
- Бот упёрся в лимит CPU или в размер Memory — нужна механика, а не догадка.
- Пишешь замер стоимости API или своей функции (второй скилл — про процедуру замера в этом проекте).

## Ключевые факты

### 1. Game.cpu: что существует, а что нет

| Факт | Значение | Источник |
|---|---|---|
| `Game.cpu.limit` | лимит CPU **текущего шарда**, не аккаунта | `@types/screeps:1650`; docs/api #Game-cpu.limit |
| `Game.cpu.tickLimit` | сколько CPU доступно в этом тике (обычно выше `limit`) | `@types/screeps:1654`; docs/api |
| `Game.cpu.bucket` | накопленный неиспользованный CPU | `@types/screeps:1659` |
| `Game.cpu.getUsed()` | CPU с начала тика; **в Simulation всегда 0** | `@types/screeps:1675-1677` |
| `Game.cpu.shardLimits` | объект `{shard0: n, shard1: n, ...}` | `@types/screeps:1663` |
| `Game.cpu.setShardLimits(limits)` | перераспределение лимитов; **не чаще 1 раза в 12 часов**; `OK \| ERR_BUSY \| ERR_INVALID_ARGS` | `@types/screeps:1680-1685` |
| `Game.cpu.unlocked`, `Game.cpu.unlockedTime` | полный CPU разблокирован; время (ms UNIX) до конца разблокировки | `@types/screeps:1667-1672` |
| `Game.cpu.unlock()` | +24 ч полного CPU за 1 `cpuUnlock` (`Game.resources`); `OK \| ERR_NOT_ENOUGH_RESOURCES \| ERR_FULL` | `@types/screeps:1716`; docs/api #Game-cpu.unlock |
| `Game.cpu.generatePixel()` | 1 пиксель за **10000 CPU из bucket**; `OK \| ERR_NOT_ENOUGH_RESOURCES` | `@types/screeps:1709`; docs/api |
| `Game.cpu.getHeapStatistics?()` | **опционально**: `undefined`, если рантайм не IVM; поля как у `v8.getHeapStatistics()` + `externally_allocated_size` | `@types/screeps:1697,1719-1730` |
| `Game.cpu.halt?()` | **опционально** (`?`): «reset runtime, wipe heap, код останавливается немедленно»; `undefined` вне IVM | `@types/screeps:1705` |
| **Нет** `Game.cpu.bucketLimit` / `maxBucket` / `bucketMax` | таких полей в API нет | grep по `@types/screeps` |
| **Нет** `Game.cpu.unlockCPU()` | метод называется `unlock()` | `@types/screeps:1716` |
| **Нет** глобального «CPU аккаунта» в `Game.cpu` | в движке `limit = runtimeData.user.cpu`, т.е. уже посчитанный лимит шарда | engine `src/game/game.js:151` |

### 2. Точные лимиты

| Факт | Значение | Источник |
|---|---|---|
| База CPU | **20 CPU** на официальном сервере без разблокировки | docs/control.html §Your CPU Limit |
| Рост CPU | **+10 CPU за каждый GCL**, если CPU разблокирован (`CPU Unlock` / подписка); потолок **300 CPU**, дальше не растёт | docs/control.html §Your CPU Limit |
| 1 CPU | 1 мс процессорного времени; тик заканчивается, когда все скрипты досчитаны | docs/cpu-limit.html |
| Полный bucket | **10 000 CPU**; пример в docs: `if (Game.cpu.bucket == 10000) Game.cpu.generatePixel()` | docs/cpu-limit.html; docs/api #Game-cpu.generatePixel |
| Перерасход из bucket | до **500 CPU за тик**; при полном bucket `Game.cpu.tickLimit == 500`; `tickLimit` никогда не меньше `limit` | docs/cpu-limit.html |
| Накопление | разница `limit − израсходовано` за тик добавляется в bucket | docs/cpu-limit.html |
| Формула `tickLimit` при неполном bucket | в docs явно не задана (только «reflects the amount of CPU you can spend») — `[НЕ ПРОВЕРЕНО]` | docs/cpu-limit.html |
| Исчерпание | bucket = 0 и расход выше лимита → сервер останавливает исполнение | docs/cpu-limit.html; вики CPU (community) |
| Лимит Memory | **2 МБ** (2048 КБ) | docs/global-objects.html; docs/contributed/caching-overview.html |
| Асинхронные сегменты | до **10 активных** сегментов, id **0…99**, **100 КБ** на сегмент; данные пишутся автоматически в конце тика | `@types/screeps:3691,3727`; docs/api #RawMemory.segments |
| `InterShardMemory` | **100 КБ** на шард, читать можно все, писать — только свой | docs/api #InterShardMemory |
| `Game.notify` | до **20 уведомлений за один тик**, текст ≤ **1000 символов**; второй аргумент — группировка **в минутах** (180 в примере docs = 3 часа, не тики) | docs/api #Game.notify |
| `moveTo` | `reusePath` по умолчанию **5** тиков, путь лежит в `Memory.creeps[name]._move` | docs/api #Creep.moveTo; engine `src/game/creeps.js:285-287` |
| Состояние при превышении лимита CPU | docs: «execution of your script will be terminated». Сохраняется ли при этом запись в Memory — `[НЕ ПРОВЕРЕНО]` | docs/cpu-limit.html |
| Что происходит при Memory > 2 МБ | в docs только сам лимит; проверки в `screeps/engine` нет — `[НЕ ПРОВЕРЕНО]` | docs/global-objects.html |
| Degraded mode | в docs/cpu-limit.html, docs/global-objects.html и в `screeps/engine` слово не встречается — `[НЕ ПРОВЕРЕНО]` | — |
| Распределение CPU по shard0…3 по умолчанию | docs дают только «лимит на текущий шард» + `setShardLimits` 1 раз в 12 ч; правило дележа не описано — `[НЕ ПРОВЕРЕНО]` | docs/api #Game-cpu.shardLimits |
| Цена строки «цена CPU» в API | «A»-методы (intents) стоят 0.2 CPU (community-вики, не официальный docs) | вики CPU, раздел API CPU Usage |

Замеры проекта (shard3, лимит 20): bucket равен 10000 в обоих прогонах, то есть держится полным, а не «копилкой на аварийный тик» (`docs/cpu-baseline.json:7`; `docs/cpu-baseline-8.53.json:7`).

### 3. Иерархия стоимости (замеры этого проекта + устройство движка)

Числа — одиночные замеры на живом shard3 (в скобках — файл проекта), их нельзя
переносить на другой шард как абсолют, но порядок величин устойчив.

| Уровень | Что делаем | Цена | Источник |
|---|---|---|---|
| Дешёвое | чтение свойства уже найденного объекта; `Game.getObjectById(id)` | 0.0001–0.0002 CPU | `docs/cpu-baseline.json:24` |
| Дешёвое | `Game.cpu.getUsed()` | 0.00025 CPU | `docs/cpu-baseline.json:21` |
| Дешёвое | `Object.values(Game.rooms)` | 0.00023 CPU | `docs/cpu-baseline.json:31` |
| Среднее | `room.find(FIND_STRUCTURES)` повторно в тике (кэш движка) | 0.0032 CPU | `docs/cpu-baseline.json:30` |
| Среднее | `Object.values(Game.creeps)` | 0.0037 CPU | `docs/cpu-baseline.json:25` |
| Среднее | `RawMemory.get()` (33 КБ) | 0.002 CPU | `docs/cpu-baseline.json:32-33` |
| Дорогое | `room.find(FIND_STRUCTURES)` первый раз в тике (314 структур) | 0.0058 CPU | `docs/cpu-baseline.json:26-27` |
| Дорогое | `Game.market.getAllOrders(...)` | 0.16–0.89 CPU за вызов | `docs/cpu-baseline.json:19-34`; `docs/CPU-BASELINE.md:76-79` |
| Дорогое | pathfinding (`PathFinder.search`, `moveTo` без переиспользования пути) | нативный C++; цену мерить, числа в этом проекте не замерялись | docs/api #PathFinder |
| Дорогое | первый доступ к `Memory` в тике (полный `JSON.parse`) и запись `Memory` в конце | пропорционально объёму Memory | engine `src/game/game.js:479-500`; docs/contributed/caching-overview.html |

`room.find` кэшируется движком в пределах тика, поэтому в горячем пути дорог не
первый вызов, а *проход по большому массиву в JS* и построение замыкания-фильтра.

### 4. Кэш: heap (`global`) против `Memory`

| Критерий | `global` / heap | `Memory` |
|---|---|---|
| Переживает тик | да | да |
| Переживает рестарт VM / выгрузку кода | **нет** (сбрасывается) | да |
| Стоимость | ноль сверх аллокации | сериализуется целиком каждый тик; парсится целиком при первом обращении |
| Что класть | кэш структур, индексы, агрегаты, CostMatrix | только то, что обязано пережить рестарт (идентификаторы, задачи, флаги) |
| Источник | docs/contributed/caching-overview.html (Global) | docs/contributed/caching-overview.html (Memory) |

`require`-кэш модулей привязан к тому же `global`: рестарт VM = повторная
компиляция всех модулей, это дорогое событие (docs/contributed/caching-overview.html).

## Рецепты

### Р1. Замер одной функции

```js
/** Возвращает результат fn и печатает её CPU. Замер «до/после» вокруг одного вызова. */
function measure(label, fn) {
  const t0 = Game.cpu.getUsed();
  const result = fn();
  const used = Game.cpu.getUsed() - t0;
  console.log(label + ": " + used.toFixed(4) + " CPU");
  return result;
}

// ВАЖНО: getUsed нельзя отрывать от объекта — только через стрелку.
const used = () => Game.cpu.getUsed();   // const u = Game.cpu.getUsed; u() → Illegal invocation
```

### Р2. Почему нельзя мерить один тик и как мерить «на модуль» и «на крипа»

Один тик даёт шум: GC, первый/повторный вызов (кэш движка), разная загрузка
комнаты. Копите сумму и число вызовов в `global`, а отчёт печатайте раз в N тиков.

```js
const g = (global.__prof = global.__prof || {});

/** Профилировщик: сумма и число вызовов в heap, отчёт раз в N тиков. */
function profiled(label, fn) {
  const t0 = Game.cpu.getUsed();
  const out = fn();
  const slot = (g[label] = g[label] || { sum: 0, n: 0 });
  slot.sum += Game.cpu.getUsed() - t0;
  slot.n++;
  return out;
}

function reportProfiler() {
  if (Game.time % 100 !== 0) return;
  for (const label in g) {
    const s = g[label];
    if (!s.n) continue;
    console.log(label, "avg", (s.sum / s.n).toFixed(4), "per call, calls/tick", s.n);
    s.sum = 0;
    s.n = 0;
  }
}
```

Уровень замера важен: замер «на модуле» (`cpuMonitor.trackRole("marketManager", ...)`)
показывает вклад подсистемы, замер «на крипа» — вклад одного исполнителя. Один и
тот же код в этих двух разрезах даёт разные цифры: цена вызова `Game.cpu.getUsed()`
(0.00025 CPU) при 100 крипах сама даёт ≈0.05 CPU/тик — этим нельзя пренебрегать
при замере мелочей, но нельзя и путать её с ценой самой работы.

### Р3. Heap-кэш с инвалидацией (версия + TTL)

```js
const CACHE_VERSION = 3; // поднять при смене формата данных: старый кэш станет невалидным

/** Кэш структур комнаты в heap: переживает тик, но НЕ переживает рестарт VM. */
function structureIds(room) {
  const c = global.__structs || (global.__structs = {});
  const hit = c[room.name];
  if (hit && hit.v === CACHE_VERSION && hit.t > Game.time - 20) return hit.ids;
  const ids = room.find(FIND_STRUCTURES).map(s => s.id);
  c[room.name] = { v: CACHE_VERSION, t: Game.time, ids };
  return ids;
}
```

После рестарта `global` пуст — кэш просто построится заново, поэтому он обязан
восстанавливаться из `Game`/`Memory` без внешних данных. Для кэша, который живёт
в `Memory`, поле версии обязательно: код на шарде меняется, а `Memory` — нет.

### Р4. Кэш «на тик» (внутри одного тика)

```js
/** Дорогой вызов — не более одного раза за тик. */
function getOrdersOnce(type, resourceType) {
  const key = type + "|" + resourceType;
  const c = global.__orders || (global.__orders = { tick: 0, byKey: {} });
  if (c.tick !== Game.time) {
    c.tick = Game.time;
    c.byKey = {};
  }
  if (!c.byKey[key]) c.byKey[key] = Game.market.getAllOrders({ type, resourceType });
  return c.byKey[key];
}
```

Ключ по `Game.time` (а не по «протухло через N тиков») — самый надёжный способ
не тащить данные прошлого тика: движок сам пересоздаёт `Game` каждый тик.

### Р5. Политика bucket и отключение дорогих подсистем

```js
const SHED = { LITE: 9000, HARD: 7000, MAX: 5000 }; // проект: loadShed.js:136-144

/** Уровень экономии: чем ниже bucket, тем строже режим. */
function shedLevel(bucket) {
  if (bucket < SHED.MAX) return 2;   // только критичное: спавн, добыча, заливка
  if (bucket < SHED.HARD) return 1;  // без терминала, фабрики, рынка
  if (bucket < SHED.LITE) return 0;  // без фонового: апгрейд, стройка, ремонт
  return -1;                          // полный режим
}

/** Бюджет тика: не начинать дорогое, если уже потрачено больше 80% лимита. */
function maySpendHeavy() {
  return Game.cpu.bucket > SHED.HARD && Game.cpu.getUsed() < Game.cpu.limit * 0.8;
}
```

Пороги держите с запасом от нуля: при `bucket == 0` и расходе выше лимита сервер
останавливает исполнение (docs/cpu-limit.html). Тяжёлые разовые задачи лучше
откладывать на тик, где bucket полон — docs это прямо рекомендует.

### Р6. Отложенная запись Memory через RawMemory

```js
/** Пишем Memory раз в 10 тиков, а не каждый: сериализация стоит ∝ объёму. */
function flushStats(stats) {
  if (Game.time % 10 !== 0) return;
  const raw = RawMemory.get();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    data = {}; // битый JSON: движок в этом тике отдаёт Memory === null (engine game.js:488-490)
  }
  data.stats = stats;
  RawMemory.set(JSON.stringify(data));
}
```

`RawMemory.set` берёт на себя **всю** сериализацию: то, что вы не положили в
строку, из Memory пропадёт. Ошибка `JSON.parse` не бросается игроку — движок
ловит её и подставляет `null`, поэтому «пустая Memory» обычно означает битую
строку, а не сброс.

### Р7. Асинхронные сегменты (дополнительная память)

```js
const SEG = 0;

/** Планируем сегмент; данные появятся в RawMemory.segments в СЛЕДУЮЩЕМ тике. */
function useSegment() {
  if (!RawMemory.segments[SEG]) RawMemory.setActiveSegments([SEG]);
  return RawMemory.segments[SEG];
}

/** Запись в активный сегмент: сохраняется автоматически в конце тика. */
function writeSegment(payload) {
  const s = JSON.stringify(payload);
  if (s.length > 100 * 1024) throw new Error("segment overflow: " + s.length);
  RawMemory.segments[SEG] = s;
}
```

### Р8. id вместо ссылок на объекты Game

```js
// ПЛОХО: ссылка на объект живёт до конца тика, дальше это «мёртвый» объект.
global.__target = creep;

// ХОРОШО: в кэше — строка id, объект достаём каждый тик.
global.__targetIds = Object.keys(Game.creeps);
for (const id of global.__targetIds) {
  const c = Game.getObjectById(id); // ~0.0001-0.0002 CPU (docs/cpu-baseline.json:24)
  if (!c) continue;                 // крип умер — id просто не найдётся
}
```

Движок строит `Game` и все объекты заново из `runtimeData` (engine
`src/game/game.js:50,136-182`), а `Game.getObjectById` — это поиск в реестре
текущего тика (`engine src/game/game.js:171-173`). Объект из прошлого тика
не обновляется. Если передать в игровой метод «сериализованный» объект из
Memory, движок бросит ошибку с прямым текстом: `It seems you're trying to use a
serialized game object stored in Memory which is not allowed` (engine
`src/game/game.js:122-126`).

## Подводные камни

1. **`Game.cpu.getUsed` нельзя отрывать от объекта**: `const u = Game.cpu.getUsed; u()`
   даёт `Illegal invocation` — оборачивайте в стрелку (проверено на живом шарде:
   `docs/CPU-BASELINE.md:133-134`).
2. **`global` сбрасывается** при выгрузке кода/рестарте VM, `Memory` — нет. Любой
   heap-кэш обязан быть восстановим; любой Memory-кэш обязан иметь версию/срок.
3. **Утечки в `global`**: ключи по имени крипа/комнаты не удаляются сами — мёртвые
   крипы остаются в кэше навсегда, пока живёт VM. Чистите по факту отсутствия в `Game`.
4. **`creep.memory` создаёт запись при чтении**: геттер делает
   `Memory.creeps[name] = Memory.creeps[name] || {}` (engine `src/game/creeps.js:106`),
   то есть простое чтение памяти у 100 крипов раздувает Memory. То же у `room.memory`
   (`engine src/game/rooms.js:559`), `flag.memory` (`flags.js:39`), `spawn.memory` (`structures.js:876`).
5. **`moveTo` пишет путь в Memory каждого крипа** (`_move`, engine
   `src/game/creeps.js:285-287`): `reusePath` экономит CPU, но растит Memory.
6. **Memory парсится целиком при первом обращении в тике** (engine
   `src/game/game.js:479-500`) и сериализуется целиком в конце — стоимость ∝ объёму.
   Логи и статистика в Memory — это постоянный налог на каждый тик.
7. **`Game.notify`**: не более 20 за тик, текст ≤ 1000 символов; 180 в примере docs —
   это минуты группировки. Частые notify съедают CPU и забивают почту.
8. **`console.log`**: движок складывает строки в массив сообщений и конвертирует
   каждый аргумент в строку/JSON (engine `src/game/console.js`), т.е. цена зависит
   от размера объектов. Лимита на число строк в найденных источниках нет — `[НЕ ПРОВЕРЕНО]`.
9. **Кэш объектов Game между тиками** — см. Р8: только id-строки.
10. **`getHeapStatistics` и `halt` могут быть `undefined`** — проверяйте перед вызовом
    (`if (Game.cpu.halt) ...`), иначе получите ошибку в рантайме.
11. **`setShardLimits` — раз в 12 часов**: ошибка `ERR_BUSY` означает «не прошёл
    кулдаун», а не «неверные аргументы». Сумма лимитов должна остаться прежней.
12. **`Game.cpu.getUsed()` в Simulation всегда 0** — замеры в симуляторе бессмысленны.

## Источники

Официальные docs (скачаны и разобраны при подготовке скилла):

- https://docs.screeps.com/cpu-limit.html — 20 CPU база, bucket 10000, перерасход до 500 CPU/тик, `tickLimit` при полном bucket = 500, «terminated» при превышении.
- https://docs.screeps.com/control.html — «begin the game with a 20 CPU limit», «+10 CPU for each GCL level until your limit reaches 300 CPU».
- https://docs.screeps.com/global-objects.html — Memory 2 МБ; запрет хранить объекты Game в Memory.
- https://docs.screeps.com/api/ — `#Game-cpu` (`limit`, `tickLimit`, `bucket`, `shardLimits`, `unlocked`, `unlockedTime`, `getUsed`, `getHeapStatistics`, `halt`, `setShardLimits` 12 ч, `unlock`, `generatePixel` 10000), `#Game-notify` (20 за тик, ≤1000 символов), `#RawMemory` (10 сегментов, 100 КБ), `#InterShardMemory` (100 КБ на шард), `#Creep-moveTo` (`reusePath` 5, путь в `_move`).
- https://docs.screeps.com/contributed/caching-overview.html — Memory 2048 КБ, JSON.parse каждый тик, сброс `global` и require-кэша.
- https://wiki.screepspl.us/CPU/ — community-вики: 30 CPU у подписки (согласуется с +10/GCL), «не более 500 CPU combined за тик», цена intents 0.2 CPU.

Типы (локальная копия проекта, `@types/screeps` 3.3.8; master проверен grep'ом на те же сигнатуры):

- `node_modules/@types/screeps/index.d.ts:1496-1560` — интерфейс `Game`.
- `node_modules/@types/screeps/index.d.ts:1646-1730` — `CPU`, `HeapStatistics`.
- `node_modules/@types/screeps/index.d.ts:3219-3233` — `Memory` и её секции (`creeps`, `powerCreeps`, `flags`, `rooms`, `spawns`).
- `node_modules/@types/screeps/index.d.ts:3686-3755` — `RawMemory` (`segments`, `get`, `set`, `setActiveSegments`, `setPublicSegments`, `setActiveForeignSegment`, `interShardSegment`).
- `node_modules/@types/screeps/index.d.ts:2045-2066` — `InterShardMemory` (`getLocal`, `setLocal`, `getRemote`).

Движок (master, `https://github.com/screeps/engine`):

- `src/game/game.js:50` — `makeGameObject({runtimeData, intents, memory, getUsedCpu, ...})`.
- `src/game/game.js:136-182` — сборка `Game`; `cpu.limit = runtimeData.user.cpu`, `tickLimit = runtimeData.cpu`, `bucket = runtimeData.cpuBucket`, `halt`/`getHeapStatistics` — только если переданы.
- `src/game/game.js:171-173` — `Game.getObjectById` = поиск в реестре тика.
- `src/game/game.js:174-181` — `Game.notify` = intent с ценой 20 (0.2 CPU), `ERR_FULL` при отказе.
- `src/game/game.js:122-126` — ошибка при использовании сериализованного объекта из Memory.
- `src/game/game.js:479-500` — `Memory` как ленивый геттер: `JSON.parse(RawMemory.get())`, при ошибке `null`.
- `src/game/creeps.js:95-120` — геттер `creep.memory` создаёт ключ; `src/game/creeps.js:285-287` — путь `_move` при `reusePath`.
- `src/game/rooms.js:559`, `src/game/flags.js:39`, `src/game/structures.js:876,1129` — ленивое создание `room.memory`, `flag.memory`, `spawn.memory`, `Memory.creeps[name]` при спавне.
- `src/game/rooms.js:584-657` — реализация `Room.find` и `register.findCache`.
- `src/game/console.js` — `console.log`/`logUnsafe` складывают строки в массив, `commandResult`, лимиты визуализации 500/1000 КБ.

Замеры этого проекта (живой shard3, лимит 20, bucket 10000):

- `docs/CPU-BASELINE.md:23-32` — общая картина; `docs/CPU-BASELINE.md:40-50` — таблица стоимости API; `docs/CPU-BASELINE.md:126-136` — техника замеров (лимит консоли, `Illegal invocation`).
- `docs/cpu-baseline.json:19-34` — сырые числа стоимости API.
- `loadShed.js:136-144` — пороги экономии по bucket (9000/7000/5000) этого проекта.
