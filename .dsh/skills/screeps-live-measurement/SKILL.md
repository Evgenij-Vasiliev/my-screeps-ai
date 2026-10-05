---
name: screeps-live-measurement
description: "Как в проекте newScreeps безопасно мерить живого бота: правила AGENTS.md, scripts/baseline.js, лимиты консоли, тесты и формат отчёта о замере."
whenToUse: Когда нужна цифра с живого шарда (CPU, Memory, поведение бота) или когда готовишь правку и должен пройти порядок «замер → согласование → тесты → выгрузка».
---

# Живой замер в проекте newScreeps

Процедура получения цифр с живого шарда и правила, которые её ограничивают:
порядок «read-only замер → предложение → согласование → правка → тесты →
выгрузка», инструменты репозитория, обход лимита консоли и формат отчёта.
Всё ниже — со ссылками `файл:строка` внутри репозитория; ничего не проверено
«по памяти».

## Когда использовать

- Нужна цифра, а не оценка: поведение бота проверяется замером на живом шарде, а не чтением кода (`AGENTS.md:16`).
- Готовишь правку: до неё обязателен read-only замер, после — тесты, выгрузка отдельной командой (`AGENTS.md:20-21`).
- Запускаешь `scripts/baseline.js` или `scripts/memory.audit.js`.
- Пишешь отчёт о замере и нужно понять, что в нём обязательно указать.
- Собираешься что-то выгрузить и нужно вспомнить, что именно уезжает на шард.

## Ключевые факты

### 1. Правила проекта (`AGENTS.md`)

| Факт | Значение | Источник |
|---|---|---|
| Запрет действий | ни одной правки, выгрузки, спавна, suicide без явной команды человека | `AGENTS.md:4-5` |
| Флот | никаких массовых операций над флотом (suicide, переспавн, квоты) — никогда | `AGENTS.md:7` |
| Task-система | изменения только по отдельному согласованию: `task.manager.js`, `task.executors.js`, `task.generators.js`, `worker.runner.js` | `AGENTS.md:8-10` |
| Утверждение | либо `файл:строка`, либо цифра из замера с командой; без ссылки — гипотеза, не основание | `AGENTS.md:13-14` |
| Нет данных | говорить «не знаю»; оценка вместо факта запрещена | `AGENTS.md:15` |
| Поведение бота | проверять замером на живом шарде, а не выводить из чтения кода | `AGENTS.md:16` |
| Шаг | один шаг — одно действие, у каждого шага есть точка отката | `AGENTS.md:19` |
| Порядок | read-only замер → предложение → согласование → правка → тесты → выгрузка | `AGENTS.md:20-21` |
| Тесты | перед правкой прогнать `node tests/<файл>.test.js` (всего 28 файлов) или всё разом: `node scripts/check.all.js` | `AGENTS.md:22-23`, `scripts/check.all.js:1-40` |
| Деплой | `./node_modules/.bin/grunt screeps` (ветка `test`) — всегда отдельная команда человека | `AGENTS.md:21,27` |
| CPU-правила | обязательные правила §11.1, механически проверяются `tests/rules.test.js` | `docs/task-system-v3.0/DEVELOPMENT_RULES.md:128-132` |
| Правила CPU по сути | рынок только через кэш на тик; `Object.values(Game.*)` не в per-creep коде; Memory — только переживающее рестарт и только при смене значения; `room.find` не в горячем пути; замер до и после | `DEVELOPMENT_RULES.md:134-166` |

### 2. Инструменты репозитория

| Инструмент | Что делает | Источник |
|---|---|---|
| `screeps.token.js` | единая точка получения токена: env → `.screeps.json` корня → `~/.screeps.json` | `screeps.token.js:1-16,54-77` |
| `scripts/baseline.js` | замеры на живом шарде без выгрузки кода: общее состояние, стоимость API, рынок, разбор Memory | `scripts/baseline.js:1-26` |
| `scripts/memory.audit.js` | читает ключи Memory с размерами, ищет мёртвые `__*` и ключи без ссылок в коде | `scripts/memory.audit.js:7-34` |
| `scripts/deploy.modules.js` | карта выгрузки: что уезжает и под каким именем | `scripts/deploy.modules.js:49,57` |
| `Gruntfile.js` | задача `screeps`: собирает модули, проверяет `require`, вызывает `api.code.set("test", modules)` | `Gruntfile.js:27-73` |
| `tests/*.test.js` | 27 офлайн-тестов, `node tests/<файл>.test.js`, код возврата = результат; все разом — `node scripts/check.all.js` | `AGENTS.md:22-23`; `scripts/check.all.js:1-40` |
| `docs/cpu-baseline.json` | результат последнего прогона baseline | `scripts/baseline.js:315-316` |

### 3. Токен: приоритет источников

| Шаг | Источник | Источник в коде |
|---|---|---|
| 1 | `process.env.SCREEPS_TOKEN`, затем `SCREEPS_AUTH_TOKEN` | `screeps.token.js:22,55-60` |
| 2 | `.screeps.json` в корне проекта, ключи `token`, `SCREEPS_TOKEN`, `authToken` | `screeps.token.js:23,40-45,62-63` |
| 3 | `~/.screeps.json` — резервный, с предупреждением в stderr о потенциальной утечке | `screeps.token.js:65-74` |
| — | `requireToken()` бросает понятную ошибку, если токена нет | `screeps.token.js:91-100` |
| — | `.screeps.json` в `.gitignore` и вне каталогов выгрузки | `.gitignore:2`; `scripts/deploy.modules.js:49` |

`resolveTokenSource()` возвращает `{token, source}`, где `source` — `"env" |
"project-file" | "home-file" | null` (`screeps.token.js:49-53`); `scripts/baseline.js`
печатает источник в первой строке отчёта (`scripts/baseline.js:279-280`).

### 4. Как запускается замер и куда пишутся результаты

| Факт | Значение | Источник |
|---|---|---|
| Запуск | `node scripts/baseline.js` (по умолчанию `shard3`) или `node scripts/baseline.js shard3` | `scripts/baseline.js:22-25,31` |
| Пауза между командами | `PAUSE_MS = 2500` мс | `scripts/baseline.js:32` |
| Предел длины команды | `CONSOLE_LIMIT = 1000`; при превышении — явная ошибка до отправки | `scripts/baseline.js:34-35,56-61` |
| Повторы | до 3 попыток на выражение: консоль изредка молча теряет команду | `scripts/baseline.js:64-72` |
| Флаг уборки | на время замеров `Memory.keepTemp = true`, иначе боевой `empire.js` вычистит `__*` поля | `scripts/baseline.js:282-285`; `empire.js:32-39` |
| Результат | файл `docs/cpu-baseline.json` (перезаписывается целиком) | `scripts/baseline.js:313-317` |
| Аудит Memory | `node scripts/memory.audit.js` → `/tmp/memkeys.json` | `scripts/memory.audit.js:11-16` |
| Аккаунт проекта | играет на `shard3`, лимит CPU 20 | `docs/CPU-BASELINE.md:136,24` |

### 5. Как читаются результаты: `Memory.__bench_*` и почему поля удаляются

```js
// scripts/baseline.js:50-54 — обёртка вокруг выражения
const key = "__bench_" + field;
const command =
  `try { Memory.${key} = String(${expression}); } ` +
  `catch (e) { Memory.${key} = "ERR: " + e.message; }`;
```

| Шаг | Что происходит | Источник |
|---|---|---|
| 1 | выражение исполняется в консоли шарда, результат пишется строкой в `Memory.__bench_<field>` | `scripts/baseline.js:50-54` |
| 2 | скрипт читает поле обратно через API: `api.memory.get(key, SHARD)` | `scripts/baseline.js:67` |
| 3 | поле удаляется: `delete Memory.__bench_<field>` | `scripts/baseline.js:74` |
| 4 | в конце — `delete Memory.keepTemp` и удаление остатков `__probe*`, `__bench*` | `scripts/baseline.js:295-302` |
| Почему | `Memory` сериализуется целиком каждый тик: мёртвое поле — постоянный налог на CPU | `empire.js:21-25`; `DEVELOPMENT_RULES.md:147-153` |
| Почему | конвенция проекта: поле верхнего уровня с `__` — временное и вычищается каждый тик | `empire.js:32-39`; `tests/rules.test.js:300-304` |
| Итог | боевая Memory не засоряется, следов замера в ней не остаётся | `scripts/baseline.js:9-11,295-302` |

Ошибка выражения не теряется: она приезжает строкой `"ERR: ..."`, и `section()`
печатает её, не роняя остальные шаги (`scripts/baseline.js:43-48,84-94,112-113`).

### 6. Ограничения консоли (проверено на живом шарде)

| Факт | Значение | Источник |
|---|---|---|
| Длинная команда **молча отбрасывается** | проверено: 1000 символов выполняется, 1200 — нет, ответ всё равно `ok` | `docs/CPU-BASELINE.md:128-130`; `scripts/baseline.js:13-14` |
| Рабочий предел в коде | 1000 символов, проверяется до отправки | `scripts/baseline.js:34-35,56-61` |
| Ответ выражения через POST не приходит | результат пишется в `Memory` и читается через `memory.get` | `docs/CPU-BASELINE.md:131-132` |
| `Game.cpu.getUsed` нельзя отрывать от объекта | `const u = Game.cpu.getUsed; u()` → `Illegal invocation`; оборачивать в стрелку | `docs/CPU-BASELINE.md:133-134` |
| Команды теряются | лечится 3 попытками и паузой 2500 мс | `scripts/baseline.js:32,64-72` |

Как обходить: держать выражения короткими (короткие имена, никаких длинных
литералов), писать результат в `Memory.__bench_*`, читать его через API, а не
через ответ консоли.

### 7. Тесты

| Факт | Значение | Источник |
|---|---|---|
| Запуск | `node tests/<файл>.test.js` | `AGENTS.md:22-23` |
| Всего файлов | 28 | `scripts/check.all.js` (агрегат `tests/.last-run.json`) |
| Последний прогон | 28/28 PASS, 805 проверок, 0 FAIL | `tests/.last-run.json` (05.10.2026) |
| Прогон всех | `node scripts/check.all.js` (тесты + циклы require + загрузка + скиллы) | `scripts/check.all.js:1-40` |
| Код возврата | `process.exit(failed === 0 ? 0 : 1)` — ненулевой код = FAIL | `tests/rules.test.js:535` |
| `tests/rules.test.js` | механически держит правила CPU: рынок, `getAllOrders`, `Object.values(Game.*)`, `room.find`, Memory/heap, `subsystems` | `tests/rules.test.js:258-325` |
| Что проверяется | 9 групп: рынок изолирован (`:258`), кэш ордеров (`:262`), per-creep код (`:273`), горячий путь ролей (`:292`), Memory и heap-кэши (`:300`), наблюдаемость (`:321`), ленивый резолв в executors (`:327`), запись `creep.memory` (`:390`), политика `reusePath` (`:466`) | `tests/rules.test.js:258-532` |
| Тесты в git | `tests/` НЕ игнорируется (игнорируется только агрегат `tests/.last-run.json`): тесты — часть проекта, но на шард не уезжают | `.gitignore:5-10`; `scripts/deploy.modules.js:49` |

### 8. Деплой

| Факт | Значение | Источник |
|---|---|---|
| Команда | `./node_modules/.bin/grunt screeps` — только по отдельной явной команде человека | `AGENTS.md:21,27` |
| Ветка | `BRANCH = "test"` | `Gruntfile.js:27,59-60` |
| Что выгружается | `SRC = ["*.js", "constants/*.js", "room/*.js", "task/*.js"]` — корневые модули, `constants/*`, `room/*` и `task/*` | `scripts/deploy.modules.js:49` |
| Что исключено | `Gruntfile.js`, `screeps.token.js`, `eslint.config.js` | `scripts/deploy.modules.js:57` |
| `.screeps.json` | не попадает ни в `SRC` (это `.json`), ни в git | `scripts/deploy.modules.js:49`; `.gitignore:2` |
| Страховка | перед выгрузкой проверяются все литеральные `require`: неразрешимые отменяют выгрузку | `Gruntfile.js:43-56` |
| Имена модулей | путь без `.js` (например `constants/logistics`), поэтому папки не разворачиваются в корень | `Gruntfile.js:14-26` |

## Рецепты

### Р1. Токен в скрипте

```js
const { resolveTokenSource, requireToken } = require("./screeps.token");
const { ScreepsAPI } = require("screeps-api");

const { source } = resolveTokenSource();      // "env" | "project-file" | "home-file" | null
const api = new ScreepsAPI({ token: requireToken() }); // бросит понятную ошибку, если токена нет
console.log("токен из:", source);
```

### Р2. Один read-only замер с живой консолью

Шаблон повторяет `scripts/baseline.js`: короткое выражение → `Memory.__bench_*`
→ пауза → чтение через API → удаление поля.

```js
const { resolveTokenSource } = require("./screeps.token");
const { ScreepsAPI } = require("screeps-api");

const SHARD = "shard3";
const PAUSE_MS = 2500;            // scripts/baseline.js:32
const CONSOLE_LIMIT = 1000;       // scripts/baseline.js:34-35
const api = new ScreepsAPI({ token: resolveTokenSource().token });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Выполняет выражение в консоли, возвращает строку результата или "ERR: ...". */
async function evalInGame(field, expression) {
  const key = "__bench_" + field;
  const command =
    `try { Memory.${key} = String(${expression}); } ` +
    `catch (e) { Memory.${key} = "ERR: " + e.message; }`;
  if (command.length > CONSOLE_LIMIT) {
    throw new Error(`выражение ${field}: ${command.length} > ${CONSOLE_LIMIT} символов`);
  }
  let value;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await api.console(command, SHARD);
    await sleep(PAUSE_MS);
    const res = await api.memory.get(key, SHARD);
    value = res && res.data;
    if (value !== undefined && value !== null) break;
    await sleep(PAUSE_MS);
  }
  await api.console(`delete Memory.${key}`, SHARD);
  await sleep(600);
  if (value === undefined || value === null) throw new Error(`пустой ответ для ${key}`);
  return String(value);
}

(async () => {
  await api.console("Memory.keepTemp = true", SHARD); // empire.js иначе вычистит __*
  await sleep(1500);
  const out = await evalInGame(
    "creeps",
    `(() => { const u = () => Game.cpu.getUsed(), t0 = u();` +
      ` for (let i = 0; i < 200; i++) Object.values(Game.creeps).length;` +
      ` return (u() - t0).toFixed(4); })()`,
  );
  console.log("Object.values(Game.creeps) x200 =", out, "CPU");
  await api.console("delete Memory.keepTemp", SHARD); // флаг снять обязательно
})();
```

### Р3. Проверить, что временных полей не осталось

```js
// read-only: ничего не пишет, только читает имена ключей Memory.
// evalInGame/sleep/api — из рецепта Р2 выше.
(async () => {
  const names = await evalInGame(
    "leftovers",
    `Object.keys(Memory).filter(k => k.charCodeAt(0) === 95).join(",")`,
  );
  console.log("поля с '_' в начале:", names || "(нет)");
})();
```

### Р4. Как отличить замер от правки

| Признак | Замер (можно) | Правка (нельзя без команды) |
|---|---|---|
| Что меняется | только `Memory.keepTemp` и `Memory.__bench_*` | боевые поля `Memory`, код на шарде |
| Игровые методы | только чтение (`Game.*`, `room.find`, `getUsed`) | `creep.moveTo`, `spawnCreep`, `tower.attack`, `market.deal`, `RawMemory.set` |
| Откат | удаление временного поля | нужна отдельная точка отката |
| Основание | `AGENTS.md:16` | `AGENTS.md:4-5,20-21` |

Если для замера нужно действие (движение, спавн) — это уже не read-only:
останавливаться и запрашивать команду человека.

### Р5. Прогнать тесты перед правкой

```bash
node scripts/check.all.js   # всё разом: 28 тестов (805 проверок) + циклы require + загрузка + скиллы
node tests/rules.test.js    # только правила CPU: 30 проверок
```

### Р6. Выгрузка (только по отдельной явной команде человека)

```bash
./node_modules/.bin/grunt screeps
```

## Формат отчёта о замере

Обязательный минимум: **точная команда**, **шард**, **`Game.time`**, **число с
единицами**, **что именно мерено** и **файл/строка, где лежит подтверждение**.

Хороший отчёт:

```
Замер: node scripts/baseline.js shard3 (scripts/baseline.js:31 — shard3 по умолчанию)
Токен: project-file (scripts/baseline.js:279-280)
Шард: shard3, Game.time = 83271254 (docs/cpu-baseline.json:5)
CPU/тик: 6.769 при count=98 (Memory.cpuStats.average — docs/cpu-baseline.json:12-15)
Лимит: 20, bucket: 10000 (docs/cpu-baseline.json:6-7)
CPU/крип: 0.242 при 28 крипах (docs/cpu-baseline.json:16)
```

Плохой отчёт: «CPU стал примерно вдвое меньше», «Memory где-то 300 КБ»,
«должно ускориться», «по коду видно, что рынок дорогой» — это оценки, а не
замеры (`AGENTS.md:13-15`). Если данных нет — писать «не знаю» (`AGENTS.md:15`).

## Подводные камни

1. **Команда длиннее ~1000 символов исчезает молча**: ответ `ok`, эффекта нет
   (`docs/CPU-BASELINE.md:128-130`). Всегда проверять длину до отправки и читать
   результат обратно из `Memory`.
2. **Забытый `Memory.keepTemp`** отключает уборку `__*` навсегда — боевая Memory
   начнёт расти (`empire.js:32-39`). Снимать флаг тем же прогоном
   (`scripts/baseline.js:296`).
3. **Забытое `Memory.__bench_*`** остаётся в боевой Memory и сериализуется каждый
   тик (`scripts/baseline.js:74`; `empire.js:21-25`). После замера — проверять
   остатки (Р3).
4. **Замер не равен правке**: `scripts/baseline.js` не выгружает код и не меняет
   боевые поля (`scripts/baseline.js:19-20`; `docs/CPU-BASELINE.md:5-6`).
5. **Один замер — не серия**: два прогона на разных тиках дали 8.53 и 6.77 CPU/тик
   (`docs/cpu-baseline-8.53.json:12` против `docs/cpu-baseline.json:15`). Сравнивать
   средние с одинаковым окном (`count`) и указывать окно в отчёте.
6. **На шард тесты не уезжают** — выгрузка берёт только `*.js` корня,
   `constants/*.js`, `room/*.js` и `task/*.js` (`scripts/deploy.modules.js:49`).
   В git `tests/` при этом НЕ игнорируется: под `.gitignore` лежит лишь агрегат
   `tests/.last-run.json` (`.gitignore:10`).
7. **Токен из `~/.screeps.json`** — резервный источник и потенциальная утечка;
   скрипт печатает предупреждение, о нём нужно сообщить человеку
   (`screeps.token.js:65-74`).
8. **`Game.cpu.getUsed` в замыкании**: сохранять ссылку на метод нельзя, только
   стрелку (`docs/CPU-BASELINE.md:133-134`).
9. **Изменения в task-системе** (5 файлов, `AGENTS.md:8-10`) не делаются даже
   «попутно» при замере — это отдельное согласование.
10. **Числа с шарда нельзя переносить** на другой шард или приватный сервер: 1 CPU =
    1 мс конкретной машины (docs/cpu-limit.html).

## Источники

Файлы репозитория (проверены чтением при подготовке скилла):

- `AGENTS.md:4-27` — запреты, требования к утверждениям, порядок работы, тесты, деплой.
- `screeps.token.js:22-23,40-45,49-77,91-100,102` — `ENV_KEYS`, `.screeps.json`, `resolveTokenSource`, `requireToken`.
- `scripts/baseline.js:13-14,19-25,31-35,50-81,84-94,279-285,295-302,313-317` — лимит консоли, запуск, `evalInGame`, `Memory.keepTemp`, очистка, файл результата.
- `scripts/memory.audit.js:7-34` — сканирование ключей Memory и мёртвых `__*`.
- `scripts/deploy.modules.js:10-33,43,51` — что уезжает, исключения, семантика `require` на шарде.
- `Gruntfile.js:14-27,36,43-60` — ветка `test`, сборка модулей, проверка `require`, `api.code.set`.
- `tests/rules.test.js:1-30,40-257,258-532,535` — 9 групп правил CPU и код возврата (шапка со списком правил, сбор рантайм-файлов и хелперы, блок проверок 258-532, выход по `failed`). Рантайм-файлы берутся из SRC деплоя, то есть проверяются корень, `constants/`, `task/` и `room/`.
- `scripts/check.all.js:1-40` — единая команда проверок: 28 тестов + `check.require.cycles` + `check.boot` + `validate.skills`, пишет агрегат `tests/.last-run.json` (28 файлов, 805 проверок, 0 FAIL, 05.10.2026).
- `tests/citations.test.js:1-40` — механический страж ссылок `file:line`: строка не за концом файла, нет ссылок на удалённые модули (реестр `REMOVED_MODULES`), исторические `docs/*.md` — предупреждения.
- `docs/CPU-BASELINE.md:23-32,40-50,76-79,126-136` — цифры замеров, стоимость API, ограничения консоли, `cpuShard: {shard3: 20}`.
- `docs/cpu-baseline.json:5-16,19-34` — сырые результаты последнего прогона (шард, тик, CPU/тик, bucket, стоимость API).
- `docs/cpu-baseline-8.53.json:4-16` — предыдущий прогон (8.53 CPU/тик) для сравнения.
- `docs/task-system-v3.0/DEVELOPMENT_RULES.md:128-166` — §11.1, обязательные правила по CPU.
- `empire.js:14-19,21-39,80,89,91` — уборка мёртвых крипов и `__*`, `keepTemp`, порядок вызовов.
- `cpuMonitor.js:106-111,120-125,132-144,153-169` — накопители в heap, запись `Memory.cpuStats` раз в `CPU.REPORT_INTERVAL`.
- `constants/market.js:25`, `constants/system.js:73-75` — `MARKET.INTERVAL = 30`, `CPU.REPORT_INTERVAL = 10`, `CPU.AVERAGE_WINDOW = 100`, `CPU.BUCKET_CRITICAL = 500`.
- `loadShed.js:136-144,182-194` — пороги экономии по bucket (9000/7000/5000).
- `main.js:5-9` — точка входа `module.exports.loop` → `empire.run()`.
- `.gitignore:1-10` — `node_modules/`, `.screeps.json`, `test.js`, `tests/.last-run.json` (каталог `tests/` НЕ игнорируется).

Внешние (для ограничений игровых механик, использованных в отчёте):

- https://docs.screeps.com/cpu-limit.html — 1 CPU = 1 мс, bucket 10000, остановка исполнения при исчерпании.
- https://docs.screeps.com/api/#Memory — `Memory` как объект, доступный из консоли и кода.
