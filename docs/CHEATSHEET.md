# Screeps — Справочник команд консоли

## Управление `require("control")`

| Команда                                                                 | Описание                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `require("control").Empire.pause()`                                     | Остановить всю империю                                                                                  |
| `require("control").Empire.resume()`                                    | Возобновить империю                                                                                     |
| `require("control").Empire.status()`                                    | Статус империи                                                                                          |
| `require("control").Room.pause("E35S37")`                               | Остановить комнату                                                                                      |
| `require("control").Room.resume("E35S37")`                              | Возобновить комнату                                                                                     |
| `require("control").Room.setMode("E35S37", "toStorage")`                | Установить режим терминала                                                                              |
| `require("control").Room.clearMode("E35S37")`                           | Сбросить режим терминала                                                                                |
| `require("control").Room.status("E35S37")`                              | Статус комнаты                                                                                          |
| `require("control").Creep.move("Worker1", 25, 25, "E35S37")`            | Отправить крипа в точку                                                                                 |
| `require("control").Creep.return("Worker1")`                            | Вернуть крипа домой                                                                                     |
| `require("control").Creep.task("Worker1", "build")`                     | Сменить задачу крипу                                                                                    |
| `require("control").Creep.transfer("Worker1", "id", "energy", 1000)`    | Передать ресурс                                                                                         |
| `require("control").Creep.attack("Worker1", "targetId")`                | Атаковать цель                                                                                          |
| `require("control").Creep.heal("Worker1", "targetId")`                  | Лечить цель                                                                                             |
| `require("control").Creep.clear("Worker1")`                             | Сбросить override крипа                                                                                 |
| `require("control").Creep.clearAll("E35S37")`                           | Сбросить все override в комнате                                                                         |
| `require("control").Creep.clearAll()`                                   | Сбросить все override в империи                                                                         |
| `require("control").Creep.status("Worker1")`                            | Статус крипа                                                                                            |
| `require("control").Terminal.send("E35S37", "E36S38", "energy", 10000)` | Отправить ресурс из терминала в терминал (ресурс уже в терминале)                                       |
| `require("control").Terminal.status("E35S37")`                          | Статус терминала                                                                                        |
| `require("control").Terminal.move("E35S37", "E36S38", "energy", 10000)` | **Перебросить из ХРАНИЛИЩА в ХРАНИЛИЩЕ** через терминалы: storage(A)→terminal(A)→terminal(B)→storage(B) |
| `require("control").Terminal.moveStatus("E35S37")`                      | Статус активных заданий на переброску из комнаты                                                        |
| `require("control").Terminal.moveCancel("E35S37", "E36S38", "energy")`  | Отменить задание на переброску                                                                          |
| `require("control").Memory.clearRoom("E35S37")`                         | Очистить память комнаты                                                                                 |
| `require("control").Memory.setRoom("E35S37", "key", value)`             | Записать в память комнаты                                                                               |
| `require("control").Memory.show("E35S37")`                              | Показать память комнаты                                                                                 |
| `require("control").Memory.deleteField("E35S37", "key")`                | Удалить поле из памяти комнаты                                                                          |
| `require("control").Memory.compare()`                                   | Сравнить память всех комнат                                                                             |
| `require("control").Memory.restore("E35S37")`                           | Восстановить недостающие поля                                                                           |

---

## Логгер `require("logger")`

| Команда                                     | Описание                                      |
| ------------------------------------------- | --------------------------------------------- |
| `require("logger").diagOn()`                | Включить отладочные логи                      |
| `require("logger").diagOff()`               | Выключить отладочные логи                     |
| `require("logger").setThrottle(50)`         | Интервал между одинаковыми сообщениями (тики) |
| `require("logger").clearHistory()`          | Очистить историю throttle                     |
| `require("logger").clearEvents()`           | Очистить историю событий                      |
| `require("logger").getEvents(null, 20)`     | Последние N событий по всей империи           |
| `require("logger").getEvents("E35S37", 20)` | Последние N событий по комнате                |
| `require("logger").getConfig()`             | Текущие настройки логгера                     |

---

## Балансировщик ресурсов (Memory)

| Команда                          | Описание                      |
| -------------------------------- | ----------------------------- |
| `Memory.balancerEnabled = false` | Остановить балансировщик      |
| `Memory.balancerEnabled = true`  | Возобновить балансировщик     |
| `Memory.balancerDebug = true`    | Подробные логи балансировщика |
| `Memory.balancerDebug = false`   | Выключить подробные логи      |
| `Memory.empire.balancer`         | Статистика последнего запуска |

---

## Диагностика `require("diagnostic")`

| Команда                                    | Описание                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `require("diagnostic").empire()`           | Полная сводка по всей империи                                     |
| `require("diagnostic").room("E35S37")`     | Детали комнаты                                                    |
| `require("diagnostic").terminal("E35S37")` | Содержимое терминала                                              |
| `require("diagnostic").creeps("E35S37")`   | Крипы комнаты                                                     |
| `require("diagnostic").creep("Worker1")`   | Детали крипа                                                      |
| `require("diagnostic").overrides()`        | Все активные override                                             |
| `require("diagnostic").balance()`          | Энергия по всей империи                                           |
| `require("diagnostic").cpu()`              | Использование CPU                                                 |
| `require("diagnostic").memory("E35S37")`   | Память комнаты с проверкой структуры                              |
| `require("diagnostic").memoryAll()`        | Сравнение памяти всех комнат                                      |
| `require("diagnostic").storages()`         | Снимок всех storage: заполненность, предупреждения о переполнении |
| `require("diagnostic").terminals()`        | Снимок всех terminal: заполненность, cooldown, ресурсы            |
| `require("diagnostic").logistics()`        | Очереди terminalNeeds по всем комнатам                            |

---

## Рапорт по империи `require("empire.report")`

| Команда                               | Описание                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require("empire.report").generate()` | Единый JSON-снимок: vision, architecture, state, infrastructure (комнаты/фабрики/лабы/обсерв./нюки), readiness (energyStability, критичные/слабые/переполненные комнаты), детали по каждой комнате (storageState/terminalState/energyAvailable) |

Примечание: `architecture.remoteMining` и `architecture.labs` теперь читаются напрямую из `empire.js` (`empire.remoteMining.enabled` / `empire.labs.enabled`), а не захардкожены — если политика в `empire.js` изменится, отчёт обновится автоматически.

---

## Телеметрия энергетики `require("diagnostic.energyTelemetry")`

ВРЕМЕННЫЙ модуль по ТЗ №25. Не влияет на игровую логику, пишет только в собственное пространство `Memory.energyTelemetry`.

| Команда                                                 | Описание                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `require("diagnostic.energyTelemetry").tick()`          | Снимает срез раз в 1000 тиков. Требует подключения в main.js (см. инструкцию в самом файле).                                                  |
| `require("diagnostic.energyTelemetry").snapshot()`      | Срез состояния прямо сейчас: storage/terminal/factory по комнатам, статусы POOR/NORMAL/RICH, terminalRatio, аварийные worker, баланс империи. |
| `require("diagnostic.energyTelemetry").deltas()`        | Дельты Storage/Terminal/Total между первым и последним накопленным снимком.                                                                   |
| `require("diagnostic.energyTelemetry").report()`        | Полный отчёт (snapshot + deltas) одним JSON — то, что нужно копировать для анализа.                                                           |
| `require("diagnostic.energyTelemetry").exportHistory()` | Вся накопленная история снимков как JSON-строка.                                                                                              |
| `require("diagnostic.energyTelemetry").reset()`         | Удаляет `Memory.energyTelemetry`. Выполнить по завершении ТЗ №25 вместе с удалением строк из main.js.                                         |
