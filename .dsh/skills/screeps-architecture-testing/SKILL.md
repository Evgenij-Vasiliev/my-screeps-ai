---
name: screeps-architecture-testing
description: "Реальная архитектура бота newScreeps (kernel → менеджеры → роли и задачи → утилиты) и офлайн-тесты tests/*.test.js: что ловится в Node, что измеряется только на живом шарде, как устроена выгрузка grunt screeps."
whenToUse: "Перед правкой архитектуры, добавлением менеджера, роли или задачи, а также при написании, разборе или починке теста в tests/*.test.js."
---

# Архитектура и тестирование бота newScreeps

Скилл описывает слои этого репозитория ссылками файл:строка и границы проверяемости: что ловится офлайн в Node, а что подтверждается только замером на живом шарде. Правила проекта — AGENTS.md и docs/task-system-v3.0/DEVELOPMENT_RULES.md.

## Когда использовать

- Перед правкой ядра, менеджера или роли — чтобы не сломать слои и правила CPU (DEVELOPMENT_RULES.md:128-167).
- Перед любым касанием системы задач: `task.manager.js`, `task.executors.js`, `task.generators.js`, `task.types.js`, `worker.runner.js` — AGENTS.md:8-10 требует отдельного согласования.
- Когда нужно решить, что проверяется офлайн, а что требует замера на шарде (AGENTS.md:16).
- Перед выгрузкой: `./node_modules/.bin/grunt screeps` (ветка `test`) — AGENTS.md:27.
- Когда «тесты зелёные, а на шарде не работает»: искать в списке непроверяемого локально.

## Архитектура этого проекта (file:line)

### Точка входа и цикл тика

- `main.js:5-9` — весь файл: `require("empire")` и `module.exports.loop = function () { empire.run(); }`. Движок вызывает `loop` один раз за тик; движок исполняет главный модуль и то, что он требует, — команды применяются после тика (docs/scripting-basics.html, docs/game-loop.html).
- `empire.js:11-57` — kernel (`module.exports.run`), порядок шагов жёсткий:
  1. `cpuMonitor.startTick()` — `empire.js:12`;
  2. удаление `Memory.creeps` мёртвых крипов — `empire.js:15-17`;
  3. гигиена `Memory`: поля верхнего уровня с `__` удаляются, если `Memory.keepTemp !== true` — `empire.js:30-37`;
  4. вся комнатная логика — `roomManager.run()` — `empire.js:43`;
  5. рынок — `empire.js:50`;
  6. сжатие очередей задач `taskManager.compactAll()` — `empire.js:55`, обязательно ДО сериализации Memory (комментарий `empire.js:52-54`);
  7. `cpuMonitor.endTick()` — `empire.js:57`.
- Весь код — модули, а не `main.js`: движок грузит модули через `require`, а `main.js` должен оставаться точкой входа (в репозитории он 9 строк). Логика в `main.js` не тестируется офлайн и раздувает горячий путь.

### Слои и их ответственность

| Слой | Файлы | Точка входа |
| --- | --- | --- |
| Kernel (империя) | `empire.js` | `empire.js:11` |
| Уровень комнаты | `room.manager.js` | `room.manager.js:547-555` (`run`) → `471-540` (`runRoom`) |
| Менеджеры подсистем | `spawn.manager.js`, `market.manager.js`, `scanner.js`, `loadShed.js`, `cpuMonitor.js` | см. таблицу ниже |
| Роли и исполнители | `role.*.js`, `worker.runner.js` | карта ролей `room.manager.js:34-44` |
| Задачи | `task.manager.js`, `task.generators.js`, `task.executors.js`, `task.types.js` | `task.manager.js:3-15` |
| Утилиты | `linkManager.js`, `mineral.manager.js`, `factory.manager.js`, `powerSpawn.manager.js`, `energySource.js`, `roomRoles.js`, `constants.js` | вызовы из `runRoom` |

`room.manager.js` собирает `roomState` (`317-416`), группирует крипов по одному проходу (`422-464`), затем запускает подсистемы (`471-540`): спавн (`:480`), 11 генераторов задач (`:481-530`), крипов (`:531`), башни (`:532`), линки (`:533`), фабрику и powerSpawn (`:534-539`). `runTowerLogic` и `detectAttack` экспортируются специально для офлайн-тестов — `room.manager.js:291-295`.

### Менеджеры подсистем (что за что отвечает)

- `spawn.manager.js:60-97` — «кого создать»: берёт первый свободный спавн (`:61-62`), считает роли одним проходом (`:30-55`), сверяет с `SPAWN_QUOTA` (`constants.js:66-76`) и после одного успешного `spawnCreep` выходит (`:95`) — одна комната делает максимум один спавн за тик. Тело и память крипа строит `creep.factory.js:44-138`, спавнит `:146-172`.
- `scanner.js:104-208` — кэш id структур комнаты в heap; перестраивается по возрасту `CACHE.REFRESH_INTERVAL` (20 тиков, `constants.js:114-116`) со сдвигом по имени комнаты (`scanner.js:70-76`) и при смене уровня контроллера (`:83-96`). `scanner.js:234-251` — индекс стройплощадок по комнатам, ключ — `Game.time`.
- `task.manager.js` — очереди задач в `Memory.rooms[room].tasks[type]`, FIFO (`:3-15`), heap-индекс на тик (`:34-47`), постановка с потолком `MAX_NEW_TASKS_PER_TYPE_PER_TICK` (`:231-293`, `constants.js:37-45`), выдача/резерв (`:295-339`), завершение через null-надгробие (`:355-378`), сжатие в конце тика (`:389-415`).
- `task.generators.js` — 11 генераторов, по одному на категорию цепочки; каждый проверяет дубль через `taskManager.hasDuplicate` (`task.generators.js:17-19`) и ставит задачу `addTask`.
- `task.executors.js` — исполнители по категории: `executors[currentTaskType]` (`worker.runner.js:23-24`), возвращают `"CONTINUE" | "DONE" | "SKIP"` (`worker.runner.js:63-71`).
- `worker.runner.js:6-94` — роль `worker`: `taskIndex` — позиция в `TASK_CHAIN`, `taskId` — ссылка на задачу в очереди (`:7-9`, `:23-24`); миграция старого формата «копия задачи в памяти крипа» (`:16-19`).
- `role.tower.js:9` — `run(tower, roomData)`, вызывается из `room.manager.js:271-273`; детектор атаки — `room.manager.js:159-181`, ремонт и лечение — `:220-269`, интервалы `TOWER.HOSTILE_CHECK_INTERVAL` и `TOWER.REPAIR_INTERVAL` (`constants.js:28-35`).
- `linkManager.js:15-39` — переброска энергии из линков-отправителей в линк у storage; конфиг в `Memory.rooms[name].links` (`:17`), ранний выход, если у приёмника нет места (`:24`), ошибка трансфера логируется (`:33-37`).
- `mineral.manager.js:18-34` — состояние минерала комнаты (id, тип, amount, extractorId) из structureCache; `object` отдаётся потребителям, чтобы не резолвить повторно.
- `factory.manager.js:1-15` — прямой вызов `factory.produce(RESOURCE_BATTERY)` при энергии в фабрике; `powerSpawn.manager.js:6-17` — `powerSpawn.processPower()`. Оба не являются задачами воркера.
- `market.manager.js:57-71` — кэш ордеров на тик (`global.__marketOrders`, ключ `Game.time`), единственный прямой `Game.market.getAllOrders`; пороги терминала берутся из `TERMINAL_SUPPLY` (`constants.js:15-22`), а не дублируются (`market.manager.js:8-11`). Проход рынка — раз в `MARKET.INTERVAL` тиков (`constants.js:118-126`).
- `cpuMonitor.js:37-53` — накопители в heap; `:66-77` `startTick`, `:84-95` `trackRole`, `:102-170` `endTick`; `Memory.cpuStats.subsystems` пишется раз в `CPU.REPORT_INTERVAL` тиков (`:125-144`).
- `loadShed.js:38` — уровни `off|lite|hard|max`; `:203-205` `effectiveLevel` = строгий из ручного флага и порогов по `Game.cpu.bucket` (`:136-144`). Потребитель — `room.manager.js:476-478`, отключение фоновых генераторов `:499-529`, фабрики/powerSpawn `:534-539`.
- `roomRoles.js:14-29` — единственное место со строковыми литералами специализаций комнат, `:44-50` `getRoomRole` (неизвестное значение → `undefined`).
- `terminalNetwork.js:1-7` — заглушка, к циклу не подключена (`empire.js:45-47`: require убран, вернётся с межкомнатной логистикой).

### Константы: один модуль, без дублей

- `constants.js:134-151` — единственная точка экспорта: `STORAGE` (`:4-6`), `TASK_TYPES` (`:8-13`), `TERMINAL_SUPPLY` (`:15-22`), `FACTORY` (`:24-26`), `TOWER` (`:28-35`), `TASK_CONFIG` (`:37-57`), `POWER_SPAWN` (`:59-62`), `PRESPAWN_THRESHOLD` (`:64`), `SPAWN_QUOTA` (`:66-76`), `MINER` (`:82-84`), `CREEP_BODIES` (`:86-107`), `CONTROLLER` (`:109-112`), `CACHE` (`:114-116`), `MARKET` (`:118-126`), `CPU` (`:128-132`).
- Новые пороги и «магические числа» добавляются сюда, а не в менеджер: правило «единый источник истины» (DEVELOPMENT_RULES.md:64-72) и уже сделанный разбор дублей (`market.manager.js:8-11`).
- Каталога `constants/` в этом чекауте нет: `Gruntfile.js:15-26` описывает поддержку `constants/*`, шаблон выгрузки — `scripts/deploy.modules.js:43`, отсутствие каталога не ломает выгрузку (`scripts/deploy.modules.js:230`).
- Два разных словаря не путать: `TASK_TYPES` (`constants.js:8-13`, используется `task.types.js:10`) — тип операции; `TASK_CHAIN` (`task.manager.js:3-15`) — 11 категорий очередей.

## Паттерны и антипаттерны

### role-based vs task-based (в репозитории есть оба)

- Role-based: модуль на роль, решение внутри `role.*.js`. Просто, но при 2 воркерах и десятках целей роль сама выбирает цель — и либо дублирует выбор (двое едут к одной цели), либо требует блокировок.
- Task-based: решение принимает генератор, исполнитель только выполняет. В репозитории так работает `worker` (`SPAWN_QUOTA.worker = 2`, `constants.js:66-76`): цепочка категорий (`task.manager.js:3-15`), очередь в Memory, резерв задачи за крипом (`task.manager.js:325-339`), снятие при `DONE`/`SKIP` (`worker.runner.js:67-89`).
- Выбор: специализированные роли с фиксированным местом (`miner` — `role.miner.js`) остаются ролями; массовая логистика — задачи. Пять ролей с квотой 0 (`constants.js:66-76`) не спавнятся вовсе (`spawn.manager.js:70-71`), но их модули живут — это переключатель без правки кода.

### Явная машина состояний вместо switch по памяти

- В репозитории: `role.harvester.js:4-16` — булев `working` с двумя переходами (набрал полный — `working`, опустошил — нет); `role.miner.js:12-38` — статичные id (`sourceId`, `linkId`) кэшируются один раз; `worker.runner.js:7-9` — `taskIndex` как позиция в цепочке.
- Антипаттерн: набор независимых флагов, по которым `switch` разбросан по файлу. Состояние должно быть одним полем, переходы — в одном месте, иначе «застрявший» крип (например, `working = true` с пустым стором) не воспроизводится и не тестируется.

### Spawn queue: один спавн — одна очередь

- `spawn.manager.js:60-62` берёт ПЕРВЫЙ свободный спавн, `:95` выходит после одного успешного спавна — комната не пытается спавнить двоих за тик.
- Два спавна в комнате видят один и тот же мир: крип, созданный первым, ещё не в `Game.creeps`. Поэтому споты резервируются в heap на тик — `creep.factory.js:33-42`; живой инцидент (два майнера на одном споте) описан в комментарии `creep.factory.js:24-31`.
- `homeRoom` пишется ВСЕГДА (`creep.factory.js:159-167`): без него крип не попадал ни в одну квоту (`spawn.manager.js:30-55` считает по `homeRoom`), и комната спавнила лишнего.

### Кэш комнаты на тик и heap

- Кэш структур — в `global` (`scanner.js:99-102`), потому что массивы id не меняются тиками, а `Memory` сериализуется целиком каждый тик (docs/global-objects.html).
- Индексы, привязанные к объектам игры, живут ровно один тик и ключуются `Game.time`: индекс площадок `scanner.js:234-251`, heap задач `task.manager.js:34-47`, кэш ордеров `market.manager.js:57-71`, резервация спотов `creep.factory.js:33-42`.
- Объекты `Game` между тиками хранить нельзя: «The Game object is created from scratch and filled with data at each tick», в `Memory` нельзя класть живые объекты — только `id` и `Game.getObjectById` (docs/global-objects.html). `id` переживает тик и рестарт, объект — нет.
- `global` переживает тики, но не рестарт и не загрузку новой версии кода; require-кэш привязан к `global` и очищается вместе с ним (docs/contributed/caching-overview.html). Комментарии репозитория это предполагают: `cpuMonitor.js:34-36`, `scanner.js:19-23`.

### Идемпотентность тика и «долгие» операции

- Дорогое — один раз за тик, а не на крипа: группировка крипов одним проходом (`room.manager.js:422-464`), ленивый резолв дорог и стен (`room.manager.js:97-105`, `129-136`), индекс площадок (`scanner.js:234-251`), heap-индекс задач вместо `tasks.some` на каждого кандидата (`task.manager.js:20-33`).
- В цикле по крипам запрещены `Object.values(Game.*)` и `room.find` — DEVELOPMENT_RULES.md:141-160; это механически проверяет `tests/rules.test.js:106-124`. `getUsed()` на каждого крипа тоже выключен по умолчанию (`room.manager.js:57-77`, замер в комментарии `:58-60`).
- Идемпотентность: повторный вызов менеджера в том же тике не должен создавать вторую задачу — за это отвечает `hasDuplicate` (`task.generators.js:17-19`) и лимит постановок (`task.manager.js:249-255`).

### Обработка ошибок и коды возврата

- Проверять код возврата каждого интента: `linkManager.js:32-37` логирует неуспешный `transferEnergy`; `worker.runner.js:73-89` явно логирует аномалию «задача не найдена в FIFO», а не считает её молча успехом.
- Роль целиком обёрнута в try/catch, чтобы один крип не ронял тик: `room.manager.js:46-55`.
- Тихая ошибка — источник багов: `factory.manager.js:9-13` вызывает `produce()` и логирование результата закомментировано; `powerSpawn.manager.js:15` игнорирует код `processPower()`. Если добавляете вызов структуры — обрабатывайте код, а не только «вызвалось».
- Логировать на границах подсистем, а не в горячем пути: `cpuMonitor.js:84-95` меряет подсистемы, логи — раз в `CPU.REPORT_INTERVAL` (`:125`).

## Тесты: что проверяется локально, что только на шарде

### Как устроены тесты в проекте

- Запуск ровно так: `node tests/<файл>.test.js` (AGENTS.md:22). Всего 13 файлов; агрегат последнего прогона — `tests/.last-run.json:2-15` (13 файлов, 262 проверки, 0 падений, Node v24.14.0, команда `for f in tests/*.test.js; do node "$f"; done`).
- Моков фреймворка нет. Каждый тест сам ставит игровые глобалы (`global.Game`, `global.Memory`, `global.OK`, константы тел) — пример `tests/spawn.count.test.js:32-50`.
- Шим разрешения модулей повторяет шард, где `require("creep.factory")` резолвится от корня: подмена `Module._resolveFilename` — `tests/spawn.count.test.js:19-30` (то же в `tests/roomstate.test.js:19-30`).
- Соглашение о выводе: локальный `check(label, cond, extra)` печатает `  PASS  ...` / `  FAIL  ...`, в конце `Итого: N PASS, M FAIL, K всего` и `process.exit(failed === 0 ? 0 : 1)` — `tests/spawn.count.test.js:56-66`, `:225-226`.
- Часть модулей экспортирует внутренности только ради тестов: `spawn.manager.js:100-101` (`countRoles`), `room.manager.js:291-295` (`runTowerLogic`, `detectAttack`).

### Локальный сервер: screeps-server-mockup

- Пакет есть: `screeps-server-mockup`, latest `1.5.1`, опубликован `2020-04-21T18:55:59Z`; метаданные реестра обновлялись `2022-06-26` (данные `registry.npmjs.org/screeps-server-mockup`). Зависимости: `lodash ^4.17.15`, `screeps ^4.1.5`, `fs-extra-promise ^1.0.1`; peerDependencies: `@screeps/common ^2.13.2`, `@screeps/driver ^5.1.0`, `@screeps/engine ^4.1.2`.
- Стек ещё разрешается: `@screeps/engine` latest `4.3.2` (`2026-06-01`), `@screeps/driver` latest `5.2.7`, пакет `screeps` latest `4.3.0` (`2026-04-01`, внутри жёстко `@screeps/driver 5.3.0`, `@screeps/engine 4.3.0`, `@screeps/storage 5.1.3`) — диапазоны peer-зависимостей мокапа покрываются.
- Требования по README мокапа: Node.js 10 LTS или выше, Python (для node-gyp), build tools. Про Steam в требованиях не сказано; Steam нужен самому приватному серверу для аутентификации (локальный Steam-клиент либо `--steam_api_key`), см. README `screeps/screeps`.
- Мокап поднимает процесс `@screeps/storage` и вручную эмулирует главный цикл движка (`server.start()` → `server.tick()`), исходники: `src/screepsServer.ts:102`, `:135-153`. Ограничения: тик за тиком, один процесс на тест, нет реальной конкуренции игроков.
- [НЕ ПРОВЕРЕНО] end-to-end установка и запуск в этом окружении: пакет не устанавливался (в окружении `npm` падает на кэше с `EPERM`), зависимостей в проект не добавляли. Совместимость мокапа 2020 года с движком 4.3.2 (2026) по факту не запускалась.

### Чего нельзя проверить локально

- Реальный CPU: `Game.cpu.getUsed()` «Always returns 0 in the simulator» — комментарий к `CPU.getUsed()` в типах DefinitelyTyped (`types/screeps/index.d.ts`, строка ~1992). Значит, ни лимит, ни стоимость операции офлайн не измеряются.
- Лимит и bucket: лимит зависит от GCL (или фиксирован 20), bucket копит до 10 000, из bucket можно взять до 500 CPU за тик, `Game.cpu.tickLimit >= Game.cpu.limit` — docs/cpu-limit.html.
- Поведение шарда: порядок применения интентов, конфликты перемещений, видимость комнат, бой — docs/game-loop.html.
- Рынок: реальные ордера и их цена; локально проверяется только throttle и кэш (`tests/market.throttle.test.js`), стоимость `getAllOrders` 0.16–0.89 CPU получена замером на шарде (`market.manager.js:45-48`).
- Объём `Memory` (лимит 2 МБ) и стоимость `JSON.parse` — docs/global-objects.html.
- Вывод: правила CPU и поведение бота подтверждаются замером на живом шарде (`Memory.cpuStats`, `scripts/baseline.js`, docs/CPU-BASELINE.md), а не чтением кода (AGENTS.md:16).

### Что проверяется офлайн

Чистые функции и структуры: арифметика квот (`spawn.count.test.js`), сборка `roomState` (`roomstate.test.js`), индексы и кэши (`scanner.cache.test.js`, `task.index.test.js`, `sites.index.test.js`), уровни loadShed (`load.shed.test.js`), правила CPU по тексту исходников (`rules.test.js`). Проверка правил — механическая: `tests/rules.test.js:77-89` ищет нарушения регулярками по коду без комментариев.

## Рецепты (код)

### 1. Тест на чистую функцию (арифметика квот)

```js
"use strict";
// Пример в стиле tests/spawn.count.test.js: шим require + глобалы + check().
const Module = require("module");
const fs = require("fs");
const path = require("path");

// На шарде require("creep.factory") резолвится от корня — повторяем это в Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

// Ровно те глобалы, которые нужны подключаемому модулю.
global.OK = 0;
global.ERR_INVALID_ARGS = -5;
global.TOUGH = "tough";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.Memory = { rooms: {} };
global.Game = { time: 1000, creeps: {}, rooms: {}, cpu: { getUsed: () => 0 } };

const { SPAWN_QUOTA, PRESPAWN_THRESHOLD } = require("../constants");
const { countRoles } = require("../spawn.manager");

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

// Фикстура — обычные объекты: чистой функции настоящий Creep не нужен.
const creeps = [
  { memory: { role: "worker" }, ticksToLive: 1200 },
  { memory: { role: "worker" }, ticksToLive: 1200 },
  { memory: { role: "miner" }, ticksToLive: PRESPAWN_THRESHOLD.miner - 1 },
];

const counts = countRoles(creeps);
check("worker: 2", counts.worker === 2, String(counts.worker));
check("уходящий miner не считается", counts.miner === undefined);
check("квота miner > 0", SPAWN_QUOTA.miner > 0);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
```

### 2. Кэш на тик в heap (объекты игры переживать тик не должны)

```js
// Ключ — Game.time: индекс, построенный по объектам Game, действителен один тик.
function heapIndex() {
  if (!global.__myIndex || global.__myIndex.tick !== Game.time) {
    global.__myIndex = { tick: Game.time, byRoom: {} };
  }
  return global.__myIndex;
}
```

### 3. Явная машина состояний крипа

```js
const STATES = { IDLE: "idle", ACQUIRE: "acquire", WORK: "work", DELIVER: "deliver" };

function run(creep) {
  if (!creep.memory.state) creep.memory.state = STATES.IDLE;

  switch (creep.memory.state) {
    case STATES.IDLE:
      creep.memory.state =
        creep.store.getFreeCapacity() === 0 ? STATES.DELIVER : STATES.ACQUIRE;
      break;
    case STATES.ACQUIRE:
      creep.memory.state =
        creep.store.getFreeCapacity() === 0 ? STATES.DELIVER : STATES.WORK;
      break;
    case STATES.WORK:
      creep.memory.state =
        creep.store.getUsedCapacity() === 0 ? STATES.IDLE : STATES.DELIVER;
      break;
    case STATES.DELIVER:
      creep.memory.state =
        creep.store.getUsedCapacity() === 0 ? STATES.IDLE : STATES.WORK;
      break;
    default:
      creep.memory.state = STATES.IDLE;
  }
}
```

### 4. Генератор задачи с проверкой дубля

```js
const taskManager = require("task.manager");

const TASK_TYPE = "buildStructures";
const FIELDS = ["type", "targetId"];

function generateBuild(site, roomName) {
  if (!site) return;

  const candidate = { type: "build", targetId: site.id };

  // hasDuplicate — O(1) через heap-индекс (task.manager.js:108-112).
  if (taskManager.hasDuplicate(roomName, TASK_TYPE, candidate, FIELDS)) return;

  taskManager.addTask(roomName, TASK_TYPE, candidate);
}
```

### 5. Обработка кода возврата интента

```js
const result = creep.withdraw(storage, RESOURCE_ENERGY);

if (result === OK) return "CONTINUE";
if (result === ERR_NOT_IN_RANGE) {
  creep.moveTo(storage, { reusePath: 50 });
  return "CONTINUE";
}

// Цель исчезла или опустела — задачу надо снять, а не «подождать».
if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_INVALID_TARGET) {
  return "SKIP";
}

console.log(`[executor] withdraw -> ${result}`);
return "SKIP";
```

## Подводные камни

- `Memory` сериализуется целиком каждый тик — любой мёртвый ключ это постоянный расход; временные поля с `__` вычищает `empire.js:30-37`, снять уборку можно только `Memory.keepTemp = true` (`empire.js:27-29`).
- `global` не персистентен: рестарт и загрузка новой версии кода его теряют, require-кэш очищается вместе с ним (docs/contributed/caching-overview.html). Всё, что должно пережить рестарт, — в `Memory`, статичные кэши — в heap (`cpuMonitor.js:34-36`).
- Выгрузка кода не трогает `Memory`: `grunt screeps` вызывает `api.code.set(branch, modules)` (`Gruntfile.js:59-60`), запись в `Memory` деплой не делает. Сброс `global` при загрузке нового кода — ожидаемое следствие; [НЕ ПРОВЕРЕНО] на живом шарде в рамках этого скилла.
- Хвост очереди задач: без потолка в E35S37 накопилось 187 задач, воркер брал произвольную из хвоста (`task.manager.js:239-248`). Потолок — `TASK_CONFIG.MAX_NEW_TASKS_PER_TYPE_PER_TICK` (`constants.js:37-45`), откат — большое число.
- Крип обязан уехать в `homeRoom` (`creep.factory.js:159-167`), иначе ломаются квоты; один крип — ровно один `roomState` (`room.manager.js:426-455`).
- `completeTask` оставляет null-надгробие; если не вызвать `taskManager.compactAll()` до конца тика, дыры уедут в `Memory` (`empire.js:52-55`, `task.manager.js:369-375`).
- `reusePath` по умолчанию 5 тиков, путь кладётся в память крипа, `reusePath: 0` отключает переиспользование; `serializeMemory` по умолчанию `true` (типы DefinitelyTyped, `MoveToOpts`). В ролях используются значения 15-50 (`role.harvester.js:30`, `task.executors.js:12`).
- Правило «нет ссылки — это гипотеза» (AGENTS.md:13-14): утверждение о поведении бота без файл:строка или замера не является основанием для правки.

## Источники

- Репозиторий (прочитано): `main.js`, `empire.js`, `room.manager.js`, `spawn.manager.js`, `creep.factory.js`, `scanner.js`, `constants.js`, `task.manager.js`, `task.generators.js`, `task.executors.js`, `task.types.js`, `worker.runner.js`, `role.*.js`, `linkManager.js`, `mineral.manager.js`, `factory.manager.js`, `powerSpawn.manager.js`, `market.manager.js`, `cpuMonitor.js`, `loadShed.js`, `roomRoles.js`, `terminalNetwork.js`, `Gruntfile.js`, `scripts/deploy.modules.js`, `scripts/memory.audit.js`, `tests/*.test.js`, `tests/.last-run.json`, `AGENTS.md`, `docs/task-system-v3.0/DEVELOPMENT_RULES.md`.
- Screeps API (типы): https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/screeps/index.d.ts — `Game.cpu.getUsed()` «Always returns 0 in the simulator», `MoveToOpts.reusePath` (default 5), `serializeMemory` (default true).
- Движок: https://raw.githubusercontent.com/screeps/engine/master/src/game/game.js — `makeGameObject({ runtimeData, intents, memory, getUsedCpu, globals, ... })`, `Game.cpu` собирается из `runtimeData.cpu`, `runtimeData.user.cpu`, `runtimeData.cpuBucket`; https://raw.githubusercontent.com/screeps/engine/master/src/main.js — стадии главного цикла.
- Документация: https://docs.screeps.com/cpu-limit.html (лимит, bucket 10 000, до 500 CPU/тик, `tickLimit`), https://docs.screeps.com/global-objects.html (Game создаётся заново каждый тик; хранить только `id`; Memory 2 МБ; JSON.parse каждый тик), https://docs.screeps.com/game-loop.html (тик и применение команд), https://docs.screeps.com/scripting-basics.html, https://docs.screeps.com/api/, https://docs.screeps.com/contributed/caching-overview.html (global сбрасывается, не персистентен).
- npm-реестр: https://registry.npmjs.org/screeps-server-mockup (latest 1.5.1, 2020-04-21; deps и peerDeps), https://registry.npmjs.org/@screeps%2Fengine (latest 4.3.2, 2026-06-01), https://registry.npmjs.org/screeps (latest 4.3.0, 2026-04-01), https://registry.npmjs.org/@screeps%2Fdriver (latest 5.2.7), https://registry.npmjs.org/@screeps%2Fstorage (latest 5.1.3).
- Мокап: https://github.com/screepers/screeps-server-mockup — README (требования: Node 10 LTS+, Python, build tools), `src/screepsServer.ts` (процесс `@screeps/storage`, эмуляция цикла движка); https://github.com/screeps/screeps — README (аутентификация через Steam или `--steam_api_key`, хранилище по умолчанию LokiJS).
- Провайдер скиллов DSH (локальный чекаут): `@deepseek-ai/dsh-skill` — шаблон имени `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, обязательные поля `name` и `description`; `@deepseek-ai/dsh-skill-filesystem` — каталог проекта `.dsh/skills`, разбор frontmatter, устаревшие поля `disableModelInvocation`/`userInvocable` отклоняются.
