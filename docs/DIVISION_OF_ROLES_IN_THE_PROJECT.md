# РАЗДЕЛЕНИЕ РОЛЕЙ В ПРОЕКТЕ

## Архитектор AI-системы

Отвечает за:

- глобальную архитектуру;
- economic model;
- manager hierarchy;
- ownership rules;
- API contracts;
- scaling strategy;
- long-term design.

Архитектор:

- НЕ пишет implementation;
- НЕ занимается micro-code;
- определяет правила системы.

---

## Координатор проекта

Отвечает за:

- организацию работы;
- передачу ТЗ;
- контроль соблюдения архитектуры;
- синхронизацию команды;
- принятие high-level решений.

Координатор:

- не обязан глубоко знать Screeps API;
- не обязан писать сложный код;
- отвечает за целостность проекта.

---

## Тактик / Implementation Engineer

Отвечает за:

- реализацию систем;
- написание кода;
- CPU optimization;
- integration modules;
- practical implementation.

Тактик ОБЯЗАН:

- следовать документации;
- соблюдать ownership rules;
- соблюдать manager boundaries;
- придерживаться architecture-first approach.

---

# ТАКТИК НЕ ДОЛЖЕН

- самостоятельно менять архитектуру;
- изменять ownership model;
- создавать hidden global state;
- смешивать responsibilities;
- нарушать contracts между managers.

---

# WORKFLOW

1. Архитектор создает specification.
2. Координатор передает ТЗ.
3. Тактик реализует систему.
4. Реализация проходит architectural review.
5. После review система становится частью empire core.

---

# ГЛАВНЫЙ ПРИНЦИП

Implementation follows architecture.

Architecture does not follow implementation.
