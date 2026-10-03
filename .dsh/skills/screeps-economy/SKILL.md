---
name: screeps-economy
description: Проверенная арифметика экономики комнаты Screeps — RCL-лимиты и ёмкости, добыча и регенерация источников, стоимость/время спавна, пропорции ролей, логистика link/container/storage/terminal/lab/factory, удалённая добыча и GCL.
whenToUse: Когда нужно посчитать числа для комнаты — сколько крипов и частей тела на N источников, сколько энергии уходит в апгрейд/спавн, сколько живёт контейнер, окупается ли remote-комната, когда доступен terminal/factory и сколько нужно GCL.
---

# Экономика комнаты (RCL, энергия, роли, логистика)

Все числа ниже скачаны и проверены в этой сессии. Теги источников: `[C]` — константы движка
(engine подключает их как `driver.constants`, см. `engine/src/game/constants.js`: `module.exports = driver.constants`),
`[E/i/X]` — файл `src/processor/intents/X.js` репозитория screeps/engine;
`[E/…]` — прочие файлы `src/…` того же репозитория (шаблоны путей, не ссылки).
Полные URL — в разделе «Источники».

## Когда использовать

Перед планированием квот крипов, тела крипа, цепочки link/lab/factory, remote-рум и claim:
здесь лежат исходные константы движка и явные формулы, чтобы не считать «на глаз».
Если факт помечен `[НЕ ПРОВЕРЕНО]` — он не подтверждён исходником и не должен быть основанием для решения.

## Ключевые факты

### 1. RCL: что открывается, сколько энергии и какой downgrade

| RCL | энергия в контроллер до след. уровня | extensions | spawns | макс. энергия комнаты | towers | links | labs | terminal | прочее | downgrade, тиков |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 0 | 1 | 300 | 0 | 0 | 0 | — | 5 containers, 2500 roads | 20000 |
| 2 | 45 000 | 5 × 50 | 1 | 550 | 0 | 0 | 0 | — | walls/ramparts (300K) | 10000 |
| 3 | 135 000 | 10 × 50 | 1 | 800 | 1 | 0 | 0 | — | ramparts 1M | 20000 |
| 4 | 405 000 | 20 × 50 | 1 | 1300 | 1 | 0 | 0 | storage 1 | ramparts 3M | 40000 |
| 5 | 1 215 000 | 30 × 50 | 1 | 1800 | 2 | 2 | 0 | storage 1 | ramparts 10M | 80000 |
| 6 | 3 645 000 | 40 × 50 | 1 | 2300 | 2 | 3 | 3 | extractor + terminal | ramparts 30M | 120000 |
| 7 | 10 935 000 | 50 × 100 | 2 | 5600 | 3 | 4 | 6 | extractor + terminal + factory | ramparts 100M | 150000 |
| 8 | — (максимум) | 60 × 200 | 3 | 12 900 | 6 | 6 | 10 | + observer, powerSpawn, nuker | ramparts 300M | 200000 |

Источники строки: `[C]` → `CONTROLLER_LEVELS`, `CONTROLLER_STRUCTURES`, `EXTENSION_ENERGY_CAPACITY`, `SPAWN_ENERGY_CAPACITY`, `CONTROLLER_DOWNGRADE`, `RAMPART_HITS_MAX`, `STORAGE_CAPACITY`;
независимая сверка таблицы по RCL — `[DOC/control]` (там же «Roads, 5 Containers» на RCL 0).
Макс. энергия = `spawns × SPAWN_ENERGY_CAPACITY(300) + extensions × EXTENSION_ENERGY_CAPACITY[RCL]` (арифметика в разделе «Рецепты», п. 6).

- `CONTROLLER_LEVELS` не содержит ключа 8: на RCL 8 энергия в контроллер не двигает уровень, а идёт в GCL `[C]`, `[DOC/control]`.
- В задании фигурировало «RCL 8 → 15 extensions по 200» — по движку это **не так**: `CONTROLLER_STRUCTURES.extension[8] = 60`, `EXTENSION_ENERGY_CAPACITY[8] = 200` `[C]`.
- `CONTROLLER_DOWNGRADE` `[C]`: `{1:20000, 2:10000, 3:20000, 4:40000, 5:80000, 6:120000, 7:150000, 8:200000}`.
  `[DOC/control]` в тексте говорит «5,000 game ticks at RCL 2», движок — 10000 → **расхождение доки и движка**, верить `[C]`.
- Containers — 5 на любом RCL, включая 0; roads — 2500; constructedWall/rampart — 2500 с RCL 2 `[C]` `CONTROLLER_STRUCTURES`.

### 2. Источники энергии, добыча, минералы

| факт | значение | источник |
|---|---|---|
| `SOURCE_ENERGY_CAPACITY` (комната под контролем или резервом) | 3000 | `[C]` + `[E/i/sources/tick]` (capacity переключается по `roomController.user \|\| roomController.reservation`) |
| `SOURCE_ENERGY_NEUTRAL_CAPACITY` (нейтральная комната) | 1500 | `[C]` |
| `SOURCE_ENERGY_KEEPER_CAPACITY` (комната keeper-сектора) | 4000 | `[C]` |
| `ENERGY_REGEN_TIME` | 300 тиков | `[C]` |
| момент старта таймера регенерации | когда источник впервые стал неполным (`energy < energyCapacity`), затем `nextRegenerationTime = gameTime + 300` | `[E/i/sources/tick]` |
| `HARVEST_POWER` | 2 энергии за 1 WORK за тик | `[C]` |
| `HARVEST_MINERAL_POWER` | 1 единица минерала за 1 WORK | `[C]` |
| `EXTRACTOR_COOLDOWN` | 5; после удачной добычи `extractor._cooldown = 5`, а `harvest` минерала требует `extractor.cooldown == 0` | `[C]`, `[E/i/creeps/harvest]`, `[E/i/extractors/tick]` |
| `MINERAL_REGEN_TIME` | 50000 тиков, затем `mineralAmount = MINERAL_DENSITY[density]` (15000/35000/70000/100000) | `[C]`, `[E/i/minerals/tick]` |
| `MINERAL_DENSITY_CHANGE` | 0.05 (шанс смены плотности при регенерации) | `[C]`, `[E/i/minerals/tick]` |
| добыча в чужой комнате | `harvest` источника не срабатывает, если контроллер занят другим игроком или резерв другого игрока | `[E/i/creeps/harvest]` |
| `CARRY_CAPACITY` | 50 на часть CARRY | `[C]` |
| `CREEP_LIFE_TIME` | 1500 тиков (`CREEP_CLAIM_LIFE_TIME` = 600 для тела с CLAIM) | `[C]` |
| `CREEP_CORPSE_RATE` | 0.2 — доля стоимости тела, падающая в tombstone при обычной смерти | `[C]`, `[E/i/creeps/_die]` |
| `ENERGY_DECAY` | 1000: брошенный ресурс теряет `ceil(amount/1000)` за тик | `[C]`, `[E/i/energy/tick]` |

**Вывод по пропускной способности:** максимум устоявшейся добычи с источника = `3000 / 300 = 10` энергии/тик.
5 WORK дают ровно 10/тик; больше WORK не увеличивает средний поток (только сливает источник быстрее 300 тиков).

Энергия из storage/terminal: это обычный store — `withdraw`/`transfer` работают как с контейнером,
ёмкости: `STORAGE_CAPACITY` 1 000 000 `[C]`, `TERMINAL_CAPACITY` 300 000 `[C]`, `CONTAINER_CAPACITY` 2000 `[C]`.

### 3. Части тела, стоимость, спавн

| факт | значение | источник |
|---|---|---|
| `BODYPART_COST` | move 50, carry 50, work 100, attack 80, ranged_attack 150, heal 250, tough 10, claim 600 | `[C]` |
| `CREEP_SPAWN_TIME` | 3 тика на часть; `needTime = 3 × body.length` | `[C]`, `[E/i/spawns/create-creep]` |
| `MAX_CREEP_SIZE` | 50 частей (тело длиннее обрезается движком до 50) | `[C]`, `[E/i/spawns/create-creep]` |
| откуда берётся энергия | `Room.energyAvailable` = сумма `store.energy` всех не-off spawn и extension комнаты; альтернативно `opts.energyStructures` (только spawn/extension) | `[E/processor]`, `[E/i/spawns/_charge-energy]` |
| `spawnCreep(body, name, opts)` | `opts`: `memory`, `energyStructures`, `dryRun`, `directions` (1..8, дубликаты убираются, иначе `ERR_INVALID_ARGS`) | `[E/structures]` (`StructureSpawn.prototype.spawnCreep`, ~стр. 1063), `[DOC/api]` |
| порядок выхода крипа | перебор `directions`, первая свободная клетка; иначе первая клетка без hostile creep | `[E/i/spawns/_born-creep]` |
| ошибки `spawnCreep` | `ERR_NAME_EXISTS`, `ERR_BUSY`, `ERR_NOT_ENOUGH_ENERGY`, `ERR_INVALID_ARGS`, `ERR_RCL_NOT_ENOUGH`; проверка энергии выполняется до постановки интента | `[E/structures]`, `[DOC/api]` |
| `renewCreep` | +`floor(600 / body.length)` тиков жизни за `ceil(creepCost / 2.5 / body.length)` энергии; снимает все бусты; запрещён для тела с CLAIM | `[DOC/api]`, `[E/i/spawns/renew-creep]` (`SPAWN_RENEW_RATIO` 1.2 × `CREEP_LIFE_TIME` 1500 / `CREEP_SPAWN_TIME` 3) |
| `recycleCreep` | возврат при `dropRate = 1.0`: по каждой части `min(125, BODYPART_COST[type] × ttl/1500)` энергии, за буст ещё 30 минерала и 20 энергии; ресурс падает в контейнер на клетке, иначе в tombstone | `[E/i/spawns/recycle-creep]`, `[E/i/creeps/_die]`, `[C]` `CREEP_PART_MAX_ENERGY` |
| `StructureSpawn.Spawning.cancel()` | энергия за спавн **не** возвращается | `[DOC/api]` |

### 4. Движение и усталость (нужно для haulers и дорог)

| факт | значение | источник |
|---|---|---|
| усталость за шаг | `(части кроме MOVE и CARRY + вес груза в частях CARRY) × fatigueRate` | `[E/movement]` |
| `fatigueRate` | 2 — plain, 10 — swamp, 1 — road | `[E/movement]` |
| восстановление | `-2 × (число MOVE-частей с учётом буста) ` за тик | `[E/i/creeps/tick]`, `[C]` `BOOSTS.move` |
| вес груза | число CARRY-частей, нужных чтобы унести текущий `store` (буст CARRY KH ×2, KH2O ×3, XKH2O ×4) | `[E/movement]`, `[C]` `BOOSTS` |
| износ дороги | `ROAD_WEAROUT` 1 хит × `body.length` за шаг по дороге; `ROAD_DECAY_AMOUNT` 100 за `ROAD_DECAY_TIME` 1000 тиков (swamp ×5, wall ×150) | `[C]`, `[E/movement]`, `[E/i/roads/tick]` |

Практический смысл: hauler «N CARRY + N MOVE» при полном грузе двигается 1 клетка/тик
(вес = N, восстановление = 2N ≥ 2N), а любая WORK/ATTACK-часть в теле делает его медленнее.

### 5. Логистика: container / link / storage / terminal / factory / lab

| структура | ёмкость | прочее | источник |
|---|---|---|---|
| container | 2000 | 250 000 хитов; распад 5000 хитов каждые 100 тиков без контроллера в комнате и каждые 500 тиков с контроллером (`CONTAINER_DECAY`, `CONTAINER_DECAY_TIME`, `CONTAINER_DECAY_TIME_OWNED`) | `[C]`, `[E/i/containers/tick]` |
| link | 800 энергии | `transferEnergy`: потеря `ceil(amount × 0.03)` у получателя (`LINK_LOSS_RATIO`), `cooldown += 1 × max(dx,dy)` (`LINK_COOLDOWN`) | `[C]`, `[E/i/links/transfer]` |
| storage | 1 000 000 | ёмкость 0, если RCL < 4 или комната не ваша; `PWR_OPERATE_STORAGE` добавляет до +7 000 000 | `[C]`, `[E/i/storages/tick]` |
| terminal | 300 000 | ёмкость 0 при RCL < 6; `TERMINAL_COOLDOWN` 10 тиков на отправку; 3000 хитов; постройка 100 000 энергии | `[C]`, `[E/i/terminal/tick]`, `[DOC/api]` |
| factory | 50 000 | ёмкость 0 при RCL < 7; уровень задаётся силой оператора `PWR_OPERATE_FACTORY` и не сбрасывается | `[C]`, `[E/i/factories/tick]`, `[E/i/factories/produce]`, `[DOC/resources]` |
| lab | 3000 минерала + 2000 энергии | 500 хитов; реакция забирает `LAB_REACTION_AMOUNT` = 5 с каждой реагентной лабы и кладёт 5 в лабу-приёмник; лабы должны быть в радиусе 2 | `[C]`, `[E/i/labs/run-reaction]`, `[E/structures]` (`runReaction`) |
| boost | 30 минерала + 20 энергии за одну часть тела | снимает эффект `renewCreep`, один буст на часть | `[C]` `LAB_BOOST_MINERAL`/`LAB_BOOST_ENERGY`, `[C]` `LAB_UNBOOST_MINERAL`, `[DOC/resources]` |

**Цепочки реакций (проверено разбором `REACTIONS` из `[C]`):**

- T0 (сырьё): H, O, U, L, K, Z, X.
- T1 (сырьё + сырьё, время реакции в тиках): OH = H+O (20), ZK = Z+K (5), UL = U+L (5), UH = U+H (10), UO = U+O (10), KH = K+H (10), KO = K+O (10), LH = L+H (15), LO = L+O (10), ZH = Z+H (20), ZO = Z+O (10).
- G = ZK + UL (5) — ghodium.
- T2 = OH + T1: UH2O (5), UHO2 (5), KH2O (5), KHO2 (5), LH2O (10), LHO2 (5), ZH2O (40), ZHO2 (5).
- T3-бусты = X + T2: XUH2O (60), XUHO2 (60), XKH2O (60), XKHO2 (60), XLH2O (65), XLHO2 (60), XZH2O (160), XZHO2 (60); GH = G+H (10), GO = G+O (10), GH2O = OH+GH (15), GHO2 = OH+GO (30), XGH2O = X+GH2O (80), XGHO2 = X+GHO2 (150).
- Эффекты бустов `[C]` `BOOSTS`: `WORK.GH2O.upgradeController = 1.8`, `WORK.XGH2O = 2`; `WORK.UHO2.harvest = 5`, `WORK.XUHO2 = 7`; `WORK.LH2O.build/repair = 1.8`, `WORK.XLH2O = 2`; `CARRY.KH2O.capacity = 3`, `CARRY.XKH2O = 4`; `MOVE.ZHO2.fatigue = 3`, `MOVE.XZHO2 = 4`.

**Фабрика: сжатие/распаковка (уровень «any level», проверено по `COMMODITIES` из `[C]`):**
`X_bar ← 500 X + 200 energy → 100 bar` (cooldown 20) и обратно `X ← 100 bar + 200 energy → 500` (20)
для U, L, Z, K, G, O, H, X; `battery ← 600 energy → 50` (10) и `energy ← 50 battery → 500` (10).
Региональные (silicon/metal/biomass/mist): `wire ← 20 utrium_bar + 100 silicon + 40 energy → 20` (8) и т.д.
Уровневые товары (level 1..5) требуют эффект `PWR_OPERATE_FACTORY` **того же уровня**, что и `COMMODITIES[res].level`,
и оператора с `POWER_INFO[PWR_OPERATE_FACTORY].level[n-1]` (0/2/7/14/22) `[E/i/factories/produce]`, `[C]`, `[DOC/resources]`.

### 6. Удалённая добыча

| факт | значение | источник |
|---|---|---|
| `reserveController` | +`CONTROLLER_RESERVE`(1) тик резерва за 1 CLAIM-часть за вызов; предел `CONTROLLER_RESERVE_MAX` = 5000 тиков | `[C]`, `[E/i/creeps/reserveController]` |
| условия | контроллер нейтрален, `target.owner` отсутствует, резерв не чужой | `[E/structures]` (`Creep.prototype.reserveController`) |
| резерв возвращает источнику полную ёмкость | да, `energyCapacity = SOURCE_ENERGY_CAPACITY` при `roomController.reservation` | `[E/i/sources/tick]` |
| контейнер в резервируемой комнате | `roomController.level == 0` → распад по «unowned» ветке: 5000 хитов / 100 тиков = 50 хитов/тик | `[E/i/containers/tick]` |
| триггер invader'ов | счётчик ~100 000 добытой энергии в комнате + случайная добавка | `[DOC/invaders]` |
| рейд | шанс 10 %, состав 2–5 крипов (melee/ranged/healer), часть с бустами | `[DOC/invaders]` |
| размеры | light — нейтральные/резерв/до RCL 3; heavy — свои комнаты RCL 4+ | `[DOC/invaders]` |
| где появляются | только на выходах в нейтральные комнаты; в комнатах с контроллером/резервом выход не используется | `[DOC/invaders]` |
| атака контроллера | `attackController` снимает `CONTROLLER_CLAIM_DOWNGRADE`(300) тиков downgrade за CLAIM-часть и вешает `upgradeBlocked = gameTime + CONTROLLER_ATTACK_BLOCKED_UPGRADE`(1000) | `[C]`, `[E/i/creeps/attackController]` |

### 7. Расширение: GCL, claim, CPU

| факт | значение | источник |
|---|---|---|
| сколько комнат | число комнат = уровень GCL («to control 3 rooms, you need to have GCL 3») | `[DOC/control]` |
| проверка при claim | `user.gcl < calcNeededGcl(claimedRooms + 1)` → `ERR_GCL_NOT_ENOUGH`; | `[E/creeps]`, `[E/i/creeps/claimController]` |
| `calcNeededGcl(n)` | `GCL_MULTIPLY × (n-1)^GCL_POW` = `1 000 000 × (n-1)^2.4` | `[E/utils]`, `[C]` |
| `Game.gcl.level` | `floor((gcl/1e6)^(1/2.4)) + 1`; `progressTotal` = `level^2.4 × 1e6 − base` | `[E/game]` |
| GCL-порог (накопленные очки) | GCL2 1 000 000; GCL3 5 278 032; GCL4 13 966 610; GCL5 27 857 618; GCL6 47 591 348; GCL7 73 716 210; GCL8 106 717 415 | расчёт по `[E/utils]` (см. «Рецепты», п. 8) |
| вклад в GCL | любое `upgradeController` добавляет к GCL ту же величину `boostedEffect`, что и в прогресс контроллера, включая буст | `[E/i/creeps/upgradeController]` |
| CPU | старт 20 CPU; при разблокировке CPU Unlock +10 CPU за уровень GCL до предела 300 | `[DOC/control]` |
| `Game.cpu.limit` / `tickLimit` / `bucket` | лимит аккаунта / лимит шарда на тик / накопленный bucket | `[DOC/api]` |
| вход в комнату для выбора цели | `Game.map.describeExits`, `Game.map.getRoomTerrain`, `Room.find(FIND_SOURCES)`, `FIND_MINERALS`, `Room.Terrain.get` | `[DOC/api]` (перечислены как существующие) |

## Арифметика экономики / Рецепты

**1. WORK на источник.** `rate = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME = 3000/300 = 10` энергии/тик.
`WORK = rate / HARVEST_POWER = 10/2 = 5`. Для 2 источников — 2 × 5 = **10 WORK** (20 энергии/тик).
6 WORK на источник дают 12/тик и сливают источник за `ceil(3000/12) = 250` тиков, после чего 50 тиков простоя: средний поток тот же.

**2. CARRY на источник (hauler от контейнера/link к потребителю).**
`N_CARRY = ceil(E × 2d / CARRY_CAPACITY)`, где `E` — поток (10 энергии/тик с источника), `d` — расстояние в клетках в одну сторону,
`2d` — время рейса в тиках при 1 клетке/тик (`[C]` `CARRY_CAPACITY`, `[E/movement]`).

| d | 2d | N_CARRY при E=10 | стоимость тела N CARRY + N MOVE | время спавна |
|---|---|---|---|---|
| 5 | 10 | ceil(100/50) = 2 | 2×50 + 2×50 = 200 | 4 части × 3 = 12 тиков |
| 10 | 20 | 4 | 400 | 24 тика |
| 20 | 40 | 8 | 800 | 48 тиков |
| 30 | 60 | 12 | 1200 | 72 тика |

Стоимость тела — `[C]` `BODYPART_COST` (carry 50, move 50), время — `CREEP_SPAWN_TIME` 3 тика/часть `[C]`.
Накладные расходы перевозки = `стоимость тела / CREEP_LIFE_TIME`: при d=10 это 400/1500 ≈ 0.27 энергии/тик (2.7 % от 10),
при d=20 — 0.53/тик (5.3 %), при d=30 — 0.8/тик (8 %).

**3. Апгрейд против спавна.** `UPGRADE_CONTROLLER_POWER = 1` → 1 WORK = 1 очко прогресса/тик и 1 энергия/тик `[C]`, `[E/i/creeps/upgradeController]`.
RCL 2 → 3 стоит 45 000 прогресса `[C]` `CONTROLLER_LEVELS` = 45 000 энергии.
При доходе 20 энергии/тик (2 источника) и апгрейдере на 20 WORK: `45000 / 20 = 2250` тиков **если вся энергия идёт в апгрейд**;
каждый крип, ушедший в спавн/harvest-инфраструктуру, удлиняет срок.
На RCL 8 в прогресс уходит максимум `CONTROLLER_MAX_UPGRADE_PER_TICK = 15` энергии/тик на контроллер `[C]`, `[E/i/creeps/upgradeController]`
(с `PWR_OPERATE_CONTROLLER` лимит повышается на `POWER_INFO[PWR_OPERATE_CONTROLLER].effect[level-1]`).

**4. Builder.** `BUILD_POWER = 5`: 1 энергия = 5 очков стройки, `buildEffect = min(5 × WORK, остаток, энергия в store)` `[C]`, `[E/i/creeps/build]`.
Пример: extension (3000 очков `[C]` `CONSTRUCTION_COST`) при 5 WORK = 25 очков/тик → `3000/25 = 120` тиков и 600 энергии.

**5. Repairer / wall-rampart maintainer.** `REPAIR_COST = 0.01` → 1 энергия = 100 хитов, `REPAIR_POWER = 100` хитов на WORK за тик `[C]`, `[E/i/creeps/repair]`.
Распад: rampart `RAMPART_DECAY_AMOUNT` 300 хитов за `RAMPART_DECAY_TIME` 100 тиков = 3 хита/тик → 0.03 энергии/тик на рампарт `[C]`, `[E/i/ramparts/tick]`.
Один WORK (100 хитов/тик) держит ~33 рампарта. Для контейнера в резервируемой комнате: 50 хитов/тик × 0.01 = 0.5 энергии/тик, т.е. 0.5 WORK-части `[E/i/containers/tick]`.
`RAMPART_HITS_MAX[8] = 300 000 000` → полный ремонт с нуля = 3 000 000 энергии `[C]`.

**6. Максимальная энергия комнаты** (для проверки overflow): `E_max = spawns × 300 + extensions × cap(RCL)`.
RCL 8: `3 × 300 + 60 × 200 = 900 + 12000 = 12 900`.

**7. Очередь спавна.** Время = `3 × частей` `[C]`. Один спавн за жизнь крипа (1500 тиков) может выдать `1500 / (3 × 50) = 10` крипов по 50 частей.
Пример: `5 WORK + 1 MOVE` (стоимость 550) спавнится 18 тиков; за 1500 тиков один спавн делает 83 таких крипа, а доход 10 энергии/тик за это время — 15 000 энергии, т.е. 27 тел по 550: узкое место — энергия, не спавн.

**8. GCL-порог.** `points(n) = 1e6 × (n-1)^2.4` `[E/utils]`: GCL3 = `1e6 × 2^2.4` = 5 278 032;
дельта GCL2→3 = 4 278 032 очка. При 15 очках/тик (потолок RCL 8) это `ceil(4278032/15)` ≈ 285 203 тика ≈ 79 часов при 1 тик/с.
Крип с `XGH2O` даёт до `WORK × 2` очков за тик `[C]` `BOOSTS.work.XGH2O.upgradeController = 2`.

**9. Срок жизни контейнера.** 250 000 хитов `[C]` `CONTAINER_HITS`.
Свой контроллер: 5000/500 = 10 хитов/тик → 25 000 тиков. `roomController.level == 0` (нейтральная/резервируемая комната): 50 хитов/тик → 5000 тиков `[E/i/containers/tick]`.

## Подводные камни

- **`upgradeBlocked`**: после `attackController` апгрейд не идёт 1000 тиков `[E/i/creeps/attackController]` — апгрейдеры будут «жечь» CPU впустую.
- **Апгрейд с почти истёкшим таймером не даёт уровень**: переход на следующий RCL требует
  `downgradeTime + CONTROLLER_DOWNGRADE_RESTORE(100) >= gameTime + CONTROLLER_DOWNGRADE[level]` `[E/i/creeps/upgradeController]`.
  Каждый тик апгрейда добавляет к таймеру до 100 тиков (не больше `gameTime + CONTROLLER_DOWNGRADE[level] + 1`) `[E/i/controllers/tick]`.
- **RCL 8**: прогресс сверх 15/тик не считается; на 8 уровне контроллер может потерять уровень при простое — `CONTROLLER_DOWNGRADE[8] = 200000`.
- **Переполнение энергии**: spawn+extensions вмещают ровно `E_max` (12 900 на RCL 8). Излишек нужно уводить в storage/terminal/container,
  иначе `transfer` вернёт `ERR_FULL`. Отдельно: `Room.energyCapacityAvailable` — это сумма ёмкостей spawn/extension, а не всего хранилища.
- **Спавн без энергии**: движок проверяет `energyAvailable < calcCreepCost(body)` и возвращает `ERR_NOT_ENOUGH_ENERGY` **до** постановки интента `[E/structures]`.
  Если энергия есть на момент вызова, но интент не применился (напр. спавн уже `spawning`) — спавна не будет, а энергия не спишется `[E/i/spawns/create-creep]`.
- **Контейнеров только 5 на комнату** на любом RCL `[C]` — планировать source-контейнеры, controller-контейнер и mineral-контейнер в этом лимите.
- **Минерал**: нужен extractor (RCL 6+, 1 на комнату) ровно на клетке минерала; `harvest` минерала без extractor или при `extractor.cooldown > 0` не срабатывает `[E/i/creeps/harvest]`.
  По коду движка после удачной добычи cooldown = 5 и обработчик extractor'а выполняется после интентов (`[E/processor]`: интенты — раньше, tick-обработчики — позже),
  т.е. одна добыча примерно раз в 6 тиков; **точную чётность `[НЕ ПРОВЕРЕНО]`** (нужен замер на живом шарде).
- **Резерв**: 1 CLAIM-часть = 1 тик резерва за вызов. Чтобы держать 5000 тиков резерва, нужно либо звать `reserveController` каждый тик одной частью, либо держать N CLAIM-частей и звать раз в N тиков `[C]`, `[E/i/creeps/reserveController]`.
- **Резерв ≠ владение**: в резервируемой комнате `roomController.level == 0`, поэтому контейнеры распадаются в 5 раз быстрее, а рампарты/walls имеют `hitsMax` по уровню 0.
- **`renewCreep` дороже recycle**: renew даёт `floor(600/n)` тиков за `ceil(0.4 × cost/n)` энергии, recycle возвращает до 100 % стоимости тела (при полном TTL) и освобождает спавн `[DOC/api]`, `[E/i/creeps/_die]`.
- **Лимит «100 крипов» не подтверждён**: в открытом коде `engine`/`common` найдены только `MAX_CREEP_SIZE = 50` (частей) и `MARKET_MAX_ORDERS`, `FLAGS_LIMIT 10000`, `MAX_CONSTRUCTION_SITES 100`; ограничения на число крипов нет → `[НЕ ПРОВЕРЕНО]`.
- **`recycleCreep`/`renewCreep` требуют соседней клетки со спавном**, отсутствия `spawning` у спавна и тела без CLAIM `[DOC/api]`, `[E/i/spawns/renew-creep]`.

## Источники

Скачано в этой сессии (curl):

- `[C]` https://raw.githubusercontent.com/screeps/common/master/lib/constants.js — 1591 строка; ключевые блоки: `BODYPART_COST` 96–105, `CREEP_LIFE_TIME` 111, `CARRY_CAPACITY` 116, `HARVEST_POWER` 117, `REPAIR_POWER` 120, `BUILD_POWER` 122, `UPGRADE_CONTROLLER_POWER` 124, `REPAIR_COST` 128, `ENERGY_REGEN_TIME` 136, `SPAWN_ENERGY_CAPACITY` 141, `CREEP_SPAWN_TIME` 142, `SPAWN_RENEW_RATIO` 143, `SOURCE_*` 145–147, `EXTENSION_ENERGY_CAPACITY` 153, `LINK_*` 161–165, `STORAGE_CAPACITY` 167, `CONSTRUCTION_COST` 192, `CONTROLLER_LEVELS` 213, `CONTROLLER_STRUCTURES` 214–231, `CONTROLLER_DOWNGRADE*` 232–240, `LAB_*` 274–282, `GCL_*` 284–286, `MAX_CREEP_SIZE` 296, `MINERAL_REGEN_TIME` 298, `MINERAL_DENSITY` 310, `TERMINAL_*` 333–337, `CONTAINER_*` 339–343, `FACTORY_CAPACITY` 357, `REACTIONS` 484+, `REACTION_TIME` 576+, `BOOSTS` 613+, `COMMODITIES` 1144+.
- `[E/structures]` https://raw.githubusercontent.com/screeps/engine/master/src/game/structures.js — `spawnCreep` ~1063, `runReaction` 317, `StructureTerminal.send` 714.
- `[E/utils]` https://raw.githubusercontent.com/screeps/engine/master/src/utils.js — `calcCreepCost` 114, `calcBodyEffectiveness` 623, `calcRoomsDistance` 644, `calcTerminalEnergyCost` 657, `calcNeededGcl` 661.
- `[E/game]` https://raw.githubusercontent.com/screeps/engine/master/src/game/game.js — GCL 130–133, 160–164.
- `[E/creeps]` https://raw.githubusercontent.com/screeps/engine/master/src/game/creeps.js — `reserveController` 961, `claimController` 839.
- `[E/processor]` https://raw.githubusercontent.com/screeps/engine/master/src/processor.js — интенты (стр. ~231) до tick-обработчиков (стр. ~344).
- `[E/movement]` https://raw.githubusercontent.com/screeps/engine/master/src/processor/intents/movement.js — `calcResourcesWeight` 41, `fatigueRate` 204–221, усталость 235–240.
- `[E/i/...]` файлы `src/processor/intents/...` репозитория screeps/engine (шаблон пути, не ссылка) — `sources/tick.js`, `minerals/tick.js`, `extractors/tick.js`, `containers/tick.js`, `roads/tick.js`, `ramparts/tick.js`, `storages/tick.js`, `terminal/tick.js`, `energy/tick.js`, `controllers/tick.js`, `links/transfer.js`, `labs/run-reaction.js`, `labs/boost-creep.js`, `factories/produce.js`, `factories/tick.js`, `creeps/tick.js`, `creeps/harvest.js`, `creeps/build.js`, `creeps/repair.js`, `creeps/upgradeController.js`, `creeps/attackController.js`, `creeps/claimController.js`, `creeps/reserveController.js`, `creeps/_die.js`, `spawns/create-creep.js`, `spawns/_charge-energy.js`, `spawns/_born-creep.js`, `spawns/renew-creep.js`, `spawns/recycle-creep.js`.
- `[DOC/control]` https://docs.screeps.com/control.html — таблица «Available structures per RCL», CPU/GCL, downgrade-таймеры.
- `[DOC/resources]` https://docs.screeps.com/resources.html — минералы, бусты (30 минерала + 20 энергии за часть), фабрика/commodities.
- `[DOC/invaders]` https://docs.screeps.com/invaders.html — счётчик ~100 000 энергии, 10 % рейд 2–5, light/heavy, выходы только в нейтральные комнаты.
- `[DOC/api]` https://docs.screeps.com/api/ — `spawnCreep`/`renewCreep`/`recycleCreep`, `StructureTerminal`, `Game.cpu`, `Game.gcl`, `Game.map`.
