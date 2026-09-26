# newScreeps

Бот для [Screeps](https://screeps.com) (официальный шард, ветка деплоя `test`).
Сборки нет: движок исполняет те же `*.js`, что лежат в репозитории.

**Точка входа на шарде — `main.js`.** Он подключает `traveler` и каждый тик
вызывает `empire.run()` из `empire.js` (ядро империи). Вся остальная логика —
модули рядом, в корне и в `constants/`.

## Ветки: trunk — `Новая-Империя`

**Trunk (основная линия) — `Новая-Империя`.** В ней вся разработка, из неё идёт
деплой, и она же — ветка по умолчанию (`origin/HEAD`). Коммиты идут прямо в неё.

| Ветка | Роль |
| --- | --- |
| `Новая-Империя` | **trunk**: единственная живая линия, источник деплоя. |
| `main` | Архив: заморожена на 2026-07-08 (`8c99cad`), не сливается и не пушится. |
| `empire-candidate-1`, `empire-candidate-2` | Эксперименты 2026-07-09, не развиваются. |

Если ветка по умолчанию на GitHub сбилась на `main`, вернуть её:
`gh repo edit --default-branch 'Новая-Империя'` или Settings → General →
Default branch.

Ветка **`test`** в деплое (`npx grunt screeps`, `.screeps.json`) — это ветка кода
внутри аккаунта Screeps, **не** git-ветка: в неё выгружаются те же `*.js` из
рабочего дерева (см. «Деплой»). Не путать её с trunk.

## Быстрый старт

```sh
npm install
export SCREEPS_TOKEN=...            # или .screeps.json в корне (см. «Токен»)
npm test                            # офлайн-тесты
npx grunt screeps                   # деплой в ветку test
node tests/live.diff.deployed.js    # сверить, что реально уехало
SECONDS=30 node tests/live.console.tail.js   # хвост консоли шарда
```

Требования: Node.js `^20.19 || ^22.13 || >=24` (проверено на v24.14 — столько
требует eslint 10) и аккаунт Screeps с токеном.

## Как устроен код

| Файл | Роль |
| --- | --- |
| `main.js` | Точка входа: `require("traveler")()` + `empire.run()`. |
| `empire.js` | Ядро империи: очистка `Memory.creeps`, heap-кэши, `shardState.ensure()`, гейт по bucket, запуск подсистем. |
| `room.manager.js` | Комнатная логика: роли, задачи, башни, линки, лабы, фабрика, powerSpawn. |
| `spawn.manager.js`, `creep.factory.js` | Спавн и тела крипов по квотам. |
| `task.manager.js`, `task.generators.js`, `task.executors.js`, `worker.runner.js` | Task System: генерация очередей, приоритеты, назначение, исполнение. |
| `remote.manager.js`, `remote.miner.js`, `remote.hauler.js`, `remote.reserver.js`, `remote.handoff.js` | Дальняя добыча. |
| `defense.manager.js`, `defense.attacker.js`, `threat.js` | Оборона домашних и удалённых комнат. |
| `market.*.js`, `terminalNetwork.js`, `factory.manager.js`, `lab.*.js`, `mineral.manager.js` | Экономика: рынок, межкомнатная логистика, фабрика, лаборатории, минералы. |
| `observer.manager.js`, `scanner.js` | Разведка и обход обсервером. |
| `shard.state.js` | `Memory.empire`: удалённые комнаты, ID линков, маршруты, комнаты риска, точка сбора. |
| `cpuMonitor.js` | Замер CPU по блокам (`Memory.cpuStats`) и порог bucket. |
| `constants.js` + `constants/*.js` | Конфиг по доменам; `constants.js` — barrel без значений. |
| `traveler.js` | Vendored-библиотека перемещения; без нужды не править. |
| `types.d.ts`, `jsconfig.json`, `eslint.config.js` | Инструменты разработки, на шард не уезжают. |

Порядок подсистем в `empire.run()`: `roomManager` → `observerManager` →
`defenseManager` → `remoteManager` → `terminalNetwork` → `marketManager`.
`observerManager`, `terminalNetwork` и `marketManager` — необязательные: при
`Game.cpu.bucket < CPU.BUCKET_CRITICAL` они пропускаются, ядро работает всегда.

Правила, которые легко нарушить:

- **Константы — только в `constants/*.js`**, потребители берут их через
  `require("./constants")`. Barrel отдаёт те же объекты, что и доменные модули
  (важно там, где конфиг мутируют на месте); контракт держит
  `tests/module.barrel.test.js`.
- **Имя модуля на шарде — путь файла без расширения** (`constants/market`,
  `market.sell`). Новые подпапки, кроме `constants/`, ломают выгрузку и
  `require`.
- Настраиваемое состояние империи живёт в `Memory.empire` (`shard.state.js`) и
  правится из консоли без деплоя; `ensure()` дозаполняет только отсутствующие
  ключи и не затирает правки владельца.

## Тесты

### Офлайн (`tests/*.test.js`)

```sh
npm test                            # все тесты
npm test lab market                 # только те, в имени которых есть lab ИЛИ market
node tests/module.barrel.test.js    # один тест напрямую
node tests/run-all.js --list        # показать, что будет запущено
node tests/run-all.js -v            # печатать вывод и успешных тестов
node tests/run-all.js --timeout=60000
```

Раннер (`tests/run-all.js`) запускает каждый `*.test.js` **в отдельном
процессе**: тесты переопределяют `Game`/`Memory`/`console`, патчат модули бота
и зовут `process.exit`. Код возврата: `0` — всё прошло, `1` — есть падения или
таймауты, `2` — тестов не найдено. Упавшие тесты печатаются хвостом вывода.

Новый тест — просто файл `tests/<имя>.test.js`; правки в раннере не нужны.

Числа тестов в этом файле и в `docs/SESSION_HANDOFF.md` не набираются руками:
они сгенерированы из вывода раннера и живут между маркерами `tests:auto`
(HTML-комментарии вокруг числа, в отрендеренном markdown невидимы). Обновить —
`npm run test:counts`; проверить, что доки не разошлись с прогоном, —
`npm run test:counts:check` (эту же сверку делает `npm run ci` в pre-push и в CI).

Актуальный статус: <!-- tests:auto -->**36 PASS / 0 FAIL** (36 файлов)<!-- /tests:auto -->.
Фабричный контур **включён под гейтом**: три флага (`factory`, `fillFactoryEnergy`,
`collectFactoryBattery`) стоят `true` и обязаны совпадать — инвариант держит
`tests/factory.manager.test.js`. Энергию фабрика получает только когда в комнате
целы оба резерва: терминал 100 000–150 000 и склад ≥150 000
(`factory.manager.canTakeStorageEnergy`), поэтому до готовности резервов она не
объедает терминал, лаборатории и PowerSpawn. Порог подвоза терминала понижен до
резерва склада (150 000), пол склада жёсткий. План и живые числа —
`docs/FACTORY-ENERGY-CONTRACT.md`; история — `docs/SESSION_HANDOFF.md`, §0.0000.

### Live-скрипты (`tests/live.*.js`, `tests/_*.js`)

Работают с реальным сервером через `screeps-api` и **требуют токена** (см.
ниже); без него падают с понятной ошибкой из `requireToken()`.

```sh
node tests/live.diff.deployed.js            # что уедет / уже лежит на шарде
node tests/live.room.overview.js E35S37     # [room]
SECONDS=30 node tests/live.console.tail.js
SHARD=shard3 node tests/live.cpu.profile.js # шард по умолчанию shard3
```

Соглашения:

- `live.*.js` — инструменты «долгого» пользования; `_*.js` — одноразовые
  отладочные пробы, в `npm test` не входят.
- Шард по умолчанию `shard3`, переопределяется переменной `SHARD`.
  Дополнительные параметры (`SECONDS`, `DURATION`, `BRANCH`, имя комнаты)
  описаны в шапке конкретного файла.
- **По умолчанию live-скрипты только читают.** Исключения, которые пишут в
  игру: `live.tasks.cleanup.js` (чистит `Memory.rooms[*].tasks`) и
  `live.move.container.js` (переносит площадку контейнера). Временно
  инструментируют живой VM `live.cpu.instrument.js` и
  `live.profile.labworker.js` — обёртки снимаются в конце.
- Диагностика пишет снимок в `Memory.__*` (`__ov`, `__diag`, `__lw`,
  `__prioProbe`, `__labImport`, …) и вычитывает его отдельным запросом: прямой
  консольный ответ не дожидается следующего тика.
- **Лимит консоли Screeps:** выражения длиннее ~1000 символов молча
  игнорируются (HTTP 200, пустые `results`). Поэтому короткая команда кладёт
  результат в `Memory`, а скрипт забирает его через `api.memory.get`.

Самые нужные (полный список — `ls tests/live.*.js`):

| Скрипт | Зачем |
| --- | --- |
| `live.diff.deployed.js` | Сверка локальных файлов с кодом ветки `test` — перед деплоем. |
| `live.console.tail.js` | Хвост `console.log`/ошибок шарда через сокет (`SECONDS=30`). |
| `live.dump.rooms.js`, `live.dump.controllers.js`, `live.dump.geometry.js`, `live.dump.terrain.js` | Снимки в `/tmp/rooms.json`, `/tmp/ctrl.json`, `/tmp/geom.json`, `/tmp/terrain.json` для офлайн-разбора. |
| `live.dump.remote.js`, `live.diagnose.remote.js`, `live.prespawn.probe.js` | Диагностика дальней добычи и пре-спавна. |
| `live.room.overview.js`, `live.diag.worker.js` | Состояние комнаты и отдельного крипа. |
| `live.cpu.profile.js`, `live.roomstate.bench.js`, `live.tower.coverage.js` | CPU-профиль и адресные замеры. |
| `live.verify.*` | Живая проверка задеплоенного контура (бусты, handoff, powerspawn, пре-спавн). |
| `live.boost.monitor.js`, `live.watch.border.js`, `live.labs.all.js` | Мониторинг бустов, границы, лабораторий. |
| `live.task16.*`, `live.priority.check.js`, `live.energy.balance.js` | Рынок, доход, приоритеты. |

Отдельно: `tests/path.sim.js` и `tests/analyze.terrain.js` — офлайн-разбор
снимка `/tmp/rooms.json`; `tests/dsh.preset.toolfilter.check.mjs` — проверка
локального DSH-пресета, к рантайму бота отношения не имеет.

## Деплой

```sh
npx grunt screeps
```

Задача `screeps` (`Gruntfile.js`) выгружает `*.js` из корня и `constants/*.js`
в ветку **`test`** через `screeps-api`, сохраняя путь файла без расширения как
имя модуля. Вся логика «что уедет и под каким именем» — в
`scripts/deploy.modules.js` (её проверяет `tests/deploy.modules.test.js`, без
сети и токена). `Gruntfile.js`, `screeps.token.js` и `eslint.config.js` из
выгрузки исключены — это служебный код, на шарде он не нужен.

Почему не `grunt-screeps`: он берёт имя модуля из basename, поэтому папки
разворачиваются в корень (`constants/logistics.js` → модуль `logistics`), и
`require("./constants/market")` на шарде не разрешается.

**require на шарде — не Node.require.** Движок отбрасывает ведущий `./` и ищет
модуль по имени **от корня**, без разрешения относительно папки вызывающего
модуля. Поэтому из корневых файлов `require("./constants/logistics")` работает
(→ `constants/logistics`), а из `constants/*.js` сосед по папке — нет:
`require("./logistics")` ищет модуль `logistics` и падает с
`Unknown module 'logistics'` (живое падение 25.09.2026 — `constants/powerSpawn`,
следом то же самое ждало `constants/spawn` с `./creeps`). Поэтому при выгрузке
относительные спецификаторы файлов из подпапок переводятся в корневые имена;
исходники при этом остаются обычными для Node (`npm test`, линтер, переход по
ссылке в IDE). Сравнение «что уедет / что лежит на шарде» ниже идёт через ту же
сборку.

Перед выгрузкой каждый `require("<литерал>")` проверяется на разрешимость по
правилам движка: если он указывает на невыгружаемое имя, задача падает до
обращения к API, а не «Unknown module» на живом шарде.

Перед деплоем посмотрите, что именно уедет (выгружаются все локальные `*.js`,
включая незакоммиченные правки):

```sh
node tests/live.diff.deployed.js
```

После деплоя — функциональный контроль:

```sh
SECONDS=30 node tests/live.console.tail.js
node tests/live.verify.handoff.js
```

## Токен

Токен деплоя и API **не хранится в репозитории**. Единая точка получения —
`screeps.token.js`; порядок источников:

1. переменная окружения `SCREEPS_TOKEN` (или legacy `SCREEPS_AUTH_TOKEN`);
2. `.screeps.json` **в корне проекта** (файл в `.gitignore`);
3. `~/.screeps.json` — fallback самой библиотеки `screeps-api` (скрипт
   предупреждает в stderr, что источник резервный).

`Gruntfile.js` и все live-скрипты читают токен через `resolveToken()` /
`requireToken()` из `screeps.token.js`.

Пример `.screeps.json`:

```json
{ "token": "<токен>", "branch": "test", "ptr": false }
```

### Ротация токена (при утечке)

1. Отозвать старый токен: Screeps → **Account → Auth tokens** → удалить
   скомпрометированный.
2. Создать новый токен там же.
3. Прописать новый токен **вне git**, любым из способов:
   - `export SCREEPS_TOKEN=...` (приоритетный и предпочтительный для CI);
   - отредактировать `.screeps.json` в корне проекта (файл в `.gitignore`).
4. Если старый токен лежал в `~/.screeps.json` — заменить его и там
   (файл вне репозитория, но всё ещё содержит секрет).
5. Проверить, что секрет не попал в git:

   ```sh
   git log --all -S'<старый_токен>' --oneline
   git grep '<старый_токен>' $(git rev-list --all)
   ```

### Очистка истории git

`scripts/run-history-scrub.sh` переписывает историю всех ветвей и удаляет
секрет из всех объектов (эквивалент `git filter-repo --replace-text`,
реализован на git plumbing без Python):

```sh
scripts/run-history-scrub.sh '<секрет>' '[REDACTED]'
```

Скрипт делает зеркальный клон, заменяет секрет во всех blob'ах, чистит
недостижимые объекты и подменяет `.git`, оставляя бэкап старого `.git`.
**Push после этого требует `--force`.**

## Проверки качества

```sh
npm run check             # = lint + typecheck, обе части должны завершиться с кодом 0
npm run lint              # eslint .                       — 0 ошибок (27 warnings — в одноразовых _*.js)
npm run typecheck         # tsc по jsconfig.json + tsconfig.tools.json
npm run test:counts       # переписать числа тестов в README/HANDOFF из вывода раннера
npm run test:counts:check # сверить числа в доках с прогоном (код 1 при дрейфе)
npm run ci                # = check + test + test:counts:check — все гейты одной командой
```

Эквивалент вызовов вручную:

```sh
npx eslint .                              # 0 ошибок (27 warnings — в одноразовых _*.js)
npx tsc --noEmit -p jsconfig.json         # код бота: типы @types/screeps
npx tsc --noEmit -p tsconfig.tools.json   # Node-инструменты: типы @types/node
```

`eslint.config.js` подключает `eslint-config-screeps` и добавляет глобалы
движка, которых нет в конфиге (`RESOURCE_BATTERY`, `RESOURCE_H`,
`STRUCTURE_FACTORY`, `STRUCTURE_INVADER_CORE`).

`jsconfig.json` проверяет JS бота с типами `@types/screeps`
(`moduleResolution: classic`). Node-файлы (`Gruntfile.js`, `screeps.token.js`,
`scripts/*`, `eslint.config.js`) в него не входят: у них другая среда и другие
типы. Их отдельно проверяет `tsconfig.tools.json` с `@types/node`
(`moduleResolution: node`). Оба вызова `tsc` должны завершаться с кодом 0;
каталог `tests/` типами не покрыт ни одним из конфигов.

### Хуки git (локальный CI)

`npm install` сам подключает версионируемые хуки из `.githooks/` через
`core.hooksPath` (`scripts/install-hooks.js`, он же `npm run hooks:install`;
повторный вызов идемпотентен).

| Хук | Что запускает | Когда |
| --- | --- | --- |
| `.githooks/pre-commit` | `npm run check` — eslint + оба `tsc` (~6 с) | перед каждым коммитом |
| `.githooks/pre-push` | `npm run ci` = `npm run check` + `npm test` + `npm run test:counts:check` (~10 с) | перед push |

Все проверки локальные: сеть, токен и живой шард не нужны. Хук упал —
коммит (push) отменён, код возврата 1. Осознанный обход для WIP:

```sh
git commit --no-verify           # или: SKIP_CHECK=1 git commit -m "..."
git push --no-verify             # или: SKIP_TESTS=1 git push
```

Проверить, что хуки подключены: `git config --get core.hooksPath` → `.githooks`.

### CI на GitHub

`.github/workflows/ci.yml` гоняет те же гейты на каждый push и pull request:
job `check` — `npm run check`, job `test` — `npm test` + `npm run test:counts:check`
(Node 24, `npm ci`). Секреты не нужны: раннер `tests/run-all.js` не обращается к
шарду. Локальные хуки и GitHub CI используют одни и те же npm-скрипты, поэтому
«зелено локально» и «зелено в CI» означают одно и то же.

## Документация

| Документ | О чём |
| --- | --- |
| `docs/PROJECT_AUDIT_AND_ROADMAP.md` | Большой аудит и план развития — главный документ по состоянию проекта. |
| `docs/SESSION_HANDOFF.md` | Состояние на конец последней сессии: что сделано, проверено и что осталось. |
| `docs/ASSESSMENT-2026-09-24.md` | Свежая оценка проекта по пунктам. |
| `docs/CPU-PROFILE.md` | База CPU-профиля для сравнения замеров. |
| `docs/INCOME-AND-PREEMPTION-CHECK.md` | Живой замер дохода и гипотезы прерывания задач. |
| `docs/LAB_BOOST_PRODUCTION_PLAN.md`, `docs/EXPEDITION_BOOST_STOCK_PLAN.md`, `docs/Labs.md` | Лаборатории, бусты, производство и склад. |

## Структура

```
main.js              точка входа на шарде
empire.js            ядро империи
room.manager.js      комнатная логика
*.manager.js         подсистемы (спавн, рынок, линки, фабрика, оборона, …)
role.*.js            роли крипов
task.*.js            Task System
remote.*.js          дальняя добыча
constants.js         barrel конфига
constants/*.js       конфиг по доменам
types.d.ts           типы для редактора
.githooks/           pre-commit (npm run check) и pre-push (npm run ci)
tests/               офлайн-тесты (*.test.js) и live-скрипты (live.*, _*)
scripts/             служебные скрипты (хуки, деплой, sync-test-counts, очистка истории git)
docs/                аудиты, планы, отчёты
```
