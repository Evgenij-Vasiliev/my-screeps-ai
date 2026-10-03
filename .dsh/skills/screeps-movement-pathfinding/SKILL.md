---
name: screeps-movement-pathfinding
description: "Проверенная механика движения крипов в Screeps: fatigue и вес тела, Creep.move/moveTo, findPathTo, PathFinder.search с CostMatrix, кэш путей, трафик и разрешение конфликтов движком."
whenToUse: Когда крипы стоят, буксуют, жрут CPU на pathfinding, блокируют друг друга или нужно построить CostMatrix и межкомнатный маршрут.
---

# Движение, fatigue и pathfinding

Механика шага (сколько тиков крип стоит после одного тайла), точные сигнатуры и коды
`move`/`moveTo`/`findPathTo`/`PathFinder.search`, как строить `CostMatrix`, что реально
хранит `reusePath` и как движок разрешает конфликты крипов на одном тайле.
Всё сверено с `@types/screeps` (DT), исходниками `screeps/engine` (ENG) и docs; источник
у каждой цифры. Непроверенное помечено `[НЕ ПРОВЕРЕНО]` и основанием быть не может.

## Когда использовать

- Крип «не едет»: нужно отличить `ERR_TIRED`, `ERR_NO_PATH`, `ERR_BUSY`, блокировку чужим крипом.
- Считаешь, сколько тиков крип пройдёт N тайлов (замеры логистики, тайминги обороны).
- Пишешь свой `CostMatrix` / `roomCallback`: обход враждебных комнат, запрет свампов, приоритет дорог.
- Кэшируешь путь (`serializePath`, `reusePath`, `Memory`) и нужно знать TTL и цену.
- Разбираешься, почему `reusePath + ignoreCreeps` даёт пробки, и как бороться с трафиком.

## Ключевые факты

### 1. Один тайл за тик: fatigue

`Creep.move(direction)` только **ставит intent**; само перемещение делает движок
(`ENG src/processor/intents/creeps/move.js:34-45`, `movement.execute`).

| Факт | Значение | Источник |
|---|---|---|
| Усталость за шаг | `(частиНЕ MOVE и НЕ CARRY + загруженные CARRY-части) * множительТайла` | ENG movement.js:237-239 |
| Множитель тайла | дорога **1**, обычный тайл **2**, свамп **10** | ENG movement.js:204-214 |
| Множитель берётся от тайла НАЗНАЧЕНИЯ | `move.x, move.y`, не от исходного | ENG movement.js:204-209 |
| Загруженные CARRY-части | сколько CARRY-частей реально занято грузом; буст `capacity` (KH=2, KH2O=3, XKH2O=4) увеличивает ёмкость части, значит уменьшает вес | ENG movement.js:41-59; BOOSTS (API:2246-2256) |
| Восстановление | `−2 * живые MOVE-части` за тик; буст `fatigue` (ZO=2, ZHO2=3, XZHO2=4) умножает вклад части | ENG creeps/tick.js:105-107; ENG utils.js:623-636; BOOSTS (API:2257-2267) |
| Порог шага | двигаться можно только при `fatigue === 0` на начало тика (`_oldFatigue`) и живой MOVE-части; исключение — если крипа тянут (`_pulled`) | ENG movement.js:11-14, 183, 198 |
| Переход в другую комнату | усталость обнуляется (`fatigue = 0`) на тайле у края комнаты | ENG movement.js:242-245 |
| Урон дороге | `ROAD_WEAROUT(1) * число частей тела` за шаг; у power creep — `ROAD_WEAROUT_POWER_CREEP(100)` | ENG movement.js:211-221 |
| Нет живой MOVE-части | `ERR_NO_BODYPART`, крип не сдвинется (кроме pull) | ENG movement.js:11-14; `_hasActiveBodypart` ENG src/game/creeps.js:20-28 |

Практическое следствие: **тиков на тайл ≈ `ceil(fatigueЗаШаг / (2 * MOVE-части))`**
(восстановление идёт в том же тике, что и шаг: ENG creeps/tick.js:38-107).

Пример: 8 WORK + 2 CARRY (полный груз) + 2 MOVE → вес `8 + 2 = 10`.
Обычный тайл: 20 fatigue / восстановление 4 = **5 тиков на тайл**; дорога: 10/4 → 3 тика;
свамп: 100/4 → **25 тиков на тайл**. Пустой тот же крип на дороге: `8*1 = 8` → 2 тика.

| Факт | Значение | Источник |
|---|---|---|
| RAMPART сам по себе **не** влияет на fatigue | множитель зависит только от `swamp`-тайла и наличия структуры `road` на тайле; дорога под рампой продолжает работать | ENG movement.js:206-214 |
| Занятый тайл в своей safe mode | свои крипы проходят сквозь чужих крипов, чужие — нет | ENG movement.js:22-29 |

### 2. API движения: сигнатуры и коды

| Метод | Сигнатура / коды | Источник |
|---|---|---|
| `Creep.move(direction)` | `CreepMoveReturnCode` = `OK \| ERR_NOT_OWNER \| ERR_BUSY \| ERR_TIRED \| ERR_NO_BODYPART`; при некорректном направлении — `ERR_INVALID_ARGS` | DT:1370-1376; ENG src/game/creeps.js:126-156 |
| `Creep.move(targetCreep)` | движение в сторону тянущего крипа; `OK \| ERR_NOT_OWNER \| ERR_BUSY \| ERR_NOT_IN_RANGE \| ERR_INVALID_ARGS` | DT:1377; ENG src/game/creeps.js:134-142 |
| `Creep.moveTo(x, y, opts)` / `moveTo(target, opts)` | `CreepMoveReturnCode \| ERR_NO_PATH \| ERR_INVALID_TARGET` (+ `ERR_NOT_FOUND` при `noPathFinding`) | DT:1395, 1408 |
| `Creep.moveByPath(path)` | `CreepMoveReturnCode \| ERR_NOT_FOUND \| ERR_INVALID_ARGS`; принимает `PathStep[] \| RoomPosition[] \| string` | DT:1384; ENG src/game/creeps.js:305-332 |
| `Creep.pull(target)` | `OK \| ERR_NOT_OWNER \| ERR_BUSY \| ERR_INVALID_TARGET \| ERR_NOT_IN_RANGE \| ERR_NO_BODYPART`; **усталость цели добавляется тянущему** | DT:1457-1470; ENG _add-fatigue.js:24-27 |
| `opts.reusePath` | по умолчанию **5** тиков | ENG src/game/creeps.js:189-191 |
| `opts.serializeMemory` | по умолчанию **true** — путь пишется строкой | ENG src/game/creeps.js:192-194 |
| Куда пишется путь | `Memory.creeps[name]._move = {dest:{x,y,room}, time, path, room}` | ENG src/game/creeps.js:286-291 |
| Инвалидация кэша | `Game.time > _move.time + reusePath` **или** крип сменил комнату → `delete memory._move` | ENG src/game/creeps.js:241-247 |
| `moveTo` в свою же позицию | сразу `OK`, без pathfinding | ENG src/game/creeps.js:196-198 |
| Нет пути | `path.length === 0` → `ERR_NO_PATH` | ENG src/game/creeps.js:294-295 |
| Порядок проверок `moveTo` | `ERR_NOT_OWNER` → `ERR_BUSY` → `ERR_TIRED` → `ERR_NO_BODYPART` → `ERR_INVALID_TARGET` | ENG src/game/creeps.js:162-181 |

### 3. findPathTo, PathStep и поиск ближайшего

| Факт | Значение | Источник |
|---|---|---|
| `RoomPosition.findPathTo(x, y, opts)` / `(target, opts)` | → `PathStep[]`; если цель в другой комнате — целью становится соответствующий выход (при новом pathfinder может искать до `maxRooms`=16 комнат) | DT:4758-4766; API:4552-4618 |
| `Room.findPath(fromPos, toPos, opts)` | → `PathStep[]` | DT:5324 |
| `PathStep` | `{x, y, dx, dy, direction}` — `x,y` это тайл **после** шага, `x-dx, y-dy` — откуда | API:4619-4624; ENG src/game/creeps.js:327 |
| Дефолты `FindPathOpts` | `plainCost 1`, `swampCost 5`, `maxOps 2000`, `heuristicWeight 1.2`, `maxRooms 16`, `range 0`, `serialize false`, `ignoreCreeps false` | DT:2211-2311; API:4552-4618 |
| `opts.avoid` / `opts.ignore` | массивы объектов/позиций; **не работают при включённом новом PathFinder — вместо них `costCallback`** | DT:2256-2267 |
| `opts.ignoreDestructibleStructures` | считать разрушаемые структуры (стены, рампы, спавны, расширения) проходимыми; крип с `ATTACK`, встав на такой тайл, автоматически атакует структуру | DT:2225-2234 |
| `opts.ignoreRoads` | ускоряет поиск (дороги не учитываются как бонус) | DT:2237-2243 |
| `opts.serialize` | результат вернётся строкой `Room.serializePath` | DT:2286-2290 |
| Стоимость CPU | «1 op ~ 0.001 CPU»; `maxOps` по умолчанию 2000 → потолок ≈ **2 CPU** на один поиск | DT:2291-2295; API:4600 |
| `findClosestByPath(objects\|FIND_*)` | путь до каждого кандидата → **дорого**; принимает `FindPathOpts & {filter, algorithm: 'astar'\|'dijkstra'}` | DT:4672-4692; DT:2437 |
| `findClosestByRange(objects\|FIND_*)` | линейная (Чебышёвская) дистанция, без pathfinding — дёшево | DT:4703-4719 |
| `findInRange(objects, range, opts)` | объекты в пределах линейной дистанции | DT:4748-4754 |
| `getRangeTo` | линейная дистанция `max(\|dx\|, \|dy\|)` | DT:4794-4796; ENG utils.js:638-642 |
| `isNearTo(target)` | **эквивалент `inRangeTo(target, 1)`** | DT:4814-4827 |
| `inRangeTo(target, range)` | «в пределах range» | DT:4798-4801 |
| `getDirectionTo(target)` | `DirectionConstant` (1..8) — используется для `move` | DT:4772-4780 |

### 4. PathFinder.search и CostMatrix

| Факт | Значение | Источник |
|---|---|---|
| Сигнатура | `PathFinder.search(origin, goal, opts)`; `goal` = `RoomPosition \| {pos, range} \| массив` | DT:3854-3857 |
| Результат | `{path: RoomPosition[], ops: number, cost: number, incomplete: boolean}`; при `incomplete` в `path` лежит **частичный** путь | DT:3878-3894 |
| `opts` | `plainCost 1`, `swampCost 5`, `maxOps 2000`, `maxRooms 16` (docs: максимум **64**, DT: «also maximum» — 16: **расхождение**), `heuristicWeight 1.2`, `flee false`, `maxCost Infinity`, `roomCallback(roomName)` | DT:3902-3965; API:1525 |
| `roomCallback` | вызывается **не более одного раза на комнату за поиск**; возвращает `false` (комнату исключить) или `CostMatrix` | DT:3955-3965 |
| `PathFinder.CostMatrix` | `new PathFinder.CostMatrix()`, `set(x,y,cost)`, `get(x,y)`, `clone()`, `serialize()`; `CostMatrix.deserialize(arr)` | DT:3967-4003 |
| Стоимость тайла | `0` → берётся стоимость террейна (plain/swamp); **`>= 255` → непроходимо** | DT:3984-3990 |
| Дефолт без CostMatrix | PathFinder учитывает **только террейн**; структуры и крипы в путь не попадают, пока их не положишь в матрицу | DT:3973-3977 |
| Ускорение | большие costs замедляют поиск: `{plainCost:1, swampCost:5}` быстрее, чем `{2,10}` при том же пути | DT:3979-3982 |
| `flee: true` | ищет путь **от** целей (самый дешёвый тайл вне радиуса всех целей) | DT:3920-3926 |
| `PathFinder.use()` | **deprecated**; новый pathfinder — рабочий режим, `avoid`/`ignore` в `findPathTo` не поддерживаются | DT:3866-3876 |

### 5. Кэш путей

| Факт | Значение | Источник |
|---|---|---|
| `Room.serializePath(path)` / `deserializePath(str)` | **статические** методы конструктора `Room` (не `room.serializePath`) | DT:5417-5430 |
| Формат строки | 4 символа заголовка (`xx` + `yy`, каждая координата — 2 символа) + **1 символ направления на шаг**; длина = `путь + 4` | ENG utils.js:555-574 |
| Кэш `reusePath` | это **список направлений**, а не пересчёт пути: движок идёт по `_move.path` и обрезает пройденное | ENG src/game/creeps.js:248-281 |
| `reusePath` + `ignoreCreeps: true` | лучший CPU (путь не пересчитывается из-за крипов), но путь не знает о пробках → крипы встают друг в друга | DT:2211-2216 (ignoreCreeps); ENG src/game/creeps.js:241-281 |
| `noPathFinding: true` | вообще не считать путь: если кэша нет — сразу `ERR_NOT_FOUND` | DT:2343-2348 |
| Цена хранения | `Memory` парсится целиком при первом обращении в тике; путь на 50 шагов = ~54 символа на крипа | ENG utils.js:555-574; скилл `screeps-cpu-memory` |

### 6. Межкомнатные маршруты

| Факт | Значение | Источник |
|---|---|---|
| `Game.map.findRoute(from, to, opts)` | `{exit: ExitConstant, room: string}[] \| ERR_NO_PATH`; `opts.routeCallback(roomName, fromRoomName) => number`, `Infinity` — комнату заблокировать | DT:3196-3206, 3145-3154 |
| `Game.map.describeExits(roomName)` | `Partial<Record<"1"\|"3"\|"5"\|"7", string>> \| null` — только 4 главных выхода | DT:3169-3179, 2121 |
| `Game.map.findExit(from, to, opts)` | `ExitConstant \| ERR_NO_PATH \| ERR_INVALID_ARGS` | DT:3186-3193 |
| `Game.map.getRoomLinearDistance(a, b, continuous?)` | дистанция в комнатах; `continuous: true` — «склеенный» мир | DT:3208-3216 |
| `room.findExitTo(room)` | `ExitConstant \| ERR_NO_PATH \| ERR_INVALID_ARGS` | DT:5317 |
| Террейн без видимости | `new Room.Terrain(roomName)`, `room.getTerrain()`, `Game.map.getRoomTerrain(roomName)` — работают для любой комнаты | DT:4884-4899, 5338, 3241 |

### 7. Трафик: как движок разрешает конфликт

Движок собирает заявки на тайлы, и на каждом тайле выбирает **одного** победителя
(ENG movement.js:104-150). Критерии сортировки по убыванию:

1. `rate1` — сколько крипов стоит на текущем тайле претендента и хочет уйти (кого он блокирует);
2. `rate2` — крипа **тянут** (`_pulled`);
3. `rate3` — крип **тянет** кого-то (`_pull`);
4. `rate4` — `эффективныеMOVE / вес`, где вес = не-MOVE-не-CARRY части + загруженные CARRY (ENG movement.js:116-139).

Проигравший не двигается (его заявка удаляется, ENG movement.js:154-186). Отдельной
«пробки» движок не разбирает: два крипа, претендующие на один тайл, разрешаются один раз
и детерминированно, без тай-брейка по id.

Комьюнити-практика (не API, а подходы):
Overmind ведёт свою таблицу приоритетов ролей и «расталкивает» крипов
(`MovePriorities`, `shouldPush`, `pushCreep`), а при `stuckCount >= 2` (50% шанс за тик)
пересчитывает путь с `ignoreCreeps: false`
(OVERMIND `src/movement/Movement.ts:34-46, 225-243, 420-500`).
Clockwork формулирует те же правила: idle-крипа выгоднее сдвинуть, чем перестраивать путь;
тянущую связку (pull) нельзя разрывать; move-intents дороги, поэтому конфликты надо
разрешать в конце тика (CLOCKWORK, раздел Traffic Management).

## Рецепты

### Р1. Движение с явной обработкой кодов

```js
/** Идём к цели, различая «устал», «нет пути» и «заблокирован». */
function goTo(creep, target, range = 1) {
  if (creep.fatigue > 0) return ERR_TIRED;              // шага не будет вообще
  const rc = creep.moveTo(target, { range, reusePath: 10, ignoreCreeps: true });
  if (rc === OK) return OK;
  if (rc === ERR_NO_PATH) { creep.memory.noPath = Game.time; return rc; }
  if (rc === ERR_TIRED || rc === ERR_BUSY) return rc;   // BUSY = ещё спавнится
  return rc;
}
```

### Р2. CostMatrix: обход враждебных комнат и приоритет дорог

```js
/** Матрица комнаты: свои дороги дешевле, чужие башни/рампы — дорого, крипы — стены. */
function buildMatrix(roomName, origin) {
  const room = Game.rooms[roomName];
  const cm = new PathFinder.CostMatrix();
  if (!room) return cm;                                  // нет vision — только террейн
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) cm.set(s.pos.x, s.pos.y, 1);
    else if (s.structureType === STRUCTURE_RAMPART && !s.my) cm.set(s.pos.x, s.pos.y, 255);
    else if (s.structureType === STRUCTURE_TOWER && !s.my) {
      // вокруг вражеской башни дороже, но не 255 — иначе путь может стать недостижимым
      for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
        const x = s.pos.x + dx, y = s.pos.y + dy;
        if (x >= 0 && x < 50 && y >= 0 && y < 50) cm.set(x, y, 20);
      }
    }
  }
  for (const c of room.find(FIND_CREEPS)) {
    if (c.pos.isEqualTo(origin)) continue;               // стартовая клетка обязана быть проходимой
    cm.set(c.pos.x, c.pos.y, 255);
  }
  return cm;
}

const res = PathFinder.search(creep.pos, { pos: target.pos, range: 1 }, {
  plainCost: 2, swampCost: 10,          // 2/10 — «вес» крипа с MOVE-частями (практика Overmind)
  maxOps: 4000, maxRooms: 8,
  roomCallback: name => buildMatrix(name, creep.pos),
});
if (res.incomplete) { /* путь неполный: цель недостижима при этих costs */ }
if (res.path.length) creep.move(creep.pos.getDirectionTo(res.path[0]));
```

Кэшируйте матрицу на тик в `global` по `roomName` (roomCallback зовётся один раз на
комнату за поиск, но поисков в тике много — DT:3955-3965).

### Р3. Запрет свампов и «дешёвые» дороги

```js
/** Свамп = непроходимо (255), дороги = 1, обычный тайл = 2. */
function terrainOnly(roomName) {
  const cm = new PathFinder.CostMatrix();
  const t = new Room.Terrain(roomName);                 // работает без vision
  for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) {
    if (t.get(x, y) === TERRAIN_MASK_SWAMP) cm.set(x, y, 255);
  }
  return cm;
}
```

### Р4. Свой кэш пути в Memory + `moveByPath`

```js
/** Путь на 50 шагов ≈ 54 символа; TTL и версия обязательны. */
function followCached(creep, target, ttl = 20) {
  const m = creep.memory.path;
  if (!m || m.t + ttl < Game.time || m.dest.x !== target.pos.x || m.dest.y !== target.pos.y) {
    const raw = creep.pos.findPathTo(target.pos, { range: 1, ignoreCreeps: true, maxOps: 2000 });
    if (!raw.length) return ERR_NO_PATH;
    creep.memory.path = { t: Game.time, dest: { x: target.pos.x, y: target.pos.y },
                          s: Room.serializePath(raw) };
  }
  // moveByPath принимает и строку, и массив
  return creep.moveByPath(creep.memory.path.s);
}
```

Не держите путь дольше нужного: `moveByPath` вернёт `ERR_NOT_FOUND`, если крип сошёл с
пути (ENG src/game/creeps.js:327-332), и путь придётся строить заново.

### Р5. Межкомнатный маршрут с кэшем

```js
/** Маршрут по комнатам кэшируем в Memory.rooms, ведём крипа к выходу. */
function routeTo(creep, targetRoomName) {
  const key = creep.pos.roomName + '>' + targetRoomName;
  const cache = (Memory.routes = Memory.routes || {});
  let route = cache[key];
  if (!route || route.t + 100 < Game.time) {
    const r = Game.map.findRoute(creep.pos.roomName, targetRoomName, {
      // большее число = комната дороже для маршрута, Infinity = запретить (DT:3153)
      routeCallback: (name) => (name === targetRoomName ? 1 : 2.5),
    });
    if (r === ERR_NO_PATH) return ERR_NO_PATH;
    route = cache[key] = { t: Game.time, rooms: r.map(s => s.room) };
  }
  const exitDir = Game.map.findExit(creep.pos.roomName, route.rooms[0]);
  if (exitDir < 0) return exitDir;
  const exits = creep.room.find(exitDir);                // тайлы выхода
  const goal = creep.pos.findClosestByRange(exits);
  return goal ? goTo(creep, goal, 0) : ERR_NO_PATH;
}
```

### Р6. Детект «stuck» без лишнего CPU

```js
/** Дешёвый stuck-детект: сравниваем позицию раз в N тиков, тогда и пересчитываем путь. */
function moveWithStuckRecovery(creep, target) {
  const m = (creep.memory.st = creep.memory.st || { x: -1, y: -1, n: 0 });
  if (m.x === creep.pos.x && m.y === creep.pos.y) m.n++;
  else { m.x = creep.pos.x; m.y = creep.pos.y; m.n = 0; }

  const opts = { reusePath: m.n >= 2 ? 0 : 5, ignoreCreeps: m.n < 2 };
  if (m.n >= 2) { delete creep.memory._move; m.n = 0; }   // сбрасываем кэш движка
  return creep.moveTo(target, opts);
}
```

### Р7. Pull: тащим «медленного» крипа

```js
// Тянет только крип с MOVE; усталость идёт тянущему (ENG _add-fatigue.js:24-27).
if (leader.pull(follower) === OK) { /* follower будет двигаться за лидером */ }
// Ведомый должен сам вызвать move(leader) в свой ход, иначе связка рвётся:
follower.move(leader);
```

## Подводные камни

1. **`ERR_TIRED` — это не ошибка, а расписание.** `moveTo` при `fatigue > 0` даже не считает путь и возвращает `ERR_TIRED` (ENG src/game/creeps.js:173). Код, обрабатывающий только `ERR_NOT_IN_RANGE`, молча простаивает.
2. **Исключение: `visualizePathStyle`.** При `fatigue > 0`, но с `opts.visualizePathStyle`, проверка `ERR_TIRED` пропускается — путь будет считаться (и визуализироваться) впустую (ENG src/game/creeps.js:173).
3. **`reusePath` не знает о новых стенах.** Кэш — это направления; если на пути появилась стена, крип будет биться в неё до истечения TTL (`reusePath` тиков) или до смены комнаты (ENG src/game/creeps.js:241-247).
4. **Путь в комнате без vision.** `roomCallback` для невидимой комнаты вернёт только террейн — структуры и крипы там не видны (DT:3833). Враждебные стены обнаружатся только при входе.
5. **`cost >= 255` = стена, но `255` вокруг цели делает цель недостижимой** → `result.incomplete === true`, а `path` обрывочный (DT:3984-3990, 3884-3894). Проверяйте `incomplete`, а не только `path.length`.
6. **`PathFinder.use()` deprecated** — не полагайтесь на переключение pathfinder'а; `avoid`/`ignore` в `findPathTo` при новом движке не работают (DT:3866-3876, 2256-2267).
7. **`findClosestByPath` дорог**: он считает путь до кандидатов. Для «дотянуться/не дотянуться» хватает `findClosestByRange` + `inRangeTo`.
8. **`ERR_BUSY` = крип ещё спавнится**, `ERR_NO_BODYPART` = нет живой MOVE-части (DT:1370-1376). После боя с нулевыми MOVE-частями крип превращается в статую.
9. **Усталость обнуляется на переходе между комнатами**, но не на выходе из рампы/дороги (ENG movement.js:242-245) — тайминги дальних переходов считайте «по комнате», а не «по тайлам».
10. **Дорога — единственный способ ускорить тяжёлого крипа** (множитель 1 против 2/10), при этом она изнашивается пропорционально числу частей тела (ENG movement.js:211-221).
11. **`Memory.creeps[name]._move` растёт от `reusePath`**: путь на 50 шагов ≈ 54 символа на крипа; при 200 крипах это ~10 КБ Memory каждый тик. Альтернатива — свой кэш в `Memory.routes`/`global` (Р4).
12. **Два крипа не могут стоять на одном тайле одновременно**, а проигравший конфликт не двигается вовсе (ENG movement.js:104-186): «подвинуть» крипа можно только отдельным move-intent, иначе пробка не рассосётся.
13. **Pull без взаимного `move` рвётся**: связка живёт, пока ведомый на соседнем тайле и лидер двигается (ENG movement.js:176-181).
14. **`getRangeTo` — Чебышёвское расстояние**, а не «евклидово» и не «манхэттенское» (ENG utils.js:638-642). Диагональ = 1 тайл.

## Источники

Легенда: **DT** = `https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/screeps/index.d.ts` (скачан в этой сессии, 6875 строк; `DT:<строка>`). Значения констант сверены с локальной копией `node_modules/@types/screeps` 3.3.8 — расхождений по проверенным константам нет.
**ENG** = `https://raw.githubusercontent.com/screeps/engine/master/src/<файл>` (файлы скачаны в этой сессии; `ENG <путь>:<строки>`).
**API** = `https://docs.screeps.com/api/` (полная страница справочника; `API:<строка>` — строка текстовой выгрузки).
**OVERMIND** = `https://github.com/bencbartlett/Overmind/blob/master/src/movement/Movement.ts` (практика, не API).
**CLOCKWORK** = `https://glitchassassin.github.io/screeps-clockwork/primitives/traffic.html` (практика, не API).

| Источник | Что подтверждает |
|---|---|
| ENG `src/processor/intents/movement.js` | формула fatigue, множители 1/2/10, вес груза, разрешение конфликтов, обнуление на краю комнаты, износ дорог, safe mode |
| ENG `src/processor/intents/creeps/tick.js` | восстановление `−2 * MOVE` за тик |
| ENG `src/processor/intents/creeps/_add-fatigue.js` | перенос усталости на тянущего (pull) |
| ENG `src/processor/intents/creeps/move.js` | `Creep.move` → intent, проверка препятствий |
| ENG `src/game/creeps.js` | реализация `move`, `moveTo`, `moveByPath`, `_move` в Memory, дефолты `reusePath`/`serializeMemory`, `_hasActiveBodypart` |
| ENG `src/utils.js` | `serializePath`/`deserializePath` (формат 4+N), `calcBodyEffectiveness`, `dist` (Чебышёв) |
| DT | `MoveToOpts`, `FindPathOpts`, `PathFinderOpts`, `PathFinderPath`, `CostMatrix`, `PathStep`, `CreepMoveReturnCode`, `findClosestBy*`, `isNearTo`/`inRangeTo`, `GameMap`, `RoomTerrain`, `Room.serializePath` |
| API | дефолты `findPath` (1/5, maxOps 2000, heuristicWeight 1.2, maxRooms 16), формат `PathStep`, таблица `BOOSTS` |
| OVERMIND | приоритеты ролей, `pushCreep`, stuck-порог 2 тика и 50% repath, `ignoreCreeps: true` по умолчанию |
| CLOCKWORK | правила трафика: сдвигать idle, не рвать pull, разрешать конфликты в конце тика |

Что осталось непроверенным: точная цена CPU конкретных вызовов `moveTo`/`PathFinder.search`
на живом шарде (в источниках есть только «1 op ≈ 0.001 CPU» и потолок `maxOps`) —
`[НЕ ПРОВЕРЕНО]`; поведение `findPathTo` при включённом старом pathfinder — `[НЕ ПРОВЕРЕНО]`
(в DT `PathFinder.use` помечен deprecated, но явного «новый всегда включён» нет).
