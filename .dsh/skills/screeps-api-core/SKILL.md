---
name: screeps-api-core
description: Точный справочник по игровому API Screeps (Game, Room, Creep, Store, структуры, RoomObject, RoomVisual, ERR_*/FIND_*). Применять, когда нужно писать или править код бота и нельзя выдумывать методы, поля или константы.
whenToUse: Перед написанием/ревью любого кода бота — чтобы сверить сигнатуру, константу или числовой код ошибки с @types/screeps и исходниками движка.
---

# Screeps: ядро API (проверенный справочник)

Назначение: дать агенту точные сигнатуры и числовые значения, чтобы он не изобретал методы.
Все факты ниже подтверждены скачанными в этой сессии `@types/screeps` (далее **DT**, с номерами строк),
исходниками движка (**ENG**) и официальной документацией (**API**). Легенда ссылок — в разделе «Источники».

## Когда использовать

- Нужно вызвать метод объекта и есть сомнение в имени/аргументах/возвращаемом коде.
- Нужно отличить устаревшее API (`carry`, `createCreep`) от актуального (`store`, `spawnCreep`).
- Нужно понять, почему `if (x)` ломается: какой `ERR_*` вернулся.
- Нужен список `FIND_*` / `LOOK_*` и их числовые значения.
- НЕ использовать для power creeps, GPL, ops и межшардовых переходов — это скилл `screeps-power-intershard`.

## Ключевые факты

### Game: полный список членов (других НЕТ)

Проверено: в DT объявлены ровно эти 17 членов; в ENG `src/game/game.js` объект `game` инициализируется теми же полями.

| Факт | Значение/сигнатура | Источник |
| --- | --- | --- |
| `Game.creeps` | `{ [creepName: string]: Creep }` | DT:1771 |
| `Game.powerCreeps` | `{ [name]: PowerCreep }`, включая НЕ заспавненных | DT:1797 |
| `Game.spawns` | `{ [spawnName: string]: StructureSpawn }` | DT:1813 |
| `Game.structures` | `{ [structureId: string]: OwnedStructure }` | DT:1817 |
| `Game.rooms` | `{ [roomName: string]: Room }`; комната видна, если в ней ваш крип или своя структура | DT:1809 |
| `Game.flags` | `{ [flagName: string]: Flag }` | DT:1775 |
| `Game.constructionSites` | `{ [id]: ConstructionSite }` | DT:1822 |
| `Game.resources` | ресурсы аккаунта (`pixel`, `cpuUnlock`, `accessKey`), `{[key]: any}` | DT:1803, API:843 |
| `Game.gcl` / `Game.gpl` | `{ level, progress, progressTotal }` | DT:1779, DT:1783 |
| `Game.cpu` / `Game.map` / `Game.market` | `CPU` / `GameMap` / `Market` | DT:1767, DT:1787, DT:1791 |
| `Game.shard` | `{ name: string; type: "normal"; ptr: boolean; access?: boolean; accessTime?: number; activateAccess?() }` | DT:1827, DT:1915-1953 |
| `Game.time` | `number` | DT:1834 |
| `Game.getObjectById(id)` | `T \| null` (в ENG: `register._objects[id] \|\| null`) | DT:1843-1859, ENG-game.js:170 |
| `Game.notify(message, groupInterval?)` | `OK \| ERR_FULL`; ≤20 уведомлений за тик, ≤1000 символов; `groupInterval` в минутах, `0` = сразу | DT:1866-1873 |

**Чего в `Game` НЕТ (не существует):** `Game.getObjectByIdOrNull`, `Game.getDirection`, `Game.notifications`,
`Game.deposits`, `Game.ruins`, `Game.nukes`, `Game.invaderCores`. Найдено: 0 совпадений в DT (grep) и 0 присваиваний
`game.<name>` в ENG `src/game/game.js`. Депозиты/руины/ядерки доступны только через `Room.find(FIND_*)`.

### CPU (`Game.cpu.*`)

| Факт | Значение/сигнатура | Источник |
| --- | --- | --- |
| `limit` / `tickLimit` / `bucket` | числа; `tickLimit >= limit` | DT:1959-1976 (limit:1959, tickLimit:1965, bucket:1971), CPU:13 |
| `shardLimits` | `CPUShardLimits` — лимиты по шардам | DT:1977 |
| `unlocked` / `unlockedTime` | `boolean` / `number \| undefined` | DT:1981-1988 |
| `getUsed()` | `number` (в симуляторе всегда 0) | DT:1994 |
| `setShardLimits(limits)` | `OK \| ERR_BUSY \| ERR_INVALID_ARGS`; **можно вызывать 1 раз в 12 часов**, сумма должна сохраняться | DT:2007 |
| `generatePixel()` | `OK \| ERR_NOT_ENOUGH_RESOURCES`; тратит **10000 CPU** из bucket | DT:2036 |
| `unlock()` | `OK \| ERR_NOT_ENOUGH_RESOURCES \| ERR_FULL`; +24 ч full CPU | DT:2048 |
| `halt?()` / `getHeapStatistics?()` | только под IVM, иначе `undefined` | DT:2028, DT:2020 |
| bucket | накапливается до **10 000 CPU**; за тик можно взять до **500 CPU** | CPU:11-13 |

### Room, RoomPosition, RoomTerrain

| Факт | Значение/сигнатура | Источник |
| --- | --- | --- |
| `room.name` | `readonly string` | DT:5179 |
| `room.controller?` / `storage?` / `terminal?` | опциональные ссылки | DT:5153, DT:5183, DT:5187 |
| `room.energyAvailable` / `energyCapacityAvailable` | сумма по spawns+extensions | DT:5157, DT:5161 |
| `room.memory` | алиас `Memory.rooms[room.name]` | DT:5175 |
| `room.visual` | `RoomVisual` | DT:5193 |
| `find(type, opts?)` | `S[]`; `opts.filter` — функция, объект-частичное совпадение или строка-путь к полю | DT:5306, DT:2551-2553 |
| `findExitTo(room)` / `findPath(from, to, opts?)` | `ExitConstant \| ERR_NO_PATH \| ERR_INVALID_ARGS` / `PathStep[]` | DT:5317, DT:5325 |
| `getPositionAt(x, y)` | `RoomPosition \| null` | DT:5332 |
| `getTerrain()` | `RoomTerrain` — **метод экземпляра Room, существует** | DT:5338 |
| `lookAt` / `lookAtArea` / `lookForAt` / `lookForAtArea` | DT:5346, DT:5364, DT:5374, DT:5396 | DT:5346-5412 |
| `Room.Terrain` | конструктор: `new Room.Terrain(roomName)`, `.get(x,y)`, `getRawBuffer()` (2500 значений) | DT:5417, DT:4859-4929 |
| `Room.serializePath` / `Room.deserializePath` | **статические** методы конструктора `Room`, не экземпляра | DT:5424, DT:5430 |
| `RoomPosition` | `{x, y, roomName}`; `getDirectionTo`, `getRangeTo`, `inRangeTo`, `isEqualTo`, `isNearTo`, `look`, `lookFor`, `findPathTo`, `findClosestByPath`, `findClosestByRange`, `findInRange`, `createConstructionSite`, `createFlag` | DT:4614-4837 |
| `room.getEventLog()` | события прошлого тика | DT:5165 |

`TERRAIN_MASK_WALL = 1`, `TERRAIN_MASK_SWAMP = 2`, `TERRAIN_MASK_LAVA = 4` (DT:2699-2701).

### Store: новый API (заменяет `carry`)

| Факт | Значение/сигнатура | Источник |
| --- | --- | --- |
| `store.getCapacity(resource?)` | `number \| null`; для универсального store без аргумента — общая ёмкость | DT:5786, ENG-store.js:23 |
| `store.getUsedCapacity(resource?)` | `number \| null`; без аргумента — сумма всего | DT:5798, ENG-store.js:29 |
| `store.getFreeCapacity(resource?)` | `number \| null` | DT:5810, ENG-store.js:44 |
| `store[RESOURCE_X]` | прямое чтение количества; **отсутствующий ресурс даёт `0`, а не `undefined`** (Proxy) | ENG-store.js:78-85 |
| `Creep.carry` / `Creep.carryCapacity` | **@deprecated**, алиасы `store` / `store.getCapacity()` | DT:1114-1121 |
| `store` есть у | Creep, PowerCreep, Ruin, Tombstone, StructureSpawn, StructureExtension, StructureLink, StructureTower, StructureStorage, StructureTerminal, StructureContainer, StructureFactory, StructureLab, StructureNuker, StructurePowerSpawn | DT:1180,4082,5454,6862,5569,6065,6097,6346,6312,6554,6593,6714,6464,6648,6226 |
| `store` НЕТ у | Resource, Source, Mineral, Flag, ConstructionSite, Nuke, Deposit, StructureController, StructureRampart, StructureWall, StructureRoad, StructureObserver, StructureExtractor, StructureKeeperLair, StructurePowerBank | grep: 0 совпадений |
| Типы store | `StoreDefinition = Store<ResourceConstant,false>`; `StoreDefinitionUnlimited = Store<ResourceConstant,true>` (у Ruin/Tombstone `getCapacity()` → `null`) | DT:2107-2110 |

### Creep: ключевые методы и поля

Поля: `body: BodyPartDefinition[]`, `fatigue`, `hits`/`hitsMax`, `my`, `name`, `owner.username`, `pos`, `room`,
`spawning: boolean`, `ticksToLive: number | undefined` (undefined пока спавнится), `store`, `memory`, `saying` (DT:1105-1195).

| Метод | Ключевое | Источник |
| --- | --- | --- |
| `move(direction)` | `CreepMoveReturnCode`; есть перегрузка `move(target: Creep)` для pull-связки | DT:1376, DT:1377 |
| `moveTo(target, opts?)` | `opts.reusePath` **по умолчанию 5**, `serializeMemory` по умолчанию `true` (путь в `creep.memory._move`), `noPathFinding` | DT:1395-1408, DT:2334-2346 |
| `moveByPath(path)` | принимает `PathStep[] \| RoomPosition[] \| string` | DT:1384 |
| `pull(target)` | тянет соседнего крипа, усталость идёт тянущему | DT:1453 |
| `harvest(target)` | `Source \| Mineral \| Deposit` | DT:1342 |
| `transfer(target, resourceType, amount?)` | `AnyCreep \| Structure`; **передача контроллеру энергии молча превращается в `upgradeController`** | DT:1588, ENG-creeps.js:455-457 |
| `withdraw(target, resourceType, amount?)` | `Structure \| Tombstone \| Ruin` | DT:1634 |
| `pickup(target)` / `drop(resourceType, amount?)` | `Resource` / на землю | DT:1436, DT:1300 |
| `build` / `repair` / `dismantle` | `build` и `repair` — в радиусе 3, `dismantle` — рядом | DT:1240, DT:1512, DT:1287 |
| `upgradeController(target)` | на RCL8 максимум 15 энергии/тик суммарно по всем крипам; поднимает `ticksToDowngrade` на 100 | DT:1611 |
| `attackController(target)` | нужен `CLAIM`, блокирует апгрейд на 1000 тиков, снимает 1 тик таймера за каждые 5 `CLAIM` | DT:1223 |
| `reserveController(target)` | до 5000 тиков резерва, +1 тик за каждый `CLAIM` | DT:1531 |
| `claimController` / `signController` | `signController(controller, text)`, ≤100 символов | DT:1269, DT:1561 |
| `attack` / `rangedAttack` / `heal` / `rangedHeal` | `rangedAttack` — радиус 3 | DT:1205, DT:1470, DT:1360, DT:1486 |
| `rangedMassAttack()` | бьёт всех врагов в радиусе 3; **`massAttack` НЕ существует** | DT:1499 |
| `getActiveBodyparts(type)` | живые части (повреждённые не считаются) | DT:1321 |
| `suicide()` / `say(msg, toPublic?)` | `say` — ≤10 символов | DT:1570, DT:1545 |
| `notifyWhenAttacked(enabled)` / `cancelOrder(methodName)` | | DT:1420, DT:1248 |
| `generateSafeMode(controller)` | нужно 1000 ghodium | DT:1314 |
| **`Creep.runReaction` НЕ существует** | реакции — `StructureLab.runReaction(lab1, lab2)` | DT:6535 |
| **`Creep.massAttack` НЕ существует** | только `rangedMassAttack` | grep: 0 совпадений |

`moveTo` в ENG первым делом возвращает `ERR_NOT_OWNER` (не свой), `ERR_BUSY` (ещё спавнится),
`ERR_TIRED` (fatigue > 0), `ERR_NO_BODYPART` (нет `MOVE`) — ENG-creeps.js:162-178.

### Структуры: методы и поля

| Структура | Ключевое | Источник |
| --- | --- | --- |
| `StructureSpawn` | `spawnCreep(body, name, opts?)`; `opts: {memory?, energyStructures?, dryRun?, directions?}`; `spawning: Spawning \| null`; `renewCreep(creep)` (+`floor(600/body_size)` тиков, `ceil(cost/2.5/body_size)` энергии); `recycleCreep(creep)` | DT:5649, DT:5751-5772, DT:5565, DT:5671, DT:5685 |
| `Spawning` | `{name, needTime, remainingTime, spawn, directions?}`, `cancel()`, `setDirections(dirs)` | DT:5696-5746 |
| `StructureController` | `level` 0-8, `progress`, `progressTotal`, `ticksToDowngrade`, `upgradeBlocked`, `safeMode?`, `safeModeAvailable`, `safeModeCooldown?`, `isPowerEnabled`, `reservation`, `sign`, `activateSafeMode()`, `unclaim()` | DT:5963-6033 |
| `StructureTower` | `attack`/`heal`/`repair`; `TOWER_ENERGY_COST=10`, `POWER_ATTACK=600`, `POWER_HEAL=400`, `POWER_REPAIR=800`, `OPTIMAL_RANGE=5`, `FALLOFF_RANGE=20`, `FALLOFF=0.75`, `CAPACITY=1000` | DT:6360-6386, API:6359-6391 |
| `StructureLink` | `transferEnergy(targetLink, amount?)` — только та же комната; `cooldown`; `CAPACITY=800`, `COOLDOWN=1` (1 тик на тайл), `LOSS_RATIO=0.03` | DT:6117, API:5465-5479, API:23633, ENG-structures.js:526 |
| `StructureLab` | `runReaction(lab1, lab2)`, `reverseReaction`, `boostCreep(creep, bodyPartsCount?)`, `unboostCreep`; `MINERAL_CAPACITY=3000`, `ENERGY_CAPACITY=2000`, `BOOST_ENERGY=20`, `BOOST_MINERAL=30`, `REACTION_AMOUNT=5` | DT:6535,6517,6482,6499, API:6359 |
| `StructureTerminal` | `send(resourceType, amount, destination, description?)`; `TERMINAL_CAPACITY=300000`, `SEND_COST=0.1`, `MIN_SEND=100` | DT:6573, API:6395-6415 |
| `StructureObserver` | `observeRoom(roomName)`; `OBSERVER_RANGE=10` | DT:6163, API:6399 |
| `StructureRampart` | `ticksToDecay`, `isPublic`, `setPublic(bool)` → `undefined` | DT:6259-6276 |
| `StructureWall` / `StructureRoad` / `StructureContainer` | только унаследованное; `WALL_HITS_MAX=300000000`, `ROAD_WEAROUT=1`, `CONTAINER_CAPACITY=2000` | DT:6280+, API:6383, API:6367 |
| `StructureExtractor` | без своих методов; `EXTRACTOR_COOLDOWN=5` | DT:6130-6148, API:6443 |
| `StructureNuker` | `launchNuke(pos)`; `NUKE_LAND_TIME=50000`, **`NUKE_RANGE=10`** (не 50 — сверено с `screeps/common/lib/constants.js`), `NUKER_COOLDOWN=100000`, `ENERGY_CAPACITY=300000`, `GHODIUM_CAPACITY=5000` | DT:6662, API:3382-3410, [C] |
| `StructureFactory` | `produce(resource)`, `level?` (задаётся `PWR_OPERATE_FACTORY`, потом не меняется), `cooldown` | DT:6731, DT:6703-6710 |
| `StructurePowerSpawn` | `processPower()` — см. скилл `screeps-power-intershard` | DT:6238 |
| `StructureInvaderCore` | `level`, `ticksToDeploy`, `spawning: Spawning \| null` | DT:6741-6757 |
| `StructurePortal` | `destination: RoomPosition \| {shard, room}`, `ticksToDecay: number \| undefined` | DT:6675-6689 |

`OwnedStructure` добавляет `my: boolean` и `owner`; у стен и дорог их **нет** — они нейтральные (DT:5932-5950).

### Прочие RoomObject

Базовый `RoomObject` даёт `pos`, `room?: Room`, `effects?: RoomObjectEffect[]`.

| Объект | Поля | Источник |
| --- | --- | --- |
| `Source` | `energy`, `energyCapacity`, `ticksToRegeneration`; реген раз в `ENERGY_REGEN_TIME=300` | DT:5460+, DT:102 |
| `Mineral` | `mineralType`, `mineralAmount`, `density`, `ticksToRegeneration?` | DT:3754-3782 |
| `Resource` (на земле) | `amount`, `resourceType`, `id` | DT:4505-4521 |
| `Ruin` / `Tombstone` | `store: StoreDefinitionUnlimited`, `ticksToDecay` + (`structure`, `destroyTime`) / (`creep`, `deathTime`) | DT:5454-5477, DT:6862-6884 |
| `Flag` / `ConstructionSite` | `name`, `color`, `secondaryColor`, `memory` / `progress`, `progressTotal`, `structureType`, `my`, `owner` | DT, DT:1040-1067 |
| `Nuke` / `Deposit` | `launchRoomName`, `timeToLand` / `depositType`, `cooldown`, `lastCooldown`, `ticksToDecay` | DT |
| Максимумы | ≤100 construction sites (DT:5203) и ≤10000 флагов (DT:5267) на игрока | DT:5203, DT:5267 |

### RoomVisual: полный список примитивов

`line`, `circle`, `rect`, `poly`, `text`, `clear`, `getSize`, `export`, `import` (DT:4904-5015).
Конструктор `new RoomVisual(roomName?)`; без аргумента — рисует во всех комнатах. Лимит **512000 байт (500 KB)** на
комнату. **`rawVisual` НЕ существует** (grep: 0 совпадений в DT).

### Коды возврата: полная таблица

| Константа | Значение | Типичный источник |
| --- | --- | --- |
| `OK` | 0 | всё |
| `ERR_NOT_OWNER` | -1 | чужой объект; враждебный рампорт над целью withdraw |
| `ERR_NO_PATH` | -2 | `findPath`, `moveTo` |
| `ERR_NAME_EXISTS` | -3 | `spawnCreep`, `createFlag`, `PowerCreep.create` |
| `ERR_BUSY` | -4 | крип ещё спавнится; спавн занят; `setShardLimits` в кулдауне |
| `ERR_NOT_FOUND` | -5 | `harvest` без extractor; `cancelOrder` |
| `ERR_NOT_ENOUGH_RESOURCES` | -6 | нет ресурса/энергии |
| `ERR_NOT_ENOUGH_ENERGY` | -6 | **то же число**, что `ERR_NOT_ENOUGH_RESOURCES` |
| `ERR_NOT_ENOUGH_EXTENSIONS` | -6 | **то же число** |
| `ERR_INVALID_TARGET` | -7 | неверный тип цели |
| `ERR_FULL` | -8 | переполнение; >20 notify за тик |
| `ERR_NOT_IN_RANGE` | -9 | цель далеко |
| `ERR_INVALID_ARGS` | -10 | кривые аргументы; силы не включены в комнате |
| `ERR_TIRED` | -11 | fatigue > 0; кулдаун |
| `ERR_NO_BODYPART` | -12 | нет нужной части тела |
| `ERR_RCL_NOT_ENOUGH` | -14 | мало уровня контроллера |
| `ERR_GCL_NOT_ENOUGH` | -15 | мало GCL для claim |
| `ERR_ACCESS_DENIED` | -16 | шард с ограниченным доступом |

Источник всей таблицы: DT:2456-2473. **Важно:** `ERR_NOT_ENOUGH_ENERGY`, `ERR_NOT_ENOUGH_EXTENSIONS` и
`ERR_NOT_ENOUGH_RESOURCES` — одно и то же число `-6`, поэтому `switch` по ним не различит случаи.

### Поисковые константы: числовые значения

`FIND_*` — источник для `Room.find`/`findClosestBy*` (DT:2520-2547):

| Значение | `FIND_*` | Значение | `FIND_*` |
| --- | --- | --- | --- |
| 1 / 3 / 5 / 7 | `FIND_EXIT_TOP` / `_RIGHT` / `_BOTTOM` / `_LEFT` | 10 | `FIND_EXIT` |
| 101 / 102 / 103 | `FIND_CREEPS` / `FIND_MY_CREEPS` / `FIND_HOSTILE_CREEPS` | 104 / 105 | `FIND_SOURCES_ACTIVE` / `FIND_SOURCES` |
| 106 / 107 | `FIND_DROPPED_RESOURCES` / `FIND_STRUCTURES` | 108 / 109 | `FIND_MY_STRUCTURES` / `FIND_HOSTILE_STRUCTURES` |
| 110 / 111 | `FIND_FLAGS` / `FIND_CONSTRUCTION_SITES` | 112 / 113 | `FIND_MY_SPAWNS` / `FIND_HOSTILE_SPAWNS` |
| 114 / 115 | `FIND_MY_CONSTRUCTION_SITES` / `FIND_HOSTILE_CONSTRUCTION_SITES` | 116 / 117 | `FIND_MINERALS` / `FIND_NUKES` |
| 118 / 119 | `FIND_TOMBSTONES` / `FIND_POWER_CREEPS` | 120 / 121 | `FIND_MY_POWER_CREEPS` / `FIND_HOSTILE_POWER_CREEPS` |
| 122 / 123 | `FIND_DEPOSITS` / `FIND_RUINS` | — | `FIND_PORTAL` **не существует** (порталы — `FIND_STRUCTURES` + `STRUCTURE_PORTAL`) |

`LOOK_*` — строки для `Room.lookAt*`/`lookForAt*` (DT:2592-2605): `LOOK_CREEPS="creep"`,
`LOOK_ENERGY="energy"`, `LOOK_RESOURCES="resource"`, `LOOK_SOURCES="source"`, `LOOK_MINERALS="mineral"`,
`LOOK_STRUCTURES="structure"`, `LOOK_FLAGS="flag"`, `LOOK_CONSTRUCTION_SITES="constructionSite"`,
`LOOK_NUKES="nuke"`, `LOOK_TERRAIN="terrain"`, `LOOK_TOMBSTONES="tombstone"`, `LOOK_POWER_CREEPS="powerCreep"`,
`LOOK_DEPOSITS="deposit"`, `LOOK_RUINS="ruin"`. `LOOK_PORTALS` **не существует**.
Прочие константы: `TERRAIN_MASK_*` — строка 81; `COLOR_*` — DT:2637-2646 (1=red … 10=white);
направления — DT:2614-2621 (`TOP=1`, `TOP_RIGHT=2`, `RIGHT=3`, … `TOP_LEFT=8`).

### Устаревшее → актуальное

| Устарело | Актуально | Источник |
| --- | --- | --- |
| `creep.carry`, `creep.carryCapacity` | `creep.store`, `creep.store.getUsedCapacity()` / `.getCapacity()` | DT:1114-1121 |
| `spawn.createCreep(body, name, memory)` | `spawn.spawnCreep(body, name, opts)` | DT:5625 (deprecated), DT:5649 |
| `spawn.canCreateCreep(body, name)` | `spawn.spawnCreep(body, name, {dryRun: true})` | DT:5627 |
| `extension.energy`, `link.energy`, `powerSpawn.power` | `store[RESOURCE_ENERGY]`, `store[RESOURCE_POWER]` | DT:6054, DT:6088, DT:6217 |
| `container.storeCapacity`, `storage.storeCapacity` | `store.getCapacity()` | DT:6597, DT:6317 |
| `RawMemory.interShardSegment` | `InterShardMemory` (см. скилл `screeps-power-intershard`) | DT:4431 |
| `Game.map.getTerrainAt` | `Game.map.getRoomTerrain` / `room.getTerrain()` | DT:3226, ENG-map.js:236 |
| `Memory.creeps` автоочистка | **[НЕ ПРОВЕРЕНО]** — в DT, ENG и docs.screeps.com/api явного утверждения нет | — |

## Рецепты

Все сниппеты используют только подтверждённые методы.

**1. Безопасный поиск объекта по id (getObjectById возвращает null, а не undefined):**

```js
const obj = Game.getObjectById(creep.memory.targetId);
if (!obj) {          // объект разрушен/пропал — id надо перевыбрать
    delete creep.memory.targetId;
    return;
}
```

**2. Найти ближайший источник и ехать к нему, не тратя CPU на путь каждый тик:**

```js
const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
if (source) {
    // reusePath по умолчанию 5 — путь кэшируется в creep.memory._move
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) creep.moveTo(source);
}
```

**3. Сборка/ремонт с проверкой кодов вместо «магических» чисел:**

```js
const site = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
if (site) {
    const rc = creep.build(site);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(site, { range: 3 });
    else if (rc === ERR_NOT_ENOUGH_RESOURCES) creep.memory.task = 'refill';
}
```

**4. Разгрузка в spawn/extension через Store API (работает для любого Store-объекта):**

```js
function giveEnergy(creep, target) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return false;
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(target);
    return true;
}
// freeCapacity(resource) у лимитированного store считает только этот ресурс
const needEnergy = Game.spawns.Spawn1.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
```

**5. Спавн с dryRun и явным списком энергоструктур:**

```js
const body = [WORK, CARRY, MOVE];
const name = 'harv_' + Game.time;
if (spawn.spawnCreep(body, name, { dryRun: true }) === OK) {
    spawn.spawnCreep(body, name, {
        memory: { role: 'harvester' },
        energyStructures: spawn.room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN,
        }),
        directions: [TOP, TOP_RIGHT, RIGHT],
    });
}
if (spawn.spawning) creep.say(spawn.spawning.remainingTime + '');
```

**6. Террейн и путь: `Room.Terrain` читает статику даже без видимости комнаты, а `serializePath` — статический метод `Room`:**

```js
const raw = new Room.Terrain('W1N1').getRawBuffer();   // Uint8Array длиной 2500
const isWall = (x, y) => raw[y * 50 + x] === TERRAIN_MASK_WALL;
const t2 = Game.rooms['W1N1'].getTerrain();            // метод экземпляра Room

const path = creep.room.findPath(creep.pos, target.pos, { ignoreCreeps: true });
creep.memory.path = Room.serializePath(path);          // Room.*, не creep.room.*
creep.moveByPath(creep.memory.path);                   // строка тоже принимается
```

**7. `store` отдаёт `0` для отсутствующего ресурса — `if (x)` больше не различает «нет» и «ноль»:**

```js
if (creep.store[RESOURCE_ENERGY] > 0) { /* есть энергия */ }
if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) { /* полный */ }
// У универсальных store (creep, container, storage, terminal)
// getCapacity() без аргумента = общая ёмкость; у Ruin/Tombstone вернёт null.
```

**8. Визуализация (только подтверждённые примитивы):**

```js
const v = creep.room.visual;
v.circle(creep.pos, { radius: 0.4, fill: '#00ff00', opacity: 0.3 });
v.line(creep.pos, target.pos, { color: '#ff0000', width: 0.1, lineStyle: 'dashed' });
v.text('haul', creep.pos.x, creep.pos.y - 0.7, { color: '#ffffff', font: 0.5 });
// лимит: v.getSize() <= 512000 байт на комнату
```

## Подводные камни

1. **`Game.getObjectById` возвращает `null`, не `undefined`.** `getObjectByIdOrNull` не существует — это выдумка.
2. **`Carry`-стиль кода тихо ломается, а не падает.** `store[RESOURCE_ENERGY]` для отсутствующего ресурса возвращает `0`
   (Proxy в ENG-store.js:78), поэтому `if (creep.store[RESOURCE_ENERGY])` технически верен, но `store.getUsedCapacity()`
   без аргумента считает сумму **всех** ресурсов — легко получить неверный порог.
3. **`transfer` контроллеру — это `upgradeController`.** ENG-creeps.js:455-457 перенаправляет вызов, если
   `resourceType === RESOURCE_ENERGY` и цель `controller`. Возврат будет от другой функции.
4. **`ERR_NOT_ENOUGH_ENERGY`, `ERR_NOT_ENOUGH_RESOURCES`, `ERR_NOT_ENOUGH_EXTENSIONS` — все `-6`.**
   Различить «нет энергии» и «нет минерала» по коду невозможно (DT:2462,2463,2470).
5. **`Game.deposits`, `Game.ruins`, `Game.nukes`, `Game.invaderCores`, `Game.notifications` не существуют.**
   Только `Room.find(FIND_DEPOSITS | FIND_RUINS | FIND_NUKES)` и `Game.notify()`.
6. **`Room.serializePath` — статический.** `creep.room.serializePath(...)` — ошибка; правильно `Room.serializePath(...)`
   (DT:5417 vs Room-интерфейс).
7. **`Room.getTerrain()` существует, `Room.saveTerrain` — нет.** Террейн неизменяем; его можно только читать
   (`new Room.Terrain(name)`, `room.getTerrain()`, `Game.map.getRoomTerrain(name)`).
8. **`Creep.massAttack` и `Creep.runReaction` не существуют** — только `rangedMassAttack()` и
   `StructureLab.runReaction(lab1, lab2)`.
9. **`Creep.transfer` принимает `AnyCreep | Structure`, а `withdraw` — только `Structure | Tombstone | Ruin`.**
   Передать ресурс крипу можно только `transfer` (DT:1592, DT:1619).
10. **`spawn.isSpawning` не существует** — используйте `spawn.spawning` (`Spawning | null`), DT:5565.
11. **`Room.find` с `filter`-объектом делает глубокое частичное сравнение** (`DeepPartial<T>`, DT:2557) — вложенный
    `pos` не сработает как ожидается; для позиций используйте функцию.
12. **`moveTo` вернёт `ERR_TIRED`, если fatigue > 0** — ENG-creeps.js:173. Код, который смотрит только на
    `ERR_NOT_IN_RANGE`, будет молча стоять.
13. **`Game.cpu.setShardLimits` — не чаще 1 раза в 12 часов** (DT:2007). Частый вызов даст `ERR_BUSY`.

## Источники

Легенда: **DT** = https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/screeps/index.d.ts
(скачан в этой сессии, 6875 строк; `DT:<строка>` — номер строки в этом файле).
**API** = https://docs.screeps.com/api/ (полная страница API-справочника; `API:<строка>` — строка в текстовой выгрузке).
**ENG-<файл>** = файл `src/game/<файл>` репозитория screeps/engine (шаблон пути, не ссылка; скачан в этой сессии).
**CPU** = https://docs.screeps.com/cpu-limit.html. **GO** = https://docs.screeps.com/global-objects.html.

| Источник | Что подтверждает |
| --- | --- |
| DT (весь файл, 6875 строк) | Полный список членов `Game`, все сигнатуры Creep/Room/структур, `POWER_INFO`, литеральные значения `ERR_*`/`FIND_*`/`LOOK_*`/`TERRAIN_MASK_*`/`COLOR_*`/направлений, пометки `@deprecated` |
| https://docs.screeps.com/api/ | Таблицы «Controller level / Cost / Hits / Capacity» для структур, значения `TOWER_*`, `LINK_*`, `LAB_*`, `NUKER_*`, `TERMINAL_*`, `CONTAINER_*`, `EXTENSION_ENERGY_CAPACITY`, буфер `RoomVisual`, коды возврата с описаниями |
| https://raw.githubusercontent.com/screeps/engine/master/src/game/game.js | Состав объекта `game` (`src/game/game.js:125-176`), реализация `getObjectById` (`:170`), список типов структур (`:229-252`) |
| https://raw.githubusercontent.com/screeps/engine/master/src/game/store.js | Реализация `Store`: `getCapacity`/`getUsedCapacity`/`getFreeCapacity`, Proxy, возвращающий `0` для отсутствующего ресурса (`:20-90`) |
| https://raw.githubusercontent.com/screeps/engine/master/src/game/creeps.js | Порядок проверок в `moveTo` (`:158-178`), перенаправление `transfer` контроллеру в `upgradeController` (`:455-457`), `harvest` (`:335-363`) |
| https://raw.githubusercontent.com/screeps/engine/master/src/game/structures.js | `processPower` (`:613-631`), `StructureLink.transferEnergy` (`:488-528`), `defineGameObjectProperties` для energy/power-алиасов |
| https://raw.githubusercontent.com/screeps/engine/master/src/game/map.js | `Game.map` методы, пометки deprecated для `getTerrainAt`/`isRoomAvailable` |
| https://docs.screeps.com/cpu-limit.html | Bucket: лимит 10 000 CPU, до 500 CPU за тик, смысл `Game.cpu.tickLimit` |
| https://docs.screeps.com/global-objects.html | `Game` создаётся заново каждый тик; `Memory` — JSON, лимит 2 MB; `creep.memory` — алиас `Memory.creeps[name]` |
