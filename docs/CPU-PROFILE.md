# CPU-ПРОФИЛЬ: база для сравнения

Снимок снят с живого шарда (shard3) скриптом `tests/live.tower.coverage.js`
(секция `CPU`) — только чтение. Профиль `Memory.cpuStats.profile` — скользящее
окно `samples` тиков; «мс/тик» = `sum / count` по бакету.

> **Важно при сравнении (2026-09-24).** В снимке ниже бакеты-РОЛИ (`miner`,
> `labWorker`, `worker`, `linkWorker`, `mineralMiner`) и подсистемы лежат в одном
> окне `Memory.cpuStats.profile.blocks` — тогда роли замерялись всегда. С
> 2026-09-24 ролевой замер opt-in (`Memory.cpuMonitorRoles = true`) и пишется в
> `Memory.cpuStats.roles`, а в `profile.blocks` остаются только подсистемы и
> комнаты. Чтобы сравнить с этой базой, включите флаг и смотрите оба окна
> (`node tests/live.cpu.profile.js` печатает и то, и другое).

**Как перемерить:** `node tests/live.tower.coverage.js` → секция `CPU`.
**Как сбросить окно:** `delete Memory.cpuStats.profile` (подсистемы) и
`delete Memory.cpuStats.roles` (роли) — см. `cpuMonitor.js`.

## Снимок 1 — tick ~83184217 (окно 1200 тиков, старт 83175900)

`Memory.cpuStats.average` = **11.85** CPU/тик.

| бакет | мс/тик | max | доля от roomManager |
|---|---|---|---|
| roomManager (родитель) | 7.631 | 13.78 | 100 % |
| miner | 2.313 | 6.34 | 30 % |
| remoteManager | 1.732 | 9.22 | — (вне roomManager) |
| labWorker | 1.519 | 2.46 | 20 % |
| terminalNetwork | 0.852 | 1.50 | — |
| worker | 0.788 | 6.01 | 10 % |
| roomState | 0.632 | 1.19 | 8 % |
| labManager | 0.508 | 1.94 | 7 % |
| taskManager | 0.418 | 5.70 | 5 % |
| observerManager | 0.397 | 0.68 | — |
| linkWorker | 0.361 | 1.32 | 5 % |
| spawnManager | 0.301 | 1.03 | 4 % |
| towers | 0.263 | 3.44 | 3 % |
| linkManager | 0.166 | 0.93 | 2 % |
| mineralMiner | 0.127 | 0.87 | 2 % |
| marketManager | 0.126 | 6.29 | — |
| defenseManager | 0.114 | 1.88 | — |
| boostManager | 0.041 | 0.22 | 1 % |
| powerSpawnManager | 0.003 | 0.03 | — |

Пики (`max`) важнее среднего: в отдельные тики roomManager 13.78, remoteManager
9.22, miner 6.34, marketManager 6.29, worker 6.01, taskManager 5.70 — суммарно
уходит за лимит 20 CPU, и именно это просаживает бакет.

## Для сравнения — предыдущая известная база

`docs/SESSION_HANDOFF.md`, §0.3 (tick ~83159639–83159738, то есть ~24.6k тиков раньше):

- CPU ~10.5–11.5 / тик (сейчас 11.85);
- `roomManager` 6.9 мс/тик (сейчас 7.63, **+0.73 мс/тик, +11 %**);
- `worker` 1.08 (сейчас 0.79, −27 %);
- `taskManager` 0.39 (сейчас 0.42, в пределах шума).

Аудит (`docs/PROJECT_AUDIT_AND_ROADMAP.md`, 17.09.2026) для более раннего окна:
`roomManager` 0.7391 мс/тик — то есть с тех пор roomManager вырос на порядок,
основной вклад дают `miner`, `labWorker`/`labManager` (буст-конвейер) и
`remoteManager`, а не `roomState` (0.63) и не `towers` (0.26).

## Что проверять при следующем замере

1. `miner` — цена `creep.harvest()` ≈0.21 мс за вызов (аудит); при 11 майнерах с
   вызовом каждый тик это ~2.3 мс/тик. Тела майнеров и выдача XUHO2 —
   см. `docs/SESSION_HANDOFF.md` §2.
2. `labWorker` + `labManager` + `boostManager` ≈ 2.07 мс/тик — буст-конвейер;
   проверять по `Memory.__boostMetric` и числу активных троек.
3. `remoteManager` 1.73 мс/тик (max 9.22) — действия и `travelTo` ремоут-крипов.
4. `worker` max 6.01 при 0.79 среднего — всплески Task System: смотреть
   `Memory.__taskEvents` (`preempt:*`), прерывание задачи = смена цели =
   полный `PathFinder.search` в Traveler.
