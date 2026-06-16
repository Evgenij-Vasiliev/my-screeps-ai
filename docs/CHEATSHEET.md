# Screeps — Справочник команд консоли

## Управление `require("control")`

| Команда                                                                 | Описание                        |
| ----------------------------------------------------------------------- | ------------------------------- |
| `require("control").Empire.pause()`                                     | Остановить всю империю          |
| `require("control").Empire.resume()`                                    | Возобновить империю             |
| `require("control").Empire.status()`                                    | Статус империи                  |
| `require("control").Room.pause("E35S37")`                               | Остановить комнату              |
| `require("control").Room.resume("E35S37")`                              | Возобновить комнату             |
| `require("control").Room.setMode("E35S37", "toStorage")`                | Установить режим терминала      |
| `require("control").Room.clearMode("E35S37")`                           | Сбросить режим терминала        |
| `require("control").Room.status("E35S37")`                              | Статус комнаты                  |
| `require("control").Creep.move("Worker1", 25, 25, "E35S37")`            | Отправить крипа в точку         |
| `require("control").Creep.return("Worker1")`                            | Вернуть крипа домой             |
| `require("control").Creep.task("Worker1", "build")`                     | Сменить задачу крипу            |
| `require("control").Creep.transfer("Worker1", "id", "energy", 1000)`    | Передать ресурс                 |
| `require("control").Creep.attack("Worker1", "targetId")`                | Атаковать цель                  |
| `require("control").Creep.heal("Worker1", "targetId")`                  | Лечить цель                     |
| `require("control").Creep.clear("Worker1")`                             | Сбросить override крипа         |
| `require("control").Creep.clearAll("E35S37")`                           | Сбросить все override в комнате |
| `require("control").Creep.clearAll()`                                   | Сбросить все override в империи |
| `require("control").Creep.status("Worker1")`                            | Статус крипа                    |
| `require("control").Terminal.send("E35S37", "E36S38", "energy", 10000)` | Отправить ресурс                |
| `require("control").Terminal.status("E35S37")`                          | Статус терминала                |
| `require("control").Memory.clearRoom("E35S37")`                         | Очистить память комнаты         |
| `require("control").Memory.setRoom("E35S37", "key", value)`             | Записать в память комнаты       |
| `require("control").Memory.show("E35S37")`                              | Показать память комнаты         |

---

## Диагностика `require("diagnostic")`

| Команда                                    | Описание                      |
| ------------------------------------------ | ----------------------------- |
| `require("diagnostic").empire()`           | Полная сводка по всей империи |
| `require("diagnostic").room("E35S37")`     | Детали комнаты                |
| `require("diagnostic").terminal("E35S37")` | Содержимое терминала          |
| `require("diagnostic").creeps("E35S37")`   | Крипы комнаты                 |
| `require("diagnostic").creep("Worker1")`   | Детали крипа                  |
| `require("diagnostic").overrides()`        | Все активные override         |
| `require("diagnostic").balance()`          | Энергия по всей империи       |
| `require("diagnostic").cpu()`              | Использование CPU             |
