Контекст по системе лабораторий Screeps
Цель
Стабилизировать лабораторную империю и убрать ручное управление.
Архитектурно разделяем систему на независимые слои:
planner — аналитика
autoconfig — назначение задач
worker — исполнение
delivery — логистика (если понадобится позже)
Главная идея:
каждый слой отвечает только за свою часть.

Исходная проблема
В империи есть несколько комнат с lab-тройками.
Часть X-tier бустов работает стабильно:
XLHO2
XKHO2
XKH2O
но часть промежуточных продуктов зависает.
Planner показывал:
{
"needs": ["XKHO2", "KHO2", "UH2O"],
"bottlenecks": []
}

Это означало:
сырьё есть
минералы есть
цепочка не заблокирована
проблема в orchestration

Принятое архитектурное правило
Planner — единственный source of truth.
Никаких отдельных target tables.
Никаких дополнительных лимитов.
Все остальные модули читают planner.

Phase 1 — Planner
Файл:
labs.planner.js

Что делает:
читает активные lab configs из:
room.memory.labs
room.memory.labs2
room.memory.labs3

строит dependency chain
считает stock по империи:
storage
terminal
labs
определяет:
targets
needs
bottlenecks
Публикует:
Memory.labPlanner = {
targets,
needs,
bottlenecks,
stock
}

API:
labsPlanner.isNeeded(resource)
labsPlanner.isBottleneck(resource)
labsPlanner.getNeeds()
labsPlanner.getBottlenecks()
labsPlanner.getTargets()
labsPlanner.getStock(resource)

Важно:
planner не меняет room memory и не запускает действия.
Только аналитика.

Phase 2 — AutoConfig
Файл:
labs.autoconfig.js

Запуск:
после planner.
Задача:
читать:
Memory.labPlanner.needs

и автоматически назначать задачи lab-тройкам.
Разрешено менять:
Memory.rooms[room].labs
Memory.rooms[room].labs2
Memory.rooms[room].labs3

Запрещено:
terminal.send
transfer
runReaction
worker actions

Правило свободной тройки
Тройка считается свободной если:

нет memory
или

варит продукт, которого уже нет в:
Memory.labPlanner.needs

и продукт не X-tier
или

неактивна

X-tier защита
Никогда не трогать:
XLHO2
XKHO2
XKH2O
XZHO2
XUHO2
XGHO2
XUH2O
XZH2O
XGH2O
Если тройка варит X-tier — остаётся как есть.

Результат
Autoconfig корректно определил:
все текущие needs уже покрыты активными тройками.
Назначать ничего не пришлось.
Это нормальное поведение.

Текущее состояние троек
Room
labs
labs2
labs3
E35S37
XLHO2
XKHO2
XKH2O
E35S39
KHO2
OH
KH
E36S38
LHO2
OH
ZO
E37S37
LO
LHO2
OH
E37S38
UH2O
OH
ZHO2

Главный вывод
Сейчас архитектура такая:
planner:
видит дефицит
↓
autoconfig:
назначает корректно
↓
дальше узкое место где-то в execution path
То есть:
ресурсы есть
конфиги есть
но часть продуктов всё ещё не приходит в stock
Следующий этап будем смотреть отдельно.
