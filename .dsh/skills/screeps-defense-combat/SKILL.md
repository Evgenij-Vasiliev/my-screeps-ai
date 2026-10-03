---
name: screeps-defense-combat
description: "Проверенная механика обороны и боя в Screeps: формулы башен с falloff, силы частей тела и бусты, hits структур, стены/рампы и safe mode, обнаружение угроз, инвейдеры, ядерные удары и приоритеты в коде защитника."
whenToUse: Когда комната под атакой, нужно посчитать урон/лечение/ремонт, настроить приоритеты башен, поставить оборону или оценить выгоду нападения.
---

# Оборона и бой

Точные формулы башен (урон/лечение/ремонт по дистанции), силы боевых частей и бустов,
hits структур, механика стен и рамп, safe mode, инвейдеры, ядерные удары и практические
приоритеты в коде защитника. Все числа — из `@types/screeps` (DT), исходников
`screeps/engine` (ENG) и docs; непроверенное помечено `[НЕ ПРОВЕРЕНО]`.

## Когда использовать

- Комната под атакой: чем бить, в каком порядке и хватит ли энергии башен.
- Считаешь, сколько тиков проживёт стена/рамп под N атакующих и сколько энергии на ремонт.
- Настраиваешь приоритеты башен (лечить/бить/ремонтировать) и не понимаешь, почему одна из команд «не работает».
- Планируешь оборону комнаты: рампы, chokepoints, safe mode, размещение башен.
- Разбираешься с инвейдерами (включая InvaderCore) или с летящей ядеркой.
- Оцениваешь окупаемость боевой группы (стоимость крипа против нанесённого ущерба).

## Ключевые факты

### 1. Башни: формулы, приоритеты, цена

Формула движка для всех трёх действий (`ENG towers/attack.js:32-46`, `heal.js:27-41`, `repair.js:30-44`):

```
range  = max(|dx|, |dy|)                       // Чебышёвское расстояние
amount = базовоеЗначение                       // attack 600, heal 400, repair 800
if (range > TOWER_OPTIMAL_RANGE(5)):
    if (range > TOWER_FALLOFF_RANGE(20)) range = 20
    amount -= amount * TOWER_FALLOFF(0.75) * (range - 5) / (20 - 5)
amount = floor(amount)
```

| Дистанция | `tower.attack` | `tower.heal` | `tower.repair` | Источник |
|---|---|---|---|---|
| 1–5 (optimal) | 600 | 400 | 800 | ENG towers/*.js; API:1839-1841 |
| 10 | 450 | 300 | 600 | расчёт по формуле ENG |
| 15 | 300 | 200 | 400 | расчёт по формуле ENG |
| ≥ 20 | 150 | 100 | 200 | ENG: кламп на `TOWER_FALLOFF_RANGE` |
| Цена любого действия | **10 энергии** (`TOWER_ENERGY_COST`), независимо от дистанции и от того, сколько хитов реально «долетело» | API:1838; DT:6351; ENG towers/repair.js:24,50-52 |
| Ёмкость башни | `TOWER_CAPACITY` 1000 → 100 действий; `TOWER_HITS` 3000 | API:1836-1837 |
| Башни доступны | с RCL 3 (1 башня), 6 на RCL 8 | API:1814 (`CONTROLLER_STRUCTURES.tower`) |

| Факт | Значение | Источник |
|---|---|---|
| Действий за тик | **ровно одно на башню**: движок обрабатывает `heal`, **иначе** `repair`, **иначе** `attack` | ENG towers/intents.js:3-10 |
| Практический приоритет | если вызвать `tower.heal(x)` и `tower.attack(y)` в одном тике — выполнится **лечение**, атака потеряется | ENG towers/intents.js:4-9 |
| Цель под рампой | `attack` и `repair` перенаправляются на **рампу** на тайле цели; крип на рампе неуязвим, пока рампа цела | ENG towers/attack.js:27-30; DOCS defense |
| `tower.repair` | цель должна иметь `CONSTRUCTION_COST[type]` и `hits < hitsMax` (контроллер и стены NPC не ремонтируются) | ENG towers/repair.js:17 |
| `tower.heal` | только `creep` / `powerCreep`, не структуры | ENG towers/heal.js:13-14 |
| Нет энергии | intent молча отбрасывается; клиентский метод вернёт `ERR_NOT_ENOUGH_ENERGY` | ENG towers/attack.js:24; DT:6356 |
| Усиление силой | `PWR_OPERATE_TOWER` умножает урон/лечение/ремонт, `PWR_DISRUPT_TOWER` — ослабляет | ENG towers/attack.js:39-45 |

Следствие для ремонта: **башня тратит 10 энергии даже если цели не хватало 1 хита** (движок
клампит `hits` по `hitsMax`, ENG towers/repair.js:46-52), поэтому ремонт дорог (5000 хитов) башней — сжигание энергии.

### 2. Бой: силы частей, бусты, порядок применения

| Факт | Значение | Источник |
|---|---|---|
| `ATTACK_POWER` / `RANGED_ATTACK_POWER` | 30 за живую `ATTACK`-часть (радиус 1) / 10 за `RANGED_ATTACK` (радиус 3) | DT:207,209; API:1727,1729 |
| `HEAL_POWER` / `RANGED_HEAL_POWER` | 12 (радиус 1) / 4 (радиус 3) | DT:210-211; API:1730-1731; ENG creeps/heal.js:28 |
| `DISMANTLE_POWER` | 50 за `WORK`, радиус 1; возвращает энергию `floor(урон * DISMANTLE_COST 0.005)` | DT:205-206; API:1725,1733; ENG creeps/dismantle.js:40-44 |
| `REPAIR_POWER` / `BUILD_POWER` | 100 и 5 за `WORK`; ремонт в радиусе 3, стройка в радиусе 3 | DT:204, DT:206; API:1724,1726,3636 |
| `rangedMassAttack()` | бьёт **всех** врагов и чужие структуры в радиусе 3; урон по дистанции: **0–1 → 100%, 2 → 40%, 3 → 10%** | ENG creeps/rangedMassAttack.js:37-52 |
| Урон в ответ (hit back) | цель-крип бьёт атакующего своим `ATTACK`, **если атакующий не стоит на рампе**; в safe mode владельца комнаты ответный урон = 0 | ENG _damage.js:16-19, 46-48 |
| Power Bank | отвечает уроном `0.5 * damage` (`POWER_BANK_HIT_BACK`) | ENG _damage.js:20; API:1852 |
| Порядок применения в тике | сначала **урон**, потом **лечение**, потом кламп по `hitsMax` | ENG creeps/tick.js:120-127 |
| TOUGH-буст | уменьшает урон: части поглощают урон с коэффициентом `BOOSTS.tough[..].damage` (GO 0.7, GHO2 0.5, XGHO2 0.3) | ENG creeps/tick.js:5-22; API:2268-2278 |
| Хиты части тела | 100 за часть; `hits` крипа = сумма живых частей | ENG creeps/_recalc-body.js:9-20 |
| Урон структурам | любой `ATTACK`/`RANGED_ATTACK`/`WORK`-dismantle бьёт структуры так же, как крипов; стены/рампы с `PWR_FORTIFY` или `EFFECT_INVULNERABILITY` игнорируют всё, кроме ядерки | ENG _damage.js:29-35 |

Таблица `BOOSTS` (множитель на часть; API:2165-2278):

| Часть | Буст | Эффект |
|---|---|---|
| `attack` | UH / UH2O / XUH2O | ×2 / ×3 / ×4 к `attack` |
| `ranged_attack` | KO / KHO2 / XKHO2 | ×2 / ×3 / ×4 к `rangedAttack` **и** `rangedMassAttack` |
| `heal` | LO / LHO2 / XLHO2 | ×2 / ×3 / ×4 к `heal` и `rangedHeal` |
| `tough` | GO / GHO2 / XGHO2 | урон ×0.7 / ×0.5 / ×0.3 |
| `work` | ZH / ZH2O / XZH2O | ×2 / ×3 / ×4 к `dismantle` |
| `work` | UO / UHO2 / XUHO2 | ×3 / ×5 / ×7 к `harvest` |
| `work` | LH / LH2O / XLH2O | ×1.5 / ×1.8 / ×2 к `build` и `repair` |
| `move` | ZO / ZHO2 / XZHO2 | ×2 / ×3 / ×4 к восстановлению fatigue |
| `carry` | KH / KH2O / XKH2O | ×2 / ×3 / ×4 к ёмкости части |

| Факт | Значение | Источник |
|---|---|---|
| Цена буста | `LAB_BOOST_MINERAL` 30 минерала + `LAB_BOOST_ENERGY` 20 энергии **на каждую часть** | API:1862-1863; ENG labs/boost-creep.js:15-18, 37-42 |
| Порядок буста | лаборатория сначала бустит `TOUGH`-части, затем остальные в обратном порядке тела | ENG labs/boost-creep.js:26-29 |
| Время | мгновенно (в тике вызова), без «времени применения» | ENG labs/boost-creep.js (нет таймера) |
| Затухание | **буст не имеет таймера**: держится, пока жива часть; снимается только уничтожением части, `unboostCreep` (возврат 15 минерала) или смертью | ENG creeps/_die.js:45-47; API:1866-1867 |
| Бусты в бою | при смерти крипа минерал и энергия буста выпадают в гроб (`LAB_BOOST_MINERAL * lifeRate`) | ENG creeps/_die.js:43-50 |

### 3. Hits структур и экономика ремонта

| Структура | `hitsMax` | Источник |
|---|---|---|
| `STRUCTURE_ROAD` | 5 000 | API:ROAD_HITS |
| `STRUCTURE_EXTENSION` / `LINK` / `NUKER` / `FACTORY` | 1 000 | API:EXTENSION_HITS, LINK_HITS, NUKER_HITS, FACTORY_HITS |
| `STRUCTURE_CONTAINER` | 250 000 | API:CONTAINER_HITS |
| `STRUCTURE_LAB` | 500 | API:LAB_HITS |
| `STRUCTURE_TOWER` / `TERMINAL` | 3 000 | API:TOWER_HITS, TERMINAL_HITS |
| `STRUCTURE_SPAWN` / `POWER_SPAWN` | 5 000 | API:SPAWN_HITS, POWER_SPAWN_HITS |
| `STRUCTURE_STORAGE` | 10 000 | API:STORAGE_HITS |
| `STRUCTURE_WALL` | 1 → **300 000 000** (`WALL_HITS_MAX`) | API:1749 |
| `STRUCTURE_RAMPART` | 1 → по RCL: 2: 300K, 3: 1M, 4: 3M, 5: 10M, 6: 30M, 7: 100M, 8: 300M | API:1737,6549-6570; ENG ramparts/tick.js:17-21 |
| `STRUCTURE_INVADER_CORE` | 100 000 | API:2376 |

| Факт | Значение | Источник |
|---|---|---|
| Нейтральные структуры | у стен и дорог **нет** `my`/`owner` — `FIND_MY_STRUCTURES` их не вернёт, для стен нужен `FIND_STRUCTURES` | DT:5932-5940 (OwnedStructure), DT:6396 (StructureWall) |
| Цена ремонта | `REPAIR_COST` 0.01 энергии за хит → `WORK`-часть ремонтирует 100 хитов за 1 энергию | API:1732,1724 |
| Башня vs WORK | башня: 800 хитов за 10 энергии = **80 хитов/энергию** (в упор); `WORK`: 100 хитов/энергию — на 25% выгоднее, но только в радиусе 3 | ENG towers/repair.js; DT:204 |
| Стоимость стены «с нуля» | 300 000 000 хитов × 0.01 = **3 000 000 энергии** на стену; рамп RCL 5 (10M) = **100 000 энергии** | арифметика по API:1732,1737 |
| Распад рампы | −300 хитов каждые 100 тиков (**3 хита/тик**), после чего рампа исчезает | API:1734-1735; ENG ramparts/tick.js:23-36 |
| Удержание рампы | 300 хитов / 100 тиков = 0.03 энергии/тик на рампу (через `WORK`) | арифметика по API |
| Стена | доступна с RCL 2, стоимость 1 энергия, ставится не ближе 2 тайлов к краю комнаты, `hits` при постройке = 1 | API:StructureWall; DOCS defense |
| Рампа | доступна с RCL 2, стоимость 1 энергия, лимит 2500 штук | API:1812,6549-6575 |
| Приватная рампа | `rampart.isPublic === false` (по умолчанию) — препятствие для **чужих** крипов, свои проходят; `setPublic(true)` открывает её всем | ENG movement.js:24; DT:6259-6276 |

### 4. Safe mode и контроллер

| Факт | Значение | Источник |
|---|---|---|
| Длительность | `SAFE_MODE_DURATION` **20 000** тиков | DT:365; DOCS defense |
| Кулдаун | `SAFE_MODE_COOLDOWN` **50 000** тиков | DT:366 |
| Цена активации | 1 «активация» контроллера (даётся за каждый уровень) либо `Creep.generateSafeMode`: **1000 гхода** (`SAFE_MODE_COST`), радиус 1 | ENG creeps/generateSafeMode.js:20-25; API:1835 |
| Одна комната на шард | повторная активация в другой комнате → `ERR_BUSY` | DT:6021; DOCS defense |
| Условия движка | `safeModeAvailable > 0`, кулдаун прошёл, `upgradeBlocked <= Game.time`, `ticksToDowngrade >= CONTROLLER_DOWNGRADE[level]/2 − 5000` (`CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD`, API:1826) | ENG controllers/activateSafeMode.js:5-23 |
| Ошибки метода | `OK \| ERR_NOT_OWNER \| ERR_BUSY \| ERR_NOT_ENOUGH_RESOURCES \| ERR_TIRED` | DT:6015-6025 |
| Что блокирует (если владелец комнаты — не вы) | `attack`, `rangedAttack`, `rangedMassAttack`, `heal`, `rangedHeal`, `dismantle`, `withdraw`, `attackController` | ENG creeps/{attack,rangedAttack,rangedMassAttack,heal,rangedHeal,dismantle,withdraw,attackController}.js |
| Что **не** блокирует | `transfer`, `upgradeController`, `reserveController`, `claimController`, `build`, `repair` | ENG: проверки `safeMode` в этих файлах отсутствуют |
| Свои крипы в своей safe mode | проходят сквозь чужих крипов, строят под чужими крипами, не получают ответный удар | ENG movement.js:22-29; c_build.js:55-58; _damage.js:46-48 |
| Атака контроллера | блокирует апгрейд на `CONTROLLER_ATTACK_BLOCKED_UPGRADE` = 1000 тиков | API:1831; ENG creeps/attackController.js |
| Ядерка | снимает safe mode и вешает `upgradeBlocked` на 200 тиков (`CONTROLLER_NUKE_BLOCKED_UPGRADE`) | ENG nukes/tick.js:62-75 |

Практический предел: `RAMPART_HITS_MAX` = 300K на RCL 2 и 3M на RCL 4, поэтому комната 3–4 уровня
не держит рампы против серьёзного dismantler'а — там safe mode не «последний рубеж», а основной.

### 5. Обнаружение угроз

| Факт | Значение | Источник |
|---|---|---|
| Чужие крипы | `FIND_HOSTILE_CREEPS` (103) — включает NPC-инвейдеров | API:1641 |
| Чужие структуры | `FIND_HOSTILE_STRUCTURES` (109) — **не включает** стены/дороги/контейнеры (они нейтральные, без `owner`) | DT:5932-5950; API:1647 |
| Чужие power creeps / стройки | `FIND_HOSTILE_POWER_CREEPS` (121), `FIND_HOSTILE_CONSTRUCTION_SITES` (115) | API:1659, 1653 |
| Ядерки | `FIND_NUKES` (117) → `Nuke` с `launchRoomName` и `timeToLand` | API:1655; DT:3806-3822 |
| Владелец | `creep.owner.username` / `structure.owner.username` — строка; у NPC: `Source Keeper` (проверено в ENG structures.js:287), у инвейдеров — `[НЕ ПРОВЕРЕНО]` | DT:2085-2090; ENG structures.js:287 |
| NPC в движке | внутренние user-id: `'2'` — инвейдеры, `'3'` — source keeper'ы; уведомления об атаке им не шлются | ENG invaders/pretick.js:28; _damage.js:77 |
| Подписанный контроллер | `controller.sign` = `{username, text, time, datetime}`; подпись ничего не даёт по механике | DT:2095-2099 |
| Ловушки | чужой крип **блокирует** тайл (кроме вашей safe mode); чужая приватная рампа непроходима; `attack` по цели на рампе бьёт рампу, а не цель | ENG movement.js:22-29; towers/attack.js:27-30 |

Почему нельзя опираться на «первый спавн»: спавн — структура с 5000 хитов (API:SPAWN_HITS), он
разрушается, а на RCL 7–8 их до трёх (API:CONTROLLER_STRUCTURES) — логика обороны идёт от комнаты
(контроллер + список hostile), а не от `room.find(FIND_MY_SPAWNS)[0]`.

### 6. Инвейдеры и InvaderCore

| Факт | Значение | Источник |
|---|---|---|
| Условие появления | счётчик добытой в комнате энергии (~100 000 + случайная добавка) | DOCS invaders |
| Где появляются | только у выходов в **нейтральные** комнаты; если все выходы ведут в контролируемые/зарезервированные комнаты — инвейдер не появится | DOCS invaders |
| Мобильность и умения | **не переходят между комнатами**; используют `attack`, `rangedAttack`, `dismantle`; структуры ломают, только если те мешают | DOCS invaders |
| Рейд | 10% шанс, что вместо одного придут 2–5 с ролями melee / ranged / healer, иногда с бустами | DOCS invaders |
| Размеры | Light (нейтральные/резерв/RCL ≤ 3) и Heavy (RCL ≥ 4); точные составы тел в docs — картинки, чисел нет | DOCS invaders; `[НЕ ПРОВЕРЕНО]` |
| InvaderCore (Stronghold) | 100 000 хитов (`API:2376`), стадия deploy 5 000 тиков (неуязвим, `EFFECT_INVULNERABILITY`), затем активная 75 000 ±10% (`EFFECT_COLLAPSE_TIMER`, `STRONGHOLD_DECAY_TICKS` API:2375,2384) | API:5832-5845 |
| Ядро в нейтральной комнате | резервирует контроллер: `INVADER_CORE_CONTROLLER_POWER(2) * CONTROLLER_CLAIM_DOWNGRADE(300)` = 600 тиков снимается с таймера резерва/даунгрейда за удар | ENG invader-core/attackController.js:27-34; API:2381 |
| Уничтожение | руины ядра содержат ресурсы, инвейдеры перестают появляться до следующего штурма | DOCS invaders |
| Уведомления и тест | атаки NPC не шлют e-mail; оборону можно тестировать панелью Invasion в комнате | DOCS invaders |

### 7. Ядерный удар

| Факт | Значение | Источник |
|---|---|---|
| Запуск | `StructureNuker.launchNuke(pos)`; нужен **полный** нукер: 300 000 энергии + 5 000 G | ENG nukers/launch-nuke.js:11-13; API |
| Дальность и полёт | `NUKE_RANGE` **10** комнат по каждой оси (расстояние по координатам комнат); `NUKE_LAND_TIME` 50 000 тиков, кулдаун нукера 100 000 | API:1924,1923,1920; ENG nukers/launch-nuke.js:31-33 |
| Зона поражения | квадрат 5×5 (dx,dy от −2 до 2) вокруг точки | ENG nukes/tick.js:37-56 |
| Урон | центр **10 000 000**, остальные тайлы зоны **5 000 000** (`NUKE_DAMAGE[0]` / `[2]`; DT:435-440 объявляет ключи 0/1/4 — ключи из DT не использовать) | API:1925-1928; ENG nukes/tick.js:44 |
| Рампы | рампа на тайле поглощает урон: `damage -= rampart.hits`, остаток идёт по остальным объектам тайла | ENG nukes/tick.js:46-55 |
| Прочее в комнате | в тик падения **все крипы комнаты погибают** (без гробов), power creeps обнуляются, все стройки/гробы/руины/ресурсы на земле удаляются, начатый спавн отменяется | ENG nukes/tick.js:16-35; ENG creeps/_die.js:20 |
| Контроллер | safe mode снимается, `upgradeBlocked` = +200 тиков | ENG nukes/tick.js:62-75 |
| Куда нельзя | комнаты в novice/respawn-зоне (запуск не проходит, летящая ядерка удаляется) | ENG nukers/launch-nuke.js:23-25; nukes/tick.js:11-14 |
| Как заметить | `room.find(FIND_NUKES)` → `{launchRoomName, timeToLand}`; в тик `landTime-1` спавн отменяется | API:1655; DT:3806-3822; ENG nukes/pretick.js:8-12 |
| Что делать | довести рампы до 5M (внешнее кольцо) / 10M (центр) хитов на RCL 5+, иначе урон пройдёт насквозь | арифметика по ENG nukes/tick.js:44-55 и RAMPART_HITS_MAX |

## Рецепты

### Р1. Приоритеты башен в коде (одно действие на башню за тик!)

```js
/** Один вызов на башню за тик: сначала лечение, потом атака, ремонт — только в мире. */
function runTower(tower, hostiles, wounded, repairTarget) {
  if (tower.store[RESOURCE_ENERGY] < 10) return;         // TOWER_ENERGY_COST
  if (wounded.length) { tower.heal(wounded[0]); return; }  // движок всё равно сделает heal первым
  if (hostiles.length) { tower.attack(hostiles[0]); return; }
  if (repairTarget) tower.repair(repairTarget);
}
// hostiles/wounded/repairTarget считаются ОДИН раз на комнату (room.find кэшируется движком,
// ENG src/game/rooms.js:584-642), сортировка целей — ваша.
```

### Р2. Ремонт стен и рамп с бюджетом на тик

```js
/** Держим рампы выше порога и не жжём энергию на почти целые цели. */
const RAMPART_MIN = 0.8;      // ремонтируем при падении ниже 80% от hitsMax

function pickRepair(room) {
  // ВАЖНО: стены нейтральные (нет .my) — FIND_MY_STRUCTURES их не вернёт (DT:5938)
  const targets = room.find(FIND_STRUCTURES, {
    filter: s => ((s.structureType === STRUCTURE_RAMPART && s.my) || s.structureType === STRUCTURE_WALL) &&
                 s.hits < s.hitsMax * RAMPART_MIN,
  });
  // Самые «дешёвые для бюджета» — те, что ближе всех к максимуму (меньше энергии в никуда)
  return targets.sort((a, b) => b.hits - a.hits)[0];
}
```

### Р3. Обнаружение угроз без доверия к первому спавну

```js
/** Классификация угроз комнаты: кто, сколько, есть ли ядерка. */
function scanRoom(room) {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);       // включает NPC-инвейдеров
  const hostilePower = room.find(FIND_HOSTILE_POWER_CREEPS);
  const nukes = room.find(FIND_NUKES);
  const healers = hostiles.filter(c => c.getActiveBodyparts(HEAL) > 0);
  const melee = hostiles.filter(c => c.getActiveBodyparts(WORK) + c.getActiveBodyparts(ATTACK) > 0);
  return { hostiles, hostilePower, nukes, healers, melee };
}
```

### Р4. Роли защитников: melee / ranged / healer

```js
/** Ranged держит дистанцию 3 и кайтит; melee стоит на рампе; healer лечит раненого. */
const opposite = d => (d + 3) % 8 + 1;          // 1..8 циклично: TOP(1) -> BOTTOM(5)

function runRanged(defender, target) {
  const range = defender.pos.getRangeTo(target);
  if (range > 3) return defender.moveTo(target, { range: 3, reusePath: 3 });
  const rc = defender.rangedAttack(target);
  // kiting: шаг назад, если враг вплотную и мы целы (move и rangedAttack совместимы в одном тике)
  if (range <= 1 && defender.hits === defender.hitsMax) {
    defender.move(opposite(defender.pos.getDirectionTo(target)));
  }
  return rc;
}

function runHealer(healer, wounded) {
  if (!wounded.length) return;
  const t = wounded[0];
  if (healer.pos.isNearTo(t)) healer.heal(t);      // HEAL_POWER 12
  else if (healer.pos.inRangeTo(t, 3)) healer.rangedHeal(t);  // RANGED_HEAL_POWER 4
  else healer.moveTo(t, { range: 1 });
}
```

### Р5. Safe mode как отдельное решение, а не «кнопка в панике»

```js
/** Активируем только если оборона проигрывает: safe mode один на шард и с кулдауном 50000. */
function maybeSafeMode(room, threat) {
  const c = room.controller;
  if (!c || !c.my || !c.safeModeAvailable) return false;
  if (c.safeModeCooldown > Game.time) return false;
  if (c.upgradeBlocked > Game.time) return false;
  // ENG controllers/activateSafeMode.js:20-22 — контроллер не должен быть почти потерян
  if (c.ticksToDowngrade < CONTROLLER_DOWNGRADE[c.level] / 2 - CONTROLLER_DOWNGRADE_SAFEMODE_THRESHOLD) return false;
  return (threat && threat.dps >= 600) ? c.activateSafeMode() === OK : false;  // 600 — башня в упор
}
```

### Р6. Нюк: реакция и математика рамп

```js
/** Ядерка видна за 50000 тиков: успеваем довести рампы или вывести крипов из комнаты. */
function handleNukes(room) {
  for (const nuke of room.find(FIND_NUKES)) {
    const ramparts = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_RAMPART && s.pos.inRangeTo(nuke.pos, 2),
    });
    const need = nuke.pos.x === undefined ? 0 :
      Math.max(...ramparts.map(r => r.pos.getRangeTo(nuke.pos) === 0 ? NUKE_DAMAGE[0] : NUKE_DAMAGE[2]), 0);
    const max = RAMPART_HITS_MAX[room.controller.level] ?? 0;
    console.log(`${room.name}: nuke in ${nuke.timeToLand}, need=${need}, rampart max=${max}`);
  }
}
```

### Р7. Метрики обороны (что мерить, а не «кажется, держимся»)

```js
/** Раз в тик: dps врага, запас действий башен, худшая стена. */
function defenseMetrics(room) {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const dps = hostiles.reduce((s, c) => s +              // ATTACK/RANGED_ATTACK/DISMANTLE
      c.getActiveBodyparts(ATTACK) * 30 + c.getActiveBodyparts(RANGED_ATTACK) * 10 +
      c.getActiveBodyparts(WORK) * 50, 0);
  const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
  const actions = Math.floor(towers.reduce((s, t) => s + t.store[RESOURCE_ENERGY], 0) / 10);
  const walls = room.find(FIND_STRUCTURES, {   // стены нейтральные: только FIND_STRUCTURES
    filter: s => (s.structureType === STRUCTURE_RAMPART && s.my) || s.structureType === STRUCTURE_WALL });
  return { dps, towerActions: actions, minWallHits: walls.length ? Math.min(...walls.map(w => w.hits)) : 0 };
}
```

## Подводные камни

1. **Башня делает только одно действие за тик**, и порядок движка — `heal` → `repair` → `attack` (ENG towers/intents.js:4-9). Вызов «полечить и пострелять» в одном тике молча теряет атаку.
2. **`tower.repair` цели под рампой бьёт по рампе** — ремонт структуры, стоящей на тайле с рампой, уйдёт в рампу (ENG towers/attack.js:27-30; та же логика у `attack`/`rangedAttack`/`dismantle`).
3. **Крип на рампе неуязвим**, пока рампа цела: весь урон уходит в рампу (DOCS defense; ENG creeps/attack.js:31-34). Стрелять по цели «сквозь» рампу нельзя.
4. **Ответный удар не работает через рампу и в своей safe mode**: `hit back` отключён, если атакующий стоит на рампе, и равен 0, если комната в safe mode атакующего (ENG _damage.js:16-19, 46-48).
5. **Урон применяется раньше лечения в одном тике** (ENG creeps/tick.js:120-127): крип с 100 хитами, получающий 100 урона и 50 лечения, **умирает**.
6. **`rangedMassAttack` — не «урон/2»**: 100% на 0–1, 40% на 2, 10% на 3 (ENG creeps/rangedMassAttack.js:37-38). Дружественные цели не задевает (API:3620).
7. **Хиты стены/рампы при постройке = 1**, и рампа теряет 300 хитов каждые 100 тиков (API:StructureWall, RAMPART_DECAY_AMOUNT) — недоремонтированная рампа исчезает и открывает проход.
8. **`RAMPART_HITS_MAX` привязан к RCL**: 300K на RCL 2, 3M на RCL 4, 10M на RCL 5 (API:RAMPART_HITS_MAX). Обещать оборону выше лимита нельзя.
9. **Тела инвейдеров зависят от RCL** (Light до RCL 3, Heavy с RCL 4), и они не ходят между комнатами (DOCS invaders) — оборону можно строить по комнате, а не по коридору.
10. **NPC-инвейдеры не шлют уведомлений** (DOCS invaders), а `owner.username` у них — не игрок: проверяйте `creep.owner.username`, а не `creep.my` (у NPC `my === false`, но `owner` есть).
11. **Ядерка убивает всех крипов комнаты, а не только в зоне 5×5** (ENG nukes/tick.js:16-25), и отменяет начатый спавн (там же:31-34) — «увести крипов из эпицентра» недостаточно, нужен вывод из комнаты.
12. **Рампы поглощают ядерный урон только своими хитами**: 5M для внешнего кольца и 10M для центра (ENG nukes/tick.js:44-55) — на RCL ≤ 4 это недостижимо.
13. **Атака контроллера блокирует апгрейд на 1000 тиков** (API:1831) — во время осады прогресс RCL стоит даже без разрушений.
15. **Свои крипы в своей safe mode не блокируют друг друга, но чужие всё равно блокируют** (ENG movement.js:22-29): оборона «запереть проход своими крипами» работает только внутри safe mode.
16. **Бюджет CPU на оборону**: `room.find` кэшируется на тик (ENG src/game/rooms.js:584-642), но `findClosestByPath` для каждого защитника — нет; передавайте готовый список врагов в роли, а не ищите внутри каждой роли.

## Источники

Легенда: **DT** = `https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/screeps/index.d.ts` (скачан, 6875 строк; `DT:<строка>`; константы сверены с локальной копией `@types/screeps` 3.3.8 — расхождений нет).
**ENG** = файлы репозитория `screeps/engine`, путь `src/<файл>` (шаблон пути, не ссылка; скачаны в этой сессии; `ENG <файл>:<строки>`).
**API** = `https://docs.screeps.com/api/` (там же раздел «Constants» с литеральными значениями; `API:<строка>` — строка текстовой выгрузки). **DOCS** = `https://docs.screeps.com/defense.html`, `/invaders.html`, `/control.html`.

| Источник | Что подтверждает |
|---|---|
| ENG `intents/towers/*.js`, `intents/creeps/*.js`, `intents/_damage.js` | формула falloff и цена 10 энергии, одно действие за тик (heal→repair→attack), перенаправление на рампу, силы частей, `rangedMassAttack` (1/1/0.4/0.1), порядок урона и лечения, hit back, проверки safe mode |
| ENG `intents/nukes/*.js`, `intents/nukers/launch-nuke.js`, `intents/ramparts/tick.js`, `intents/controllers/activateSafeMode.js` | таймер 50000, зона 5×5, урон 10M/5M, поглощение рампой, гибель всех крипов комнаты, снятие safe mode, требования запуска, RAMPART_HITS_MAX по RCL, распад 300/100, условия safe mode |
| ENG `intents/labs/boost-creep.js`, `intents/creeps/_die.js`, `_recalc-body.js`, `creeps/tick.js` | цена буста 30/20, порядок TOUGH-first, отсутствие затухания, выпад бустов, TOUGH-множители, 100 хитов на часть |
| ENG `intents/invader-core/*.js`, `intents/creeps/invaders/*.js`, `intents/movement.js`, `game/rooms.js` | урон по контроллеру (2×300), NPC user-id, AI инвейдеров, приватная рампа как препятствие, safe mode и проход сквозь чужих, кэш `Room.find` |
| DT | `StructureTower`, `StructureController`, `StructureRampart`, `Nuke`, `StructureInvaderCore`, `Creep.owner`, коды возврата, `SAFE_MODE_*`, `ATTACK_POWER`, `LAB_BOOST_*` и др. |
| API (Constants + карточки структур) + DOCS | `TOWER_*`, `NUKE_*`, `RAMPART_HITS_MAX`, `WALL_HITS_MAX`, hits структур, `BOOSTS`, `REPAIR_COST`, `DISMANTLE_COST`, `CONTROLLER_STRUCTURES`; safe mode 20000/«одна комната на шард», неуязвимость на рампе, стены 300M и 2 тайла от края, инвейдеры и стадии InvaderCore |

Что осталось непроверенным: точные составы тел Light/Heavy инвейдеров и рейдовых групп (в docs это
картинки, чисел в тексте нет) — `[НЕ ПРОВЕРЕНО]`; строка `owner.username` для инвейдерных крипов
(проверено только `'Source Keeper'`, ENG structures.js:287) — `[НЕ ПРОВЕРЕНО]`; бюджет CPU на оборону
в этом проекте — нужен замер на живом шарде (скилл `screeps-live-measurement`), `[НЕ ПРОВЕРЕНО]`.
