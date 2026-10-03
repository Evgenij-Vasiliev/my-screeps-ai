---
name: screeps-power-intershard
description: Проверенный справочник по power creeps, ops/power, PowerSpawn, GPL и межшардовым механикам Screeps (Game.shard, InterShardMemory, порталы, shardLimits). Применять при работе с силой, ops и мультишардовой логикой.
whenToUse: Когда нужно создать/прокачать power creep, применить PWR_*-способность, обработать power на PowerSpawn или организовать обмен данными между шардами.
---

# Screeps: power creeps, ops и межшардовые механики

Назначение: дать точные формулы, лимиты и сигнатуры для power creeps, GPL и intershard-обмена,
чтобы агент не выдумывал способности вроде `OPERATE_EXTENSION` с чужими числами и не искал несуществующие
`FIND_PORTAL` / `Game.shardSeason`. Все числа подтверждены скачанными в этой сессии источниками (легенда — в «Источники»).

## Когда использовать

- Создание, спавн, прокачка, удаление power creep; расчёт свободных GPL-уровней.
- Расчёт стоимости и кулдауна `usePower` для конкретного `PWR_*`; работа с PowerSpawn, PowerBank, `RESOURCE_POWER` / `RESOURCE_OPS`.
- Обмен данными между шардами (`InterShardMemory`), чтение `Game.shard`, `Game.cpu.setShardLimits`, переход крипов через порталы.
- НЕ использовать для базовых сигнатур `Creep`/`Room`/`Store` — это скилл `screeps-api-core`.

## Ключевые факты

### Создание, классы, уровни

| Факт | Значение/сигнатура | Источник |
| --- | --- | --- |
| `PowerCreep.create(name, className)` | статический метод; `OK \| ERR_NAME_EXISTS \| ERR_NOT_ENOUGH_RESOURCES \| ERR_INVALID_ARGS` | ENG-power-creeps.js:392-404, API:15484-15492 |
| **Что реально требуется для `create`** | **один свободный GPL-уровень** (`calcFreePowerLevels() > 0`); имя — строка ≤100 символов; класс — из `POWER_CLASS` | ENG-power-creeps.js:392-404 |
| **`OPERATE_SPAWN` для `create` НЕ нужен** | `PWR_OPERATE_SPAWN` — боевая способность, к созданию PC отношения не имеет | ENG-power-creeps.js:392-404 |
| `powerCreep.spawn(powerSpawn)` | `OK \| ERR_NOT_OWNER \| ERR_BUSY \| ERR_INVALID_TARGET \| ERR_TIRED \| ERR_RCL_NOT_ENOUGH`; нужен **PowerSpawn в комнате RCL8** | DT:4286-4288, API:16583-16599 |
| Классы | `POWER_CLASS = { OPERATOR: "operator" }` — **только оператор** | DT:805-807, DT:3086-3088 |
| `EXECUTOR` и `COMMANDER` | **НЕ реализованы**: в `POWER_CLASS` их нет, в docs помечены «Under development» | DT:805-807, POWER:72-73 |
| `PowerCreep.level` | уровень PC, максимум `POWER_CREEP_MAX_LEVEL = 25` | DT:801, DT:4055 |
| `PowerCreep.hitsMax` | **1000 за уровень** | API:15438 |
| `PowerCreep.store` ёмкость | **100 за уровень** | API:15440 |
| `POWER_CREEP_LIFE_TIME` | **5000** тиков | DT:803, API:15436 |
| `POWER_CREEP_SPAWN_COOLDOWN` | **28800000** мс = 8 часов (это timestamp, а не тики) | DT:800, DT:4102 |
| `POWER_CREEP_DELETE_COOLDOWN` | **86400000** мс = 24 часа | DT:801, DT:4037 |
| `powerCreep.upgrade(power)` | `OK \| ERR_NOT_OWNER \| ERR_NOT_ENOUGH_RESOURCES \| ERR_FULL \| ERR_INVALID_ARGS`; нужен свободный GPL; класс способности должен совпадать с классом PC; уровень способности ≤5 | ENG-power-creeps.js:212-238, DT:4329 |
| `powerCreep.delete(cancel?)` | PC не должен быть в мире; запускает 24-часовой таймер; `delete(true)` отменяет | DT:4130 |
| `powerCreep.rename(name)` | только пока не заспавнен | DT:4245 |
| `powerCreep.suicide()` | не удаляет, а «распавнивает» — можно заспавнить снова | DT:4298 |
| `powerCreep.renew(powerSpawn \| powerBank)` | мгновенно восстанавливает TTL, **бесплатно**, цель вплотную | DT:4258-4260, POWER:29 |
| `powerCreep.enableRoom(controller)` | включает силы в комнате; контроллер вплотную | DT:4154-4156, API:15847-15860 |
| `powerCreep.powers[PWR_X]` | `{ level: number; cooldown: number \| undefined }`; `cooldown === undefined`, если PC не в мире | DT:4391-4404, ENG-power-creeps.js:56-59 |
| `powerCreep.shard` | имя шарда, где PC заспавнен, либо `undefined` | DT:4094 |
| `powerCreep.memory` | алиас `Memory.powerCreeps[creep.name]` | DT:4063, API:15540 |
| Нет методов | у `PowerCreep` **нет** `harvest`, `build`, `repair`, `attack`, `upgradeController` | DT:4019-4384 (grep) |

### GPL: формула и прогресс

| Факт | Значение/формула | Источник |
| --- | --- | --- |
| `POWER_LEVEL_MULTIPLY` | **1000** | DT:798 |
| `POWER_LEVEL_POW` | **2** | DT:799 |
| Уровень GPL | `floor( (power / 1000) ^ (1/2) )` | ENG-game.js:133 |
| `Game.gpl.progressTotal` | `pow(level + 1, 2) * 1000 - gplBaseProgress` | ENG-game.js:167 |
| Свободные уровни | `gplLevel - (кол-во power creeps + сумма их level)` | ENG-power-creeps.js:10-14 |
| Опыт за power | каждый обработанный юнит power увеличивает `user.power`; GPL растёт по формуле выше | ENG-game.js:133 |

Следствие: для GPL `N` нужно `N² × 1000` суммарного power (уровень 1 — 1000, уровень 2 — 4000, уровень 5 — 25 000,
уровень 10 — 100 000).

### `PWR_*`: индексы, требования и эффекты

Все строки взяты из таблицы `POWER_INFO` в DT (DT:861-1030) и сверены с прозой доков (POWER:32-71).
`level[]` — минимальный уровень PC для уровней способности 1..5.

| PWR | ID | level[] | cooldown | range | ops | duration | effect[] |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PWR_GENERATE_OPS` | 1 | [0,2,7,14,22] | 50 | — | **0** | — | [1,2,4,6,8] ops |
| `PWR_OPERATE_SPAWN` | 2 | [0,2,7,14,22] | 300 | 3 | 100 | 1000 | [0.9,0.7,0.5,0.35,0.2] — **доля времени спавна** |
| `PWR_OPERATE_TOWER` | 3 | [0,2,7,14,22] | 10 | 3 | 10 | 100 | [1.1,1.2,1.3,1.4,1.5] |
| `PWR_OPERATE_STORAGE` | 4 | [0,2,7,14,22] | 800 | 3 | 100 | 1000 | [500000,1000000,2000000,4000000,7000000] |
| `PWR_OPERATE_LAB` | 5 | [0,2,7,14,22] | 50 | 3 | 10 | 1000 | [2,4,6,8,10] |
| `PWR_OPERATE_EXTENSION` | 6 | [0,2,7,14,22] | 50 | 3 | **2** | — | [0.2,0.4,0.6,0.8,1.0] |
| `PWR_OPERATE_OBSERVER` | 7 | [0,2,7,14,22] | 400 | 3 | 10 | **[200,400,600,800,1000]** | — |
| `PWR_OPERATE_TERMINAL` | 8 | [0,2,7,14,22] | 500 | 3 | 100 | 1000 | [0.9,0.8,0.7,0.6,0.5] |
| `PWR_DISRUPT_SPAWN` | 9 | [0,2,7,14,22] | 5 | **20** | 10 | [1,2,3,4,5] | — |
| `PWR_DISRUPT_TOWER` | 10 | [0,2,7,14,22] | **0** | **50** | 10 | 5 | [0.9,0.8,0.7,0.6,0.5] |
| `PWR_DISRUPT_SOURCE` | 11 | [0,2,7,14,22] | 100 | 3 | 100 | [100,200,300,400,500] | — |
| `PWR_SHIELD` | 12 | [0,2,7,14,22] | 20 | 0 (на себя) | **100 энергии**, не ops | 50 | [5000,10000,15000,20000,25000] hits |
| `PWR_REGEN_SOURCE` | 13 | **[10,11,12,14,22]** | 100 | 3 | 0 | 300 | [50,100,150,200,250] за `period: 15` тиков |
| `PWR_REGEN_MINERAL` | 14 | **[10,11,12,14,22]** | 100 | 3 | 0 | 100 | [2,4,6,8,10] за `period: 10` тиков |
| `PWR_DISRUPT_TERMINAL` | 15 | **[20,21,22,23,24]** | 8 | **50** | **[50,40,30,20,10]** | 10 | — |
| `PWR_OPERATE_POWER` | 16 | **[10,11,12,14,22]** | 800 | 3 | 200 | 1000 | [1,2,3,4,5] — **прибавка к 1 юниту/тик** |
| `PWR_FORTIFY` | 17 | [0,2,7,14,22] | 5 | 3 | 5 | [1,2,3,4,5] | — |
| `PWR_OPERATE_CONTROLLER` | 18 | **[20,21,22,23,24]** | 800 | 3 | 200 | 1000 | [10,20,30,40,50] энергии/тик к лимиту RCL8 |
| `PWR_OPERATE_FACTORY` | 19 | [0,2,7,14,22] | **1000 (DT) vs 800 (docs)** | 3 | 100 | 1000 | — |

Числовые значения `PWR_*` (DT:3111-3129):
`GENERATE_OPS=1`, `OPERATE_SPAWN=2`, `OPERATE_TOWER=3`, `OPERATE_STORAGE=4`, `OPERATE_LAB=5`, `OPERATE_EXTENSION=6`,
`OPERATE_OBSERVER=7`, `OPERATE_TERMINAL=8`, `DISRUPT_SPAWN=9`, `DISRUPT_TOWER=10`, `DISRUPT_SOURCE=11`, `SHIELD=12`,
`REGEN_SOURCE=13`, `REGEN_MINERAL=14`, `DISRUPT_TERMINAL=15`, `OPERATE_POWER=16`, `FORTIFY=17`,
`OPERATE_CONTROLLER=18`, `OPERATE_FACTORY=19`.

Смысл эффектов (проверено по POWER:34-70):
`GENERATE_OPS` — генерирует ops; `OPERATE_SPAWN` — **уменьшает** время спавна на 10/30/50/65/80 %;
`OPERATE_TOWER` — усиливает урон/ремонт/лечение; `OPERATE_STORAGE` — увеличивает ёмкость storage;
`OPERATE_LAB` — прибавка к количеству реакции; `OPERATE_EXTENSION` — мгновенно наполняет extensions из
целевой структуры (container/storage/terminal); `OPERATE_OBSERVER` — неограниченная дальность обзора;
`OPERATE_TERMINAL` — снижает стоимость и кулдаун пересылки; `DISRUPT_SPAWN` — пауза спавна;
`DISRUPT_TOWER` — снижает эффективность башни; `DISRUPT_SOURCE` — пауза регенерации источника;
`SHIELD` — временный неремонтируемый рампорт на своей клетке; `DISRUPT_TERMINAL` — блокирует вывод ресурсов;
`OPERATE_POWER` — ускоряет обработку power на PowerSpawn; `FORTIFY` — неуязвимость стены/рампорта;
`OPERATE_CONTROLLER` — поднимает лимит энергии на апгрейд RCL8-контроллера;
`OPERATE_FACTORY` — задаёт уровень фабрики (навсегда, повторный вызов продлевает).

### `usePower`: проверки и стоимость

Порядок проверок в ENG-power-creeps.js:240-282 (именно в этом порядке возвращаются коды):

| Условие | Код | Источник |
| --- | --- | --- |
| PC не ваш | `ERR_NOT_OWNER` | ENG-power-creeps.js:242 |
| PC не в мире | `ERR_BUSY` | ENG-power-creeps.js:245 |
| В комнате есть контроллер без `isPowerEnabled` | `ERR_INVALID_ARGS` | ENG-power-creeps.js:247-249 |
| Враждебный контроллер в safe mode | `ERR_INVALID_ARGS` | ENG-power-creeps.js:250-252 |
| Способности нет / уровень 0 | `ERR_NO_BODYPART` | ENG-power-creeps.js:256-259 |
| `powers[power].cooldown > 0` | `ERR_TIRED` | ENG-power-creeps.js:260-262 |
| ops в `store` меньше `powerInfo.ops` | `ERR_NOT_ENOUGH_RESOURCES` | ENG-power-creeps.js:264-277 |
| У способности есть `range` и нет цели | `ERR_INVALID_TARGET` | ENG-power-creeps.js:278-280 |
| Цель вне `powerInfo.range` | `ERR_NOT_IN_RANGE` | ENG-power-creeps.js:280-282 |
| На цели уже висит эффект той же способности **более высокого уровня** | `ERR_FULL` | ENG-power-creeps.js:283-286 |

Ops списываются по `powerInfo.ops`; если это массив — по `ops[level - 1]` (ENG-power-creeps.js:271-274).

### PowerSpawn и PowerBank

| Факт | Значение | Источник |
| --- | --- | --- |
| `StructurePowerSpawn.processPower()` | `amount = 1`; при активном `PWR_OPERATE_POWER` `amount += effect[level-1]` | ENG-structures.js:619-624 |
| Стоимость | **50 энергии за 1 power** (`POWER_SPAWN_ENERGY_RATIO = 50`) | API:6439-6441, ENG-structures.js:625 |
| Проверка | `power >= amount` и `energy >= amount * 50`, иначе `ERR_NOT_ENOUGH_RESOURCES` | ENG-structures.js:625-627 |
| Скорость | **1 юнит power за тик** (ускоряется `PWR_OPERATE_POWER`) | API:24490 |
| Требования | RCL **8**; стоимость постройки 100 000; hits 5 000 | API:24480-24489 |
| Буферы | `POWER_SPAWN_ENERGY_CAPACITY = 5000`, `POWER_SPAWN_POWER_CAPACITY = **100**`, `POWER_SPAWN_HITS = 5000` | API:6427-6437 |
| `StructurePowerBank` | `power: number`, `ticksToDecay: number` | DT:6176-6187 |
| PowerBank hits | `POWER_BANK_HITS = 2000000` | API:6403-6405 |
| PowerBank награда | `POWER_BANK_CAPACITY_MAX = 5000`, `MIN = 500`, `CRIT = 0.3` | API:6407-6417 |
| PowerBank распад | `POWER_BANK_DECAY = 5000`; `POWER_BANK_RESPAWN_TIME = 50000` | API:6419-6421, API:8015-8017 |
| Отражение урона | `POWER_BANK_HIT_BACK = 0.5` — **50 % урона возвращается атакующему** | API:6423-6425, POWER:11 |
| `RESOURCE_POWER` / `RESOURCE_OPS` | строки `"power"` / `"ops"` | DT:2815-2816 |
| Где брать power | разрушение PowerBank, покупка на рынке | POWER:11-12 |
| Где брать ops | `PWR_GENERATE_OPS` (1/2/4/6/8 за применение); других подтверждённых источников нет | POWER:33-34 |

Итог по «максимум 100 ops?»: **да для PowerSpawn** — его буфер power равен 100 (а не 100 ops: `store` PowerSpawn
принимает только `RESOURCE_ENERGY | RESOURCE_POWER`, DT:6226). Буфер ops живёт в `powerCreep.store`, а не в PowerSpawn.

### Межшардовое: `Game.shard`, `InterShardMemory`, лимиты

| Факт | Значение/сигнатура | Источник |
| --- | --- | --- |
| `Game.shard.name` | `string` — имя шарда | DT:1919, API:3894 |
| `Game.shard.type` | `"normal"`; доки: «Currently always equals to normal» | DT:1923, API:3896 |
| `Game.shard.ptr` | `boolean` — принадлежит ли шард PTR | DT:1927, API:3898 |
| `Game.shard.access` | `boolean?` — есть ли доступ; на неограниченных шардах всегда `true` | DT:1934, API:3900 |
| `Game.shard.accessTime` | `number?` — мс от эпохи до конца доступа | DT:1939 |
| `Game.shard.activateAccess?()` | `OK \| ERR_NOT_ENOUGH_RESOURCES \| ERR_INVALID_TARGET \| ERR_FULL`; тратит 1 `ACCESS_KEY` | DT:1952, API:3906-3920 |
| `InterShardMemory.getLocal()` | `string` — данные текущего шарда | DT:2402 |
| `InterShardMemory.setLocal(value)` | `void`; **бросает исключение**, если значение не строка или длиннее `100 * 2014` символов | DT:2409 |
| `InterShardMemory.getRemote(shard)` | `string \| null`; `null`, если шард есть, но данных нет; бросает при неверном имени шарда | DT:2416 |
| Лимит объёма | **100 KB на шард**; шард пишет только в свои данные, чужие — read-only | API:1377-1378 |
| `RawMemory.interShardSegment` | **@deprecated**, «Use `InterShardMemory` instead»; тот же лимит 100 KB | DT:4431-4441 |
| `Game.cpu.shardLimits` | лимиты CPU по шардам, ключи — имена шардов | DT:1977 |
| `Game.cpu.setShardLimits(limits)` | `OK \| ERR_BUSY \| ERR_INVALID_ARGS`; сумма должна сохраняться; **не чаще 1 раза в 12 часов** | DT:2007 |
| Типы шардов `shard0..shard3`, `shardSeason`, `shardTest` | **[НЕ ПРОВЕРЕНО]** — в DT `type` объявлен как `"normal"`, перечисления типов шардов в API нет | — |
| Лимит крипов на шард/аккаунт | **[НЕ ПРОВЕРЕНО]** — в скачанных источниках числа нет | — |

### Порталы

| Факт | Значение | Источник |
| --- | --- | --- |
| `STRUCTURE_PORTAL` | строка `"portal"` | DT:2696 |
| Как найти портал | через `FIND_STRUCTURES` (порталы — структуры) и фильтр по `structureType === STRUCTURE_PORTAL`; движок регистрирует `portal: globals.StructurePortal` среди типов структур | ENG-game.js:249 |
| `FIND_PORTAL` | **НЕ существует** — 0 совпадений в DT | grep |
| `LOOK_PORTALS` | **НЕ существует**; порталы видны как `LOOK_STRUCTURES` (`"structure"`) | grep, DT:2601 |
| `StructurePortal.destination` | `RoomPosition` для межкомнатного портала **или** `{ shard: string; room: string }` для межшардового | DT:6684, API:24810-24820 |
| Точка выхода | при межшардовом переходе координаты не определены — крип появится на любой свободной клетке комнаты назначения | API:24820 |
| `StructurePortal.ticksToDecay` | `number \| undefined`; `undefined` — портал стабилен | DT:6688 |
| Стабильное время / распад | стабильность 10 дней, распад 30 000 тиков | API:24697-24700 |
| `PORTAL_DECAY` | `30000` | API:6744 |
| `PORTAL_UNSTABLE` / `PORTAL_MIN_TIMEOUT` / `PORTAL_MAX_TIMEOUT` | `10*24*3600*1000` / `12*24*3600*1000` / `22*24*3600*1000` | API:7985-8010 |
| Что теряется при переходе крипа | **[НЕ ПРОВЕРЕНО]** — в скачанных источниках утверждения нет | — |
| Можно ли переводить power creeps через порталы | **[НЕ ПРОВЕРЕНО]**; известно только, что у PC есть поле `shard` (DT:4094) и что PC не привязаны к шарду по кулдауну спавна (DT:4078) | — |

## Рецепты

**1. Создать PC и заспавнить его (create — уровень аккаунта, spawn — PowerSpawn в RCL8):**

```js
const rc = PowerCreep.create('pc1', POWER_CLASS.OPERATOR);   // ERR_NOT_ENOUGH_RESOURCES = нет свободного GPL
if (rc === OK) {
    const pc = Game.powerCreeps['pc1'];
    // спавнить можно только вне кулдауна
    if (!(pc.spawnCooldownTime > Date.now())) {
        const spawnRc = pc.spawn(powerSpawn);                // ERR_RCL_NOT_ENOUGH, если комната не RCL8
        if (spawnRc !== OK) console.log('spawn:', spawnRc);
    }
}
```

**2. Прокачать способность и корректно применить её с проверкой кодов:**

```js
const pc = Game.powerCreeps['pc1'];
if (pc && !pc.spawnCooldownTime) {                 // PC в мире
    if (pc.powers[PWR_OPERATE_SPAWN].cooldown === 0) {
        const rc = pc.usePower(PWR_OPERATE_SPAWN, spawn);
        // ERR_INVALID_ARGS -> в комнате нет isPowerEnabled: сначала enableRoom
        if (rc === ERR_INVALID_ARGS) pc.enableRoom(pc.room.controller);
        else if (rc === ERR_NOT_IN_RANGE) pc.moveTo(spawn, { range: 3 });
        else if (rc === ERR_TIRED) { /* кулдаун ещё идёт */ }
    }
    if (pc.powers[PWR_OPERATE_SPAWN].level < 5) pc.upgrade(PWR_OPERATE_SPAWN);
}
```

**3. Обработка power на PowerSpawn, когда есть и энергия, и power:**

```js
const ps = Game.getObjectById(powerSpawnId);
const power = ps.store[RESOURCE_POWER];
const energy = ps.store[RESOURCE_ENERGY];
// 1 power = 50 энергии; с PWR_OPERATE_POWER за раз уходит amount > 1
if (power >= 1 && energy >= 50) {
    if (ps.processPower() !== OK) { /* ERR_NOT_ENOUGH_RESOURCES / ERR_RCL_NOT_ENOUGH / ERR_NOT_OWNER */ }
}
// буферы: POWER_SPAWN_POWER_CAPACITY = 100, POWER_SPAWN_ENERGY_CAPACITY = 5000
```

**4. Прочитать данные другого шарда, не падая на пустом ответе:**

```js
// getRemote возвращает null, если шард существует, но данных нет
function readShard(shardName) {
    const raw = InterShardMemory.getRemote(shardName);   // бросает при неверном имени шарда
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}
const remote = readShard('shard1');
```

**5. Записать свои данные, уложившись в 100 KB (иначе setLocal бросает):**

```js
const data = JSON.parse(InterShardMemory.getLocal() || '{}');
data.updatedAt = Game.time;
data.rooms = Object.keys(Game.rooms);
const str = JSON.stringify(data);
if (str.length <= 100 * 2014) InterShardMemory.setLocal(str);   // лимит из @types/screeps
else console.log('переполнение interShardMemory:', str.length);
```

**6. Найти портал и отправить крипа (порталы — структуры, отдельного FIND нет):**

```js
const portals = creep.room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_PORTAL,
});
const interShard = portals.find(p => p.destination && typeof p.destination === 'object'
    && 'shard' in p.destination);
if (interShard) {
    if (creep.pos.isNearTo(interShard)) {
        creep.moveTo(interShard);            // шаг на тайл портала = переход
    } else {
        creep.moveTo(interShard);
    }
}
// destination: RoomPosition для межкомнатного, { shard, room } для межшардового (DT:6684)
```

**7. Перезарядка PC: `renew` бесплатен и работает и от PowerBank — это способ водить PC по карте:**

```js
const bank = pc.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_POWER_BANK,
});
if (bank && pc.pos.isNearTo(bank)) pc.renew(bank);   // TTL -> максимум, без затрат
```

## Подводные камни

1. **`PowerCreep.create` не требует PowerSpawn и не требует `OPERATE_SPAWN`.** Это статический метод уровня
   аккаунта: нужен один свободный GPL-уровень. PowerSpawn нужен только для `powerCreep.spawn()`
   (ENG-power-creeps.js:392-404, API:15484-15492).
2. **`EXECUTOR` и `COMMANDER` не существуют.** `POWER_CLASS` содержит только `OPERATOR` (DT:805-807).
   Код с `POWER_CLASS.EXECUTOR` вернёт `ERR_INVALID_ARGS` — движок проверяет класс по `Object.values(C.POWER_CLASS)`
   (ENG-power-creeps.js:401-403).
3. **`create` возвращает `ERR_INVALID_ARGS`, хотя в @types/screeps его нет в возвращаемом типе.**
   Тип объявляет `OK | ERR_NAME_EXISTS | ERR_NOT_ENOUGH_RESOURCES` (DT:4383), движок добавляет `ERR_INVALID_ARGS`
   при имени длиннее 100 символов и неверном классе (ENG-power-creeps.js:393-403).
4. **`usePower` вернёт `ERR_NO_BODYPART`, если способность не изучена.** Это неочевидно: код `-12` про тело, а не про
   способность (ENG-power-creeps.js:256-259).
5. **`ERR_INVALID_ARGS` от `usePower` означает «силы не включены в комнате».**
   Нужен `powerCreep.enableRoom(controller)`; на враждебном контроллере в safe mode силы тоже блокируются
   (ENG-power-creeps.js:247-252, API:22130-22133).
6. **`PWR_OPERATE_SPAWN` — это доля, а не множитель.** Эффект `[0.9, 0.7, 0.5, 0.35, 0.2]` означает
   «остаётся 90/70/50/35/20 % времени», то есть сокращение на 10/30/50/65/80 % (POWER:35-36).
7. **`PWR_SHIELD` тратит 100 энергии, а не ops** — в `POWER_INFO` у него поле `energy: 100` и нет `ops`
   (DT:962-968). Проверка `store[RESOURCE_OPS]` для него бессмысленна.
8. **`PowerSpawn` не хранит ops.** Его store принимает только `RESOURCE_ENERGY | RESOURCE_POWER`, буфер power = 100
   (DT:6226, API:6435). Ops живут в `powerCreep.store`.
9. **`PWR_OPERATE_POWER` не заменяет базовую единицу, а прибавляется к ней**: `amount = 1 + effect[level-1]`,
   то есть максимум 6 power за тик (ENG-structures.js:619-624).
10. **`FIND_PORTAL` и `LOOK_PORTALS` не существуют.** Порталы ищутся как структуры
    (`FIND_STRUCTURES` + `structureType === STRUCTURE_PORTAL`); в LOOK-API они видны как `LOOK_STRUCTURES`.
11. **`Game.shard.type` в типах всегда `"normal"`.** Логика вида `if (Game.shard.type === 'shardSeason')` не имеет
    подтверждения ни в DT, ни в API.
12. **`InterShardMemory.getRemote` возвращает `null`, а не `''`,** если данных нет, и **бросает исключение** при
    неверном имени шарда — оборачивайте в try/catch или проверяйте шард заранее (DT:2416).
13. **`InterShardMemory.setLocal` бросает, а не обрезает** значение длиннее `100 * 2014` символов (DT:2409).
    100 KB — общий лимит на шард (API:1377).
14. **`Game.cpu.setShardLimits` — один вызов раз в 12 часов**, иначе `ERR_BUSY`; сумма лимитов должна сохраняться,
    иначе `ERR_INVALID_ARGS` (DT:2007).
15. **`PWR_OPERATE_FACTORY`: конфликт источников по кулдауну** — DT даёт `cooldown: 1000` (DT:1022-1029),
    docs.screeps.com/power.html — «Cooldown 800 ticks» (POWER:70). Доверяйте DT для расчёта тайминга и проверяйте
    фактом на живом шарде.

## Источники

Легенда: **DT** = https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/screeps/index.d.ts
(скачан в этой сессии, 6875 строк; `DT:<строка>` — номер строки). **API** = https://docs.screeps.com/api/
(полная страница API-справочника). **POWER** = https://docs.screeps.com/power.html.
**ENG-<файл>** = файл `src/game/<файл>` репозитория screeps/engine (шаблон пути, не ссылка; скачан в этой сессии).

| Источник | Что подтверждает |
| --- | --- |
| DT:861-1030 | Полная таблица `POWER_INFO`: `className`, `level[]`, `cooldown`, `range`, `ops`, `duration`, `effect[]`, `period`, `energy` для всех 19 `PWR_*` |
| DT:3111-3129 | Числовые значения `PWR_*` (1..19) |
| DT:798-807 | `POWER_LEVEL_MULTIPLY=1000`, `POWER_LEVEL_POW=2`, `POWER_CREEP_SPAWN_COOLDOWN`, `POWER_CREEP_DELETE_COOLDOWN`, `POWER_CREEP_MAX_LEVEL=25`, `POWER_CREEP_LIFE_TIME=5000`, `POWER_CLASS.OPERATOR` |
| DT:2398-2419 | `InterShardMemory`: `getLocal`/`setLocal`/`getRemote`, лимит `100 * 2014` символов, `getRemote` → `string \| null` |
| DT:1915-1953 | `Shard`: `name`, `type: "normal"`, `ptr`, `access?`, `accessTime?`, `activateAccess?()` |
| DT:6675-6689, DT:2696 | `StructurePortal.destination`/`ticksToDecay`, `STRUCTURE_PORTAL = "portal"` |
| DT:4431-4441 | `RawMemory.interShardSegment` помечен `@deprecated` в пользу `InterShardMemory`, лимит 100 KB |
| DT:1977-2015 | `Game.cpu.shardLimits`, `setShardLimits` и его 12-часовой кулдаун |
| DT:4019-4385 | Полный интерфейс `PowerCreep` и `PowerCreepPowers` (`level`, `cooldown`), `shard`, `spawnCooldownTime`, `deleteTime` |
| ENG-power-creeps.js:10-14 | `calcFreePowerLevels()` — формула свободных GPL-уровней |
| ENG-power-creeps.js:240-286 | Полный порядок проверок и кодов возврата `usePower`, списание ops по `ops[level-1]` |
| ENG-power-creeps.js:212-238 | `PowerCreep.upgrade`: класс способности, максимум уровня 5, `POWER_CREEP_MAX_LEVEL` |
| ENG-power-creeps.js:392-404 | `PowerCreep.create`: имя ≤100, свободный GPL, валидация `className`, отсутствие требования `OPERATE_SPAWN` |
| ENG-power-creeps.js:40-70 | Свойства PC: `hitsMax`, `store`, `shard`, `spawnCooldownTime`, `powers` (`cooldown = cooldownTime - time`) |
| ENG-structures.js:613-631 | `StructurePowerSpawn.processPower`: `amount = 1 + OPERATE_POWER.effect`, `amount * POWER_SPAWN_ENERGY_RATIO`, коды ошибок |
| ENG-game.js:133-134, 160-169 | Формулы `Game.gpl.level` и `progressTotal` |
| ENG-game.js:229-252 | Список типов структур движка: `portal: StructurePortal`, `powerBank`, `invaderCore` |
| https://docs.screeps.com/api/ | `PowerCreep` (TTL 5000, hits 1000/уровень, capacity 100/уровень, `create`/`spawn`/`renew`), таблица PowerSpawn (RCL8, 100 000, 50 энергии за 1 power, 1 power/тик), значения `POWER_BANK_*`, `POWER_SPAWN_*`, `PORTAL_*`, `InterShardMemory` (100 KB), `Game.shard`, safe mode блокирует `enableRoom`/`usePower` враждебных PC |
| https://docs.screeps.com/power.html | Проза по каждой способности (что именно усиливает), PowerBank и 50 % отражения урона, GPL и создание PC за свободный уровень, предупреждение «удаление PC уменьшает GPL на 1», бесплатный `renew` |
