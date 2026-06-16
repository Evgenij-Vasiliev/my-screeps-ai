# CONTROL.JS — Пояснительная записка

**Версия:** 1.0  
**Файл:** `control.js`  
**Назначение:** Модуль ручного управления империей Screeps поверх автоматической системы

---

## 1. Место в архитектуре

```
main.js
  └── room.manager
        └── creep.runner
              ├── override (control.js записывает в Memory)  ← высший приоритет
              └── role.run()                                  ← авто-система
```

`control.js` **не вызывается автоматически каждый тик**. Он вызывается вручную из консоли игры. Результат работы — запись в `Memory`, которую `creep.runner` читает при следующем тике.

---

## 2. Концепция

Модуль реализует принцип **Console API** из архитектурного плана:

- Автосистема работает в фоновом режиме
- Консоль имеет абсолютный приоритет
- `Memory` — единственный источник состояния
- Override выполняется до тех пор, пока не будет снят вручную или не завершится (если `once: true`)

Модуль намеренно прост: он только **пишет в Memory**. Логика исполнения находится в `creep.runner.js`.

---

## 3. API — способ использования из консоли

```javascript
const C = require("control");
```

### 3.1 Empire — управление всей империей

| Команда             | Действие                                                  |
| ------------------- | --------------------------------------------------------- |
| `C.Empire.pause()`  | Останавливает всю империю (`Memory.empire.paused = true`) |
| `C.Empire.resume()` | Возобновляет работу империи                               |

**Пример:**

```javascript
C.Empire.pause(); // → "Империя остановлена"
C.Empire.resume(); // → "Империя возобновлена"
```

> Флаг `Memory.empire.paused` должен обрабатываться в `main.js` или `room.manager`. На текущий момент это точка расширения.

---

### 3.2 Room — управление комнатой

| Команда                                 | Действие                      |
| --------------------------------------- | ----------------------------- |
| `C.Room.pause("E35S37")`                | Останавливает комнату         |
| `C.Room.resume("E35S37")`               | Возобновляет комнату          |
| `C.Room.setMode("E35S37", "toStorage")` | Устанавливает режим терминала |

**Пример:**

```javascript
C.Room.setMode("E35S37", "toStorage"); // → "E35S37 режим: toStorage"
```

Запись идёт в `Memory.rooms[roomName].terminalMode`. Режим читается `terminal.manager`.

---

### 3.3 Creep — управление отдельным крипом

| Команда                           | Действие                                                 |
| --------------------------------- | -------------------------------------------------------- |
| `C.Creep.move("имя", x, y, room)` | Отправить крипа в точку                                  |
| `C.Creep.return("имя")`           | Вернуть крипа на базу (позиция 25,25 в домашней комнате) |
| `C.Creep.task("имя", "build")`    | Сменить задачу крипу                                     |
| `C.Creep.clear("имя")`            | Сбросить все override команды                            |

**Примеры:**

```javascript
// Отправить крипа в другую комнату
C.Creep.move("Worker1", 25, 25, "E36S37");

// Вернуть домой
C.Creep.return("Worker1");

// Сменить задачу
C.Creep.task("Worker1", "build");

// Снять override
C.Creep.clear("Worker1");
```

---

## 4. Структура override в Memory

`C.Creep.move()` записывает в `creep.memory.override`:

```javascript
// Тип move
{
  type: "move",
  once: false,        // false = постоянный, true = одноразовый
  target: {
    x: 25,
    y: 25,
    room: "E35S37"
  }
}

// Тип task
{
  type: "task",
  task: "build"
}
```

Поле `once: false` означает, что override **не очищается автоматически** после выполнения одного шага. Крип будет двигаться к цели до достижения или до `C.Creep.clear()`.

---

## 5. Поведение once

| Значение `once`                        | Поведение                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `false` (по умолчанию для move/return) | Override не очищается. Крип выполняет команду тик за тиком до ручного сброса |
| `true` (по умолчанию для остальных)    | Override очищается в `creep.runner` после первого исполнения                 |

Логика очистки находится в `creep.runner.js → runOverride()`:

```javascript
if (ov.once !== false) {
  creep.memory.override = null;
}
```

---

## 6. Что обрабатывает creep.runner

`creep.runner.js` реализует `runOverride(creep, ov)`, поддерживающую четыре действия:

| Тип        | Поведение                             |
| ---------- | ------------------------------------- |
| `move`     | `creep.moveTo(new RoomPosition(...))` |
| `transfer` | Передача ресурса целевому объекту     |
| `attack`   | Атака объекта по ID                   |
| `heal`     | Лечение объекта по ID                 |

Тип `task` в `runOverride` не обрабатывается — это точка расширения (см. раздел 8).

---

## 7. Ограничения текущей версии

**Empire.pause / Room.pause** — флаги записываются в Memory, но нигде не читаются автоматически. Для работы паузы нужна проверка в `main.js` или `room.manager`.

**Тип task** — записывается в `override`, но `runOverride` не умеет его исполнять. Нужна дополнительная логика в `creep.runner`.

**Нет групповых команд** — управление возможно только на уровне одного крипа или комнаты. Групповой уровень (`Group._`) предусмотрен в PLAN.md, но не реализован.

**Нет валидации аргументов** — неверные координаты или имена комнат не проверяются.

---

## 8. Точки расширения

Для добавления нового типа override достаточно:

1. Добавить метод в `Control.Creep` (в `control.js`), который пишет нужную структуру в `creep.memory.override`
2. Добавить обработку нового `type` в `switch` внутри `runOverride` (`creep.runner.js`)

Пример — добавление типа `harvest`:

```javascript
// control.js
harvest: function(name, sourceId) {
  const creep = Game.creeps[name];
  if (!creep) return "Крип не найден: " + name;
  creep.memory.override = { type: "harvest", once: false, target: sourceId };
  return name + " → harvest " + sourceId;
}

// creep.runner.js → runOverride → switch
case "harvest":
  const source = Game.getObjectById(ov.target);
  if (source) creep.harvest(source);
  break;
```

---

## 9. Быстрый справочник

```javascript
const C = require("control");

// Империя
C.Empire.pause();
C.Empire.resume();

// Комната
C.Room.pause("E35S37");
C.Room.resume("E35S37");
C.Room.setMode("E35S37", "toStorage");

// Крип
C.Creep.move("Worker1", 25, 25, "E35S37");
C.Creep.return("Worker1");
C.Creep.task("Worker1", "build");
C.Creep.clear("Worker1");
```

---

## 10. Файлы, затронутые модулем

| Файл                    | Роль                                              |
| ----------------------- | ------------------------------------------------- |
| `control.js`            | API управления — пишет в Memory                   |
| `creep.runner.js`       | Читает `creep.memory.override`, исполняет команды |
| `Memory.empire`         | Хранит флаг `paused` для империи                  |
| `Memory.rooms[name]`    | Хранит `paused` и `terminalMode` для комнаты      |
| `creep.memory.override` | Хранит текущую команду для крипа                  |
